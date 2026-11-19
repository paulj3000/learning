"""Build the jobs worker zip deterministically (used by scripts/aws/package-lambda.sh).

    python3 lambda/build.py --out build/lambda      # prints build/lambda/jobs-worker-<hash16>.zip

The zip holds `jobs_worker/` plus code vendored from the Django project:
`jobs_worker/vendor/jobs_core/` (lai/apps/jobs/core) and `jobs_worker/vendor/ai_providers/`
(lai/apps/ai/providers/base.py and bedrock.py, with an empty package `__init__`). Vendored files
must not import Django or `apps.*`; the build refuses if they do. Entries are sorted, timestamps
fixed, permissions normalised and nothing compressed, so the same sources always give the same
bytes and name.
"""

import argparse
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
    "jobs_worker/vendor/ai_providers/__init__.py": None,
    "jobs_worker/vendor/ai_providers/base.py": ROOT / "lai/apps/ai/providers/base.py",
    "jobs_worker/vendor/ai_providers/bedrock.py": ROOT / "lai/apps/ai/providers/bedrock.py",
}
_FORBIDDEN_IMPORT = re.compile(r"^\s*(?:from|import)\s+(?:django|apps|rest_framework)\b", re.M)


class BuildError(RuntimeError):
    pass


def entries() -> dict[str, bytes]:
    """Archive path -> bytes, for every file in the zip."""
    files: dict[str, bytes] = {}
    for path in sorted(WORKER.rglob("*.py")):
        relative = path.relative_to(WORKER.parent).as_posix()
        if "/vendor/" in relative or "__pycache__" in relative:
            continue
        files[relative] = path.read_bytes()
    for archive_path, source in VENDORED.items():
        if source is None:
            files[archive_path] = VENDOR_PACKAGE_INIT.encode()
            continue
        data = source.read_bytes()
        if _FORBIDDEN_IMPORT.search(data.decode("utf-8")):
            raise BuildError(f"{archive_path} would vendor a Django or apps.* import")
        files[archive_path] = data
    return files


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
