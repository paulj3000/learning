"""Checks that need no Pillow: limit parity, the import allowlist, pinned requirements."""

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGE = ROOT / "processing" / "lai_native" / "image"
WORKER = ROOT / "lambda" / "image_worker"
PILLOW = ROOT / "native" / "pillow"


def constant(path: Path, name: str) -> int:
    match = re.search(rf"^{name}\s*=\s*([0-9_ *]+)$", path.read_text(), re.M)
    assert match, name
    return eval(match.group(1), {})  # noqa: S307 - digits, underscores, spaces and * only


def test_limits_equal_the_asset_library_upload_limits():
    upload = ROOT / "lai" / "apps" / "assets" / "validation_media.py"
    limits = IMAGE / "limits.py"
    assert constant(limits, "MAX_IMAGE_SIDE") == constant(upload, "MAX_IMAGE_SIDE")
    assert constant(limits, "MAX_IMAGE_PIXELS") == constant(upload, "MAX_IMAGE_PIXELS")
    # LAI_ASSET_MAX_IMAGE_BYTES default is 10 MiB in validation_media.max_image_bytes
    assert "10 * 1024 * 1024" in upload.read_text().split("def max_image_bytes")[1].split("\n\n")[0]
    assert constant(limits, "MAX_IMAGE_BYTES") == 10 * 1024 * 1024


def imports(path: Path) -> set[str]:
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.add(node.module.split(".")[0])
    return found


def test_image_package_imports_only_stdlib_pillow_and_itself():
    allowed = set(sys.stdlib_module_names) | {"PIL", "__future__"}
    for path in sorted(IMAGE.glob("*.py")):
        extra = imports(path) - allowed
        assert not extra, (path.name, extra)
        text = path.read_text()
        assert (
            not re.search(
                r"\b(subprocess|ctypes|socket|urllib|boto3|django)\b", text.replace("django", "")
            )
            or path.name == "_pil.py"
        )


def test_pillow_is_only_imported_through_the_pil_module_or_the_codec_modules():
    # Every module that touches Pillow does so through `_pil` (one place, one configuration).
    for path in sorted(IMAGE.glob("*.py")):
        assert "PIL" not in imports(path) or path.name == "_pil.py", path.name


def test_worker_never_imports_django_or_forks_the_jobs_plumbing():
    for path in sorted(WORKER.glob("*.py")):
        assert not imports(path) & {"django", "rest_framework", "apps"}, path.name
    handler = (WORKER / "handler.py").read_text()
    assert "from jobs_worker import handler as base" in handler
    assert "def process(" not in handler  # reused, not re-implemented
    assert not (WORKER / "envelope.py").exists()


def test_requirements_are_hash_pinned_and_agree():
    versions = set()
    for name in ("requirements-aarch64.txt", "requirements-x86_64.txt"):
        lines = [
            line.strip()
            for line in (PILLOW / name).read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]
        text = " ".join(lines).replace("\\", " ")
        pins = re.findall(r"^Pillow==(\d+\.\d+\.\d+)\s+--hash=sha256:[0-9a-f]{64}$", text)
        assert len(pins) == 1, (name, text)
        versions.add(pins[0])
    assert len(versions) == 1


def test_native_directory_files_exist():
    for name in (
        "build.py",
        "THIRD_PARTY_NOTICES.md",
        "VULNERABILITIES.md",
        "README.md",
        "sbom-aarch64.cdx.json",
    ):
        assert (PILLOW / name).is_file(), name
