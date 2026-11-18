"""Repository guard (independent of lambda/build.py): native code stays inside
`processing/lai_native`. No other Python package in the repository imports PIL, and `subprocess`
and `ctypes` appear only in `lai_native` (plus the existing tooling that already ran processes:
Django management, scripts and tests). `lai_processing` and `lambda/jobs_worker` never import
`lai_native`; the native workers (`lambda/<name>_worker`) may call `lai_native` but never a native
library or process execution directly."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PURE = [ROOT / "processing" / "lai_processing", ROOT / "lambda" / "jobs_worker"]
NATIVE_WORKERS = [p for p in sorted((ROOT / "lambda").glob("*_worker")) if p.name != "jobs_worker"]
GUARDED = [(root, {"lai_native", "PIL", "subprocess", "ctypes"}) for root in PURE] + [
    (root, {"PIL", "subprocess", "ctypes"}) for root in NATIVE_WORKERS
]


def imports(path: Path) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text("utf-8"))):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    return names


def test_pure_and_worker_packages_never_import_native_code():
    offenders = []
    for root, banned in GUARDED:
        for path in root.rglob("*.py"):
            if "__pycache__" in path.parts:
                continue
            bad = imports(path) & banned
            if bad:
                offenders.append(f"{path.relative_to(ROOT)}: {sorted(bad)}")
    assert offenders == []


def test_pil_is_imported_only_inside_lai_native():
    offenders = []
    for root in (ROOT / "lai", ROOT / "processing", ROOT / "lambda"):
        for path in root.rglob("*.py"):
            if "__pycache__" in path.parts or "lai_native" in path.parts:
                continue
            if "PIL" in imports(path):
                offenders.append(str(path.relative_to(ROOT)))
    assert offenders == []
