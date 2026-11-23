"""Measure the size of native imaging wheels for the Lambda worker zip (LAI-LAMBDA-013).

Feasibility tooling only. Nothing here is a product dependency: Pillow and pyvips are NOT added
to `requirements*.txt`, to `processing/lai_processing` or to the worker zip.

Without flags the script only prints the plan and the limits it measures against (no network,
no files written):

    python3 scripts/processing/bench/measure_native_wheels.py

With `--download DIR` it runs `pip download` for arm64 / CPython 3.12 wheels into DIR (which must
be new or empty), then measures them:

    python3 scripts/processing/bench/measure_native_wheels.py --download /tmp/<new empty dir>

With `--measure DIR` it measures wheels already in DIR without downloading anything.

Downloaded wheels are untrusted data. They are never extracted, imported or executed: sizes come
from the wheel's zip directory (`zipfile.ZipFile.infolist`). Keep DIR outside the repository and
never commit wheels. The script never publishes, uploads or deploys anything and never calls AWS.

Reported per wheel: compressed size, uncompressed size, shared-library bytes (`.so`), and an
estimate of the bytes the wheel would add to `jobs-worker-<hash16>.zip`, which `lambda/build.py`
writes with ZIP_STORED (uncompressed), so the added bytes are about the uncompressed size plus
per-entry headers.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path

PYTHON_VERSION = "3.12"
IMPLEMENTATION = "cp"
# Lambda python3.12 runs on Amazon Linux 2023 (glibc 2.34). pip only takes wheels whose platform
# tag matches one of these exactly, so list the manylinux levels the runtime can load.
PLATFORMS = (
    "manylinux2014_aarch64",
    "manylinux_2_28_aarch64",
    "manylinux_2_34_aarch64",
)
# Candidate stacks. `--no-deps` keeps the set explicit; dependencies are listed by hand.
CANDIDATES = {
    "pillow": ("pillow",),
    # pyvips is a cffi binding; `pyvips-binary` ships a prebuilt libvips for the platform.
    "pyvips": ("pyvips", "pyvips-binary", "cffi", "pycparser"),
}

# Limits the result is compared with (AWS Lambda quotas; repository budget).
MIB = 1024 * 1024
LAMBDA_ZIP_DIRECT_UPLOAD = 50 * MIB  # zipped, direct upload
LAMBDA_UNZIPPED_LIMIT = 250 * MIB  # function code plus all layers, unzipped
LAMBDA_IMAGE_LIMIT = 10 * 1024 * MIB  # container image, uncompressed
WORKER_ZIP_BUDGET = 2 * MIB  # tests/lambda/test_jobs_worker_package.py ZIP_BUDGET_BYTES
ZIP_ENTRY_OVERHEAD = 30 + 46  # local header plus central directory entry, before the name


@dataclass(frozen=True)
class WheelSize:
    file: str
    compressed_bytes: int
    uncompressed_bytes: int
    shared_library_bytes: int
    shared_library_count: int
    entries: int
    stored_zip_estimate_bytes: int


def measure_wheel(path: Path) -> WheelSize:
    """Sizes from the wheel's directory only; nothing is extracted or imported."""
    uncompressed = so_bytes = so_count = overhead = 0
    with zipfile.ZipFile(path) as wheel:
        infos = [i for i in wheel.infolist() if not i.is_dir()]
        for info in infos:
            uncompressed += info.file_size
            overhead += ZIP_ENTRY_OVERHEAD + 2 * len(info.filename.encode())
            name = info.filename.rsplit("/", 1)[-1]
            if name.endswith(".so") or ".so." in name:
                so_bytes += info.file_size
                so_count += 1
    return WheelSize(
        file=path.name,
        compressed_bytes=path.stat().st_size,
        uncompressed_bytes=uncompressed,
        shared_library_bytes=so_bytes,
        shared_library_count=so_count,
        entries=len(infos),
        stored_zip_estimate_bytes=uncompressed + overhead,
    )


def download(directory: Path, packages: tuple[str, ...]) -> None:
    command = [
        sys.executable,
        "-m",
        "pip",
        "download",
        "--only-binary=:all:",
        "--no-deps",
        "--python-version",
        PYTHON_VERSION,
        "--implementation",
        IMPLEMENTATION,
        "--dest",
        str(directory),
    ]
    for platform in PLATFORMS:
        command += ["--platform", platform]
    # Pure-Python wheels (pyvips, pycparser) are tagged `any`; pip accepts them with --platform.
    command += list(packages)
    print("running:", " ".join(command), file=sys.stderr)
    # pip progress goes to stderr so stdout stays one JSON document.
    subprocess.run(command, check=True, stdout=sys.stderr)  # noqa: S603 - fixed argv, no shell


def belongs(wheel_name: str, package: str) -> bool:
    """A wheel file name starts with its normalised distribution name and a hyphen."""
    return wheel_name.split("-", 1)[0].lower() == package.lower().replace("-", "_")


def report(directory: Path) -> dict:
    wheels = sorted(directory.glob("*.whl"))
    sizes = {w.name: measure_wheel(w) for w in wheels}
    stacks = {}
    for stack, packages in CANDIDATES.items():
        members = [s for name, s in sizes.items() if any(belongs(name, p) for p in packages)]
        stored = sum(m.stored_zip_estimate_bytes for m in members)
        stacks[stack] = {
            "wheels": [asdict(m) for m in members],
            "compressed_bytes": sum(m.compressed_bytes for m in members),
            "uncompressed_bytes": sum(m.uncompressed_bytes for m in members),
            "stored_zip_estimate_bytes": stored,
            "fits_worker_budget_2mib": stored < WORKER_ZIP_BUDGET,
            "fits_lambda_250mib_unzipped": stored < LAMBDA_UNZIPPED_LIMIT,
            "fits_lambda_50mib_zip": stored < LAMBDA_ZIP_DIRECT_UPLOAD,
        }
    return {
        "measured": True,
        "directory": str(directory),
        "python": PYTHON_VERSION,
        "platforms": list(PLATFORMS),
        "limits": limits(),
        "stacks": stacks,
    }


def limits() -> dict:
    return {
        "worker_zip_budget_bytes": WORKER_ZIP_BUDGET,
        "lambda_zip_direct_upload_bytes": LAMBDA_ZIP_DIRECT_UPLOAD,
        "lambda_unzipped_bytes": LAMBDA_UNZIPPED_LIMIT,
        "lambda_container_image_bytes": LAMBDA_IMAGE_LIMIT,
    }


def plan() -> dict:
    return {
        "measured": False,
        "note": "Dry run: nothing downloaded. Pass --download <new empty dir> to measure.",
        "python": PYTHON_VERSION,
        "platforms": list(PLATFORMS),
        "candidates": {k: list(v) for k, v in CANDIDATES.items()},
        "limits": limits(),
    }


def _empty_or_new(raw: str) -> Path:
    path = Path(raw).expanduser().resolve()
    repository = Path(__file__).resolve().parents[3]
    if path == repository or repository in path.parents:
        raise argparse.ArgumentTypeError(
            "download outside the repository (wheels are never committed)"
        )
    if path.exists() and any(path.iterdir()):
        raise argparse.ArgumentTypeError(f"{path} must be new or empty")
    return path


def _existing(raw: str) -> Path:
    path = Path(raw).expanduser().resolve()
    if not path.is_dir():
        raise argparse.ArgumentTypeError(f"{path} is not a directory")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--download", type=_empty_or_new, metavar="DIR")
    group.add_argument("--measure", type=_existing, metavar="DIR")
    parser.add_argument(
        "--stack", choices=sorted(CANDIDATES), action="append", help="limit the download"
    )
    args = parser.parse_args(argv)
    if args.download is None and args.measure is None:
        print(json.dumps(plan(), indent=2))
        return 0
    directory = args.measure
    if args.download is not None:
        directory = args.download
        directory.mkdir(parents=True, exist_ok=True)
        for stack in args.stack or sorted(CANDIDATES):
            download(directory, CANDIDATES[stack])
    print(json.dumps(report(directory), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
