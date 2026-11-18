"""The processing package is runtime-independent: standard library only, no network, no dynamic
code loading (ADR-061). Checked two ways: an isolated import of every module, and an AST scan."""

from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PROCESSING = REPO / "processing"
PACKAGE = PROCESSING / "lai_processing"

FORBIDDEN_TOP_LEVEL = frozenset(
    {
        "django",
        "boto3",
        "botocore",
        "rest_framework",
        "psycopg",
        "psycopg2",
        "aws_lambda_powertools",
        "requests",
        "urllib3",
        "httpx",
        "aiohttp",
        # Native code lives only in `processing/lai_native`, never in the pure library.
        "lai_native",
        "PIL",
        "jobs_worker",
    }
)
# Modules that load code dynamically, execute processes, deserialise code or open the network.
FORBIDDEN_MODULES = frozenset(
    {
        "importlib",
        "pickle",
        "marshal",
        "shelve",
        "subprocess",
        "socket",
        "ctypes",
        "urllib.request",
        "http.client",
        "ftplib",
        "smtplib",
        "xmlrpc",
    }
)
FORBIDDEN_CALLS = frozenset({"__import__", "eval", "exec", "compile"})
FORBIDDEN_ATTRIBUTES = frozenset({("os", "system"), ("os", "popen"), ("os", "exec")})

PROBE = """
import json, pkgutil, sys
import lai_processing
names = []
for info in pkgutil.walk_packages(lai_processing.__path__, "lai_processing."):
    __import__(info.name)
    names.append(info.name)
forbidden = set(json.loads(sys.argv[1]))
leaked = sorted(m for m in sys.modules if m.split(".")[0] in forbidden)
print(json.dumps({"modules": names, "leaked": leaked}))
"""


def _package_files() -> list[Path]:
    return sorted(PACKAGE.rglob("*.py"))


def test_isolated_import_of_every_module_pulls_in_no_runtime_dependency() -> None:
    # `-I` (isolated mode) ignores PYTHONPATH, the user site and the current directory, so the
    # probe puts `<repo>/processing` on sys.path itself; PYTHONPATH is set to the same single
    # directory for any non-isolated tooling, and nothing else from the test process leaks in.
    env = {"PYTHONPATH": str(PROCESSING), "PATH": os.environ.get("PATH", "")}
    probe = f"import sys; sys.path.insert(0, {str(PROCESSING)!r})\n" + PROBE
    completed = subprocess.run(
        [sys.executable, "-I", "-c", probe, json.dumps(sorted(FORBIDDEN_TOP_LEVEL))],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(PROCESSING),
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    report = json.loads(completed.stdout)
    assert report["leaked"] == []
    on_disk = set()
    for path in _package_files():
        parts = path.relative_to(PACKAGE).with_suffix("").parts
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if parts:
            on_disk.add("lai_processing." + ".".join(parts))
    assert {
        "lai_processing.core.idempotency",
        "lai_processing.core.lifecycle",
        "lai_processing.core.retry",
        "lai_processing.contracts.codec",
        "lai_processing.testing.fakes",
    } <= on_disk
    assert on_disk <= set(report["modules"])


def _violations(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    found: list[str] = []

    def check_module(name: str, line: int) -> None:
        top = name.split(".")[0]
        if top in FORBIDDEN_TOP_LEVEL:
            found.append(f"{line}: imports {name}")
        for forbidden in FORBIDDEN_MODULES:
            if name == forbidden or name.startswith(forbidden + "."):
                found.append(f"{line}: imports {name}")

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                check_module(alias.name, node.lineno)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                check_module(node.module, node.lineno)
                for alias in node.names:
                    check_module(f"{node.module}.{alias.name}", node.lineno)
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in FORBIDDEN_CALLS:
                found.append(f"{node.lineno}: calls {func.id}")
            if isinstance(func, ast.Attribute):
                # `re.compile` is fine; `builtins.compile/eval/exec` are not.
                if func.attr in FORBIDDEN_CALLS and not (
                    func.attr == "compile"
                    and isinstance(func.value, ast.Name)
                    and func.value.id == "re"
                ):
                    found.append(f"{node.lineno}: calls .{func.attr}")
                if isinstance(func.value, ast.Name) and (
                    (func.value.id, func.attr) in FORBIDDEN_ATTRIBUTES
                    or (func.value.id == "os" and func.attr.startswith(("exec", "spawn")))
                ):
                    found.append(f"{node.lineno}: calls {func.value.id}.{func.attr}")
        elif isinstance(node, ast.Name) and node.id in {"__import__", "__builtins__"}:
            found.append(f"{node.lineno}: references {node.id}")
    return found


@pytest.mark.parametrize("path", _package_files(), ids=lambda p: str(p.relative_to(PROCESSING)))
def test_ast_scan_refuses_runtime_imports_and_dynamic_code(path: Path) -> None:
    assert _violations(path) == []


@pytest.mark.parametrize(
    "source",
    [
        "import boto3",
        "from django.conf import settings",
        "import botocore.session",
        "from rest_framework import serializers",
        "import importlib",
        "from importlib import import_module",
        "import pickle",
        "import subprocess",
        "import socket",
        "import urllib.request",
        "from urllib import request",
        "from http.client import HTTPSConnection",
        "import http.client",
        "eval('1')",
        "exec('x = 1')",
        "__import__('os')",
        "builtins.eval('1')",
        "os.system('ls')",
        "os.execv('/bin/sh', [])",
        "import aws_lambda_powertools",
        "import psycopg",
    ],
)
def test_scanner_catches_known_violations(source: str, tmp_path: Path) -> None:
    probe = tmp_path / "probe.py"
    probe.write_text(source + "\n")
    assert _violations(probe), source


def test_package_has_no_non_python_code_or_native_extensions() -> None:
    suffixes = {
        p.suffix for p in PACKAGE.rglob("*") if p.is_file() and "__pycache__" not in p.parts
    }
    assert suffixes <= {".py", ".json", ".txt"}


def test_every_import_is_standard_library_or_the_package_itself() -> None:
    """An allowlist, not only a denylist: a new third-party import fails here even if nobody
    thought to forbid it by name."""
    allowed = set(sys.stdlib_module_names) | {"lai_processing"}
    stray: list[str] = []
    for path in _package_files():
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            stray += [
                f"{path.relative_to(PROCESSING)}: {n}"
                for n in names
                if n.split(".")[0] not in allowed
            ]
    assert stray == []
