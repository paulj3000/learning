"""`lai_native` may import only the standard library, itself, `lai_processing` and the approved
native libraries (`lambda/build.py` APPROVED_NATIVE_LIBRARIES: Pillow); and
`lai_processing` stays free of process execution and native imports."""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "processing"
ALLOWED_TOP = set(sys.stdlib_module_names) | {"lai_native", "lai_processing", "PIL"}
BANNED_IN_PROCESSING = {"subprocess", "ctypes", "cffi", "multiprocessing"}


def _imports(path: Path):
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.module.split(".")[0]


def test_lai_native_imports_are_allowlisted():
    bad = {}
    # The audio and runtime packages are standard library only; other native packages (image,
    # optimize) have their own approved libraries (policy: lambda/build.py import_violations).
    paths = [*(ROOT / "lai_native" / "audio").rglob("*.py"), *(ROOT / "lai_native" / "runtime").rglob("*.py")]
    for path in paths:
        extra = set(_imports(path)) - ALLOWED_TOP
        if extra:
            bad[path.name] = extra
    assert not bad


def test_lai_processing_has_no_process_or_native_imports():
    bad = {}
    for path in (ROOT / "lai_processing").rglob("*.py"):
        found = set(_imports(path)) & BANNED_IN_PROCESSING
        if found:
            bad[str(path.relative_to(ROOT))] = found
    assert not bad
