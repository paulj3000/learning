"""Build the audio worker zip deterministically, and check the FFmpeg layer zip beside it.

    python3 lambda/audio_worker/build.py --out build/lambda \
        [--layer build/ffmpeg/lai-ffmpeg-layer-aarch64.zip]

The function zip holds everything `lambda/build.py` puts in the jobs worker zip (`jobs_worker/`
with its vendored core, and `lai_processing`), plus `audio_worker/` and the two packages of
`lai_native` this function needs (`runtime/` and `audio/`). It never contains a native binary:
FFmpeg lives in the separate layer (native/ffmpeg/build.py), mounted at /opt. Entries are
sorted, timestamps fixed, nothing compressed, so the same sources give the same bytes and name.

`lambda/build.py` is imported, not edited or copied (it is owned by the jobs worker).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "lambda" / "audio_worker"
NATIVE = ROOT / "processing" / "lai_native"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)
#: lai_native subpackages shipped with this function (not image, optimize or others).
NATIVE_SHIPPED = ("runtime", "audio")
LAYER_REQUIRED = (
    "bin/ffmpeg",
    "share/lai-ffmpeg/NOTICE.txt",
    "share/lai-ffmpeg/sbom.cdx.json",
    "share/lai-ffmpeg/build-record.json",
)
LAYER_MAX_ZIPPED = 50 * 1024 * 1024  # a layer is at most 250 MB unzipped; this one is tiny


class BuildError(RuntimeError):
    pass


def _jobs_build():
    spec = importlib.util.spec_from_file_location("lai_jobs_build", ROOT / "lambda" / "build.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def entries() -> dict[str, bytes]:
    files = dict(_jobs_build().entries())
    for path in sorted(WORKER.glob("*.py")):
        if path.name == "build.py":
            continue
        files[f"audio_worker/{path.name}"] = path.read_bytes()
    files["lai_native/__init__.py"] = (NATIVE / "__init__.py").read_bytes()
    for package in NATIVE_SHIPPED:
        for path in sorted((NATIVE / package).rglob("*.py")):
            relative = path.relative_to(NATIVE.parent).as_posix()
            if "__pycache__" in relative:
                continue
            files[relative] = path.read_bytes()
    # The import policies of lambda/build.py (the same audit native/pillow/build.py runs): the
    # shipped lai_native and audio_worker sources only import what their package family allows.
    shipped = [NATIVE.parent / n for n in files if n.startswith("lai_native/")]
    shipped += [WORKER.parent / n for n in files if n.startswith("audio_worker/")]
    violations = _jobs_build().audit_imports(shipped)
    if violations:
        raise BuildError(f"import policy: {violations[0]}")
    return files


def stage(destination: Path) -> Path:
    for archive_path, data in entries().items():
        target = destination / archive_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return destination


def zip_bytes() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for archive_path, data in sorted(entries().items()):
            info = zipfile.ZipInfo(archive_path, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED
            info.external_attr = (0o100644 & 0xFFFF) << 16
            info.create_system = 3
            archive.writestr(info, data)
    return buffer.getvalue()


def check_layer(path: Path) -> dict:
    """Validate a layer zip's layout and recorded facts; return the build record."""
    if path.stat().st_size > LAYER_MAX_ZIPPED:
        raise BuildError("layer zip is unexpectedly large")
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        missing = [n for n in LAYER_REQUIRED if n not in names]
        if missing:
            raise BuildError(f"layer is missing {missing}")
        for name in names:
            if name.startswith(("/", "..")) or "/../" in name:
                raise BuildError("unsafe path in layer")
        record = json.loads(archive.read("share/lai-ffmpeg/build-record.json"))
        sbom = json.loads(archive.read("share/lai-ffmpeg/sbom.cdx.json"))
        binary = archive.read("bin/ffmpeg")
    configuration = record.get("ffmpeg_configuration", "")
    for flag in ("--enable-gpl", "--enable-nonfree", "--enable-version3"):
        if flag in configuration:
            raise BuildError("layer was built with a non-LGPL configuration")
    if hashlib.sha256(binary).hexdigest() != record["files_sha256"]["bin/ffmpeg"]:
        raise BuildError("ffmpeg does not match its build record")
    if sbom.get("bomFormat") != "CycloneDX":
        raise BuildError("layer SBOM is not CycloneDX")
    return record


def build(out_dir: Path) -> Path:
    data = zip_bytes()
    digest = hashlib.sha256(data).hexdigest()[:16]
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"audio-worker-{digest}.zip"
    target.write_bytes(data)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "build" / "lambda"))
    parser.add_argument("--layer", help="a layer zip from native/ffmpeg/build.py to validate")
    args = parser.parse_args(argv)
    try:
        if args.layer:
            record = check_layer(Path(args.layer))
            print(f"layer ok: {record['ffmpeg_version_line']} ({record['arch']})")
        print(build(Path(args.out)))
    except BuildError as error:
        print(f"package-audio-worker: {error}", file=sys.stderr)
        return 10
    return 0


if __name__ == "__main__":
    sys.exit(main())
