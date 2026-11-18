"""Build the jobs worker zip deterministically (used by scripts/aws/package-lambda.sh).

    python3 lambda/build.py --out build/lambda      # prints build/lambda/jobs-worker-<hash16>.zip

The zip holds `jobs_worker/` plus code vendored from the Django project:
`jobs_worker/vendor/jobs_core/` (lai/apps/jobs/core) and `jobs_worker/vendor/ai_providers/`
(lai/apps/ai/providers/base.py and bedrock.py, with an empty package `__init__`), and the
standard-library `lai_processing` package at the zip root (processing/lai_processing, without its
`testing`, `cli` and `__main__` modules; ADR-064 contract kinds, core/contract.py). Vendored files
must not import Django or `apps.*`; the build refuses if they do. Entries are sorted, timestamps
fixed, permissions normalised and nothing compressed, so the same sources always give the same
bytes and name.
"""

import argparse
import ast
import hashlib
import io
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKER = ROOT / "lambda" / "jobs_worker"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
VENDOR_PACKAGE_INIT = '"""Code vendored from the Django project at package time. Do not edit."""\n'

#: Archive path -> source file. The worker's own files are added from WORKER.
VENDORED = {
    "jobs_worker/vendor/__init__.py": None,
    "jobs_worker/vendor/jobs_core/__init__.py": ROOT / "lai/apps/jobs/core/__init__.py",
    "jobs_worker/vendor/jobs_core/envelope.py": ROOT / "lai/apps/jobs/core/envelope.py",
    "jobs_worker/vendor/jobs_core/probe.py": ROOT / "lai/apps/jobs/core/probe.py",
    "jobs_worker/vendor/jobs_core/tasks.py": ROOT / "lai/apps/jobs/core/tasks.py",
    "jobs_worker/vendor/jobs_core/contract.py": ROOT / "lai/apps/jobs/core/contract.py",
    "jobs_worker/vendor/ai_providers/__init__.py": None,
    "jobs_worker/vendor/ai_providers/base.py": ROOT / "lai/apps/ai/providers/base.py",
    "jobs_worker/vendor/ai_providers/bedrock.py": ROOT / "lai/apps/ai/providers/bedrock.py",
}
#: The processing library, vendored at the zip root so `import lai_processing` works in Lambda.
PROCESSING = ROOT / "processing" / "lai_processing"
#: Not shipped: test fakes, the command-line interface and its `python -m` entry point.
PROCESSING_EXCLUDED = (
    "lai_processing/testing/",
    "lai_processing/cli/",
    "lai_processing/__main__.py",
)
_FORBIDDEN_IMPORT = re.compile(r"^\s*(?:from|import)\s+(?:django|apps|rest_framework)\b", re.M)


class BuildError(RuntimeError):
    pass


# --- import policy -----------------------------------------------------------------------------
# Distinct allowlists per package family (Workstream B, 2026-11-18). A top-level module a file
# imports must be in its family's `allowed` set (standard library included where `stdlib`), and
# never in `forbidden`. Relative imports stay inside the package and are always fine. Native code
# (subprocess, ctypes, PIL) lives ONLY in `processing/lai_native`; `lai_processing` and every
# worker package must stay free of it, so a pure library or an I/O adapter can never gain a native
# dependency by accident. Add a new native worker by naming it under `lambda/<name>_worker`: it is
# classified `native_worker` automatically.

#: Native libraries a `native` package may import (approve a new one here, in review).
APPROVED_NATIVE_LIBRARIES = frozenset({"PIL"})
#: Never allowed outside `lai_native`: process execution, foreign function calls, serialization
#: of code, dynamic loading and raw sockets.
EXECUTION_MODULES = frozenset(
    {"subprocess", "ctypes", "multiprocessing", "pickle", "marshal", "shelve", "importlib"}
)
NETWORK_MODULES = frozenset(
    {"socket", "ftplib", "smtplib", "xmlrpc", "http.client", "urllib.request"}
)
_SERVICES = frozenset({"django", "apps", "rest_framework", "psycopg", "psycopg2"})
_AWS = frozenset({"boto3", "botocore"})

IMPORT_POLICIES = {
    # Pure library: standard library plus itself. Nothing native, no AWS, no Django.
    "processing": {
        "stdlib": True,
        "allowed": {"lai_processing"},
        "forbidden": {"lai_native", *APPROVED_NATIVE_LIBRARIES, *_AWS, *_SERVICES}
        | EXECUTION_MODULES
        | NETWORK_MODULES,
    },
    # `jobs_worker` and the code vendored into it: standard library, boto3 and botocore, the pure
    # library. Never the native package or a native library.
    "jobs_worker": {
        "stdlib": True,
        "allowed": {"jobs_worker", "lai_processing", *_AWS},
        "forbidden": {"lai_native", *APPROVED_NATIVE_LIBRARIES, *_SERVICES}
        | (EXECUTION_MODULES - {"importlib"}),
    },
    # Future `lambda/<name>_worker` packages: they call `lai_native` and AWS, never a native
    # library or subprocess directly.
    "native_worker": {
        "stdlib": True,
        "allowed": {"lai_processing", "lai_native", *_AWS},  # plus their own package name
        "forbidden": {*APPROVED_NATIVE_LIBRARIES, *_SERVICES} | (EXECUTION_MODULES - {"importlib"}),
    },
    # The native package: its own tools and approved libraries, the pure library; no AWS.
    "native": {
        "stdlib": True,
        "allowed": {"lai_native", "lai_processing", *APPROVED_NATIVE_LIBRARIES},
        "forbidden": {"jobs_worker", *_AWS, *_SERVICES},
    },
}


def _stdlib() -> frozenset[str]:
    return frozenset(sys.stdlib_module_names)


def import_violations(source: str, policy: str, *, package: str = "") -> list[str]:
    """Imports in `source` that `IMPORT_POLICIES[policy]` forbids, as `line: reason` strings.

    `package` is the file's own top-level package name (allowed for its own absolute imports).
    Constant `__import__` / `importlib.import_module` targets are checked like imports."""
    rules = IMPORT_POLICIES[policy]
    allowed = set(rules["allowed"]) | ({package} if package else set())
    forbidden = rules["forbidden"]
    stdlib = _stdlib()
    found: list[str] = []

    def check(name: str, line: int) -> None:
        top = name.split(".")[0]
        if any(name == f or name.startswith(f + ".") for f in forbidden) or top in forbidden:
            found.append(f"{line}: imports {name} (forbidden for {policy})")
        elif top not in allowed and not (rules["stdlib"] and top in stdlib):
            found.append(f"{line}: imports {name} (not on the {policy} allowlist)")

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return ["0: not valid Python"]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                check(alias.name, node.lineno)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                check(node.module, node.lineno)
        elif isinstance(node, ast.Call) and node.args:
            func, first = node.func, node.args[0]
            dynamic = (isinstance(func, ast.Name) and func.id == "__import__") or (
                isinstance(func, ast.Attribute) and func.attr == "import_module"
            )
            if dynamic and isinstance(first, ast.Constant) and isinstance(first.value, str):
                check(first.value, node.lineno)
    return found


def classify_package(path: Path) -> tuple[str, str] | None:
    """(policy, own package) for a repository path, or None when it is not guarded."""
    parts = path.resolve().relative_to(ROOT).parts
    if parts[:2] == ("processing", "lai_processing"):
        return "processing", "lai_processing"
    if parts[:2] == ("processing", "lai_native"):
        return "native", "lai_native"
    if len(parts) > 2 and parts[0] == "lambda" and parts[1].endswith("_worker"):
        return ("jobs_worker" if parts[1] == "jobs_worker" else "native_worker"), parts[1]
    return None


def guarded_files() -> list[Path]:
    """Every Python file under a guarded package (`lai_processing`, `lai_native` and each
    `lambda/*_worker`), vendored copies excluded."""
    roots = [ROOT / "processing" / "lai_processing", ROOT / "processing" / "lai_native"]
    roots += sorted((ROOT / "lambda").glob("*_worker"))
    files = []
    for root in roots:
        for path in sorted(root.rglob("*.py")):
            if "__pycache__" not in path.parts and "vendor" not in path.relative_to(root).parts:
                files.append(path)
    return files


def audit_imports(files: list[Path] | None = None) -> list[str]:
    """Violations (`path:line: reason`) across the guarded packages. Empty when clean."""
    out = []
    for path in files if files is not None else guarded_files():
        classified = classify_package(path)
        if classified is None:
            continue
        policy, package = classified
        for finding in import_violations(path.read_text("utf-8"), policy, package=package):
            out.append(f"{path.relative_to(ROOT).as_posix()}:{finding}")
    return out


def entries() -> dict[str, bytes]:
    """Archive path -> bytes, for every file in the zip."""
    files: dict[str, bytes] = {}
    for path in sorted(WORKER.rglob("*.py")):
        relative = path.relative_to(WORKER.parent).as_posix()
        if "/vendor/" in relative or "__pycache__" in relative:
            continue
        data = path.read_bytes()
        _enforce(relative, data, "jobs_worker", "jobs_worker")
        files[relative] = data
    for archive_path, source in VENDORED.items():
        if source is None:
            files[archive_path] = VENDOR_PACKAGE_INIT.encode()
            continue
        data = source.read_bytes()
        if _FORBIDDEN_IMPORT.search(data.decode("utf-8")):
            raise BuildError(f"{archive_path} would vendor a Django or apps.* import")
        _enforce(archive_path, data, "jobs_worker", "jobs_worker")
        files[archive_path] = data
    for path in sorted(PROCESSING.rglob("*.py")):
        archive_path = path.relative_to(PROCESSING.parent).as_posix()
        if "__pycache__" in archive_path or archive_path.startswith(PROCESSING_EXCLUDED):
            continue
        data = path.read_bytes()
        if _FORBIDDEN_IMPORT.search(data.decode("utf-8")):
            raise BuildError(f"{archive_path} would vendor a Django or apps.* import")
        _enforce(archive_path, data, "processing", "lai_processing")
        files[archive_path] = data
    return files


def _enforce(archive_path: str, data: bytes, policy: str, package: str) -> None:
    found = import_violations(data.decode("utf-8"), policy, package=package)
    if found:
        raise BuildError(f"{archive_path} breaks the {policy} import policy: {found[0]}")


def stage(destination: Path) -> Path:
    """Write the zip's tree to a directory (tests import the worker from here)."""
    for archive_path, data in entries().items():
        target = destination / archive_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return destination


def zip_bytes() -> bytes:
    buffer = io.BytesIO()
    # Stored, not deflated: compressed bytes can differ between zlib builds, and the name is a
    # hash of the bytes. The worker is small source code, so the size cost is negligible.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for archive_path, data in sorted(entries().items()):
            info = zipfile.ZipInfo(archive_path, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.create_system = 3
            archive.writestr(info, data)
    return buffer.getvalue()


def build(out_dir: Path) -> Path:
    data = zip_bytes()
    digest = hashlib.sha256(data).hexdigest()[:16]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"jobs-worker-{digest}.zip"
    target.write_bytes(data)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "build" / "lambda"))
    args = parser.parse_args(argv)
    try:
        path = build(Path(args.out))
    except BuildError as error:
        print(f"package-lambda: {error}", file=sys.stderr)
        return 10
    print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
