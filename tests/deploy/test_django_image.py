"""lai/Dockerfile and .dockerignore: the Django image carries the processing library beside lai/.

Django's settings put `<BASE_DIR>/../processing` on sys.path (ADR-064); in the image BASE_DIR is
/app/lai, so the library must sit at /app/processing/lai_processing. Static checks only: no
image is built here.
"""

import fnmatch
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = (ROOT / "lai" / "Dockerfile").read_text()
IGNORE = [
    line.strip()
    for line in (ROOT / ".dockerignore").read_text().splitlines()
    if line.strip() and not line.startswith("#")
]


def ignored(path: str) -> bool:
    """`.dockerignore` semantics for the plain patterns this file uses (last match wins)."""
    result = False
    for pattern in IGNORE:
        negate = pattern.startswith("!")
        pattern = pattern.removeprefix("!").removeprefix("**/")
        parts = path.split("/")
        prefixes = ["/".join(parts[: i + 1]) for i in range(len(parts))]
        if any(fnmatch.fnmatch(p, pattern) for p in prefixes) or any(
            fnmatch.fnmatch(part, pattern) for part in parts
        ):
            result = not negate
    return result


def test_the_image_copies_the_processing_library_beside_lai():
    assert re.search(r"^WORKDIR /app$", DOCKERFILE, re.M)
    copies = re.findall(r"^COPY (\S+) (\S+)$", DOCKERFILE, re.M)
    assert ("lai/", "./lai/") in copies
    assert ("processing/lai_processing/", "./processing/lai_processing/") in copies
    # Copied while the working directory is still /app, before WORKDIR /app/lai.
    assert DOCKERFILE.index("COPY processing/") < DOCKERFILE.index("WORKDIR /app/lai")


def test_settings_resolve_the_processing_directory_beside_lai():
    settings = (ROOT / "lai" / "config" / "settings" / "base.py").read_text()
    assert "BASE_DIR = Path(__file__).resolve().parent.parent.parent  # lai/" in settings
    assert 'PROCESSING_DIR = BASE_DIR.parent / "processing"' in settings


def test_the_build_context_keeps_the_library_and_drops_its_fixtures():
    for kept in (
        "processing/lai_processing/__init__.py",
        "processing/lai_processing/core/execution.py",
        "processing/lai_processing/processors/gltf/processor.py",
        "lai/manage.py",
    ):
        assert not ignored(kept), kept
    assert ignored("processing/lai_processing/contracts/fixtures/request.reference.json")
    assert ignored("processing/lai_processing/core/__pycache__/execution.cpython-312.pyc")
