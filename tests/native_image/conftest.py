"""Tests for `lai_native.image`. The image conversion tests need Pillow, which is not in the
project's shared virtualenv; they skip cleanly there and run in a venv with the pinned wheel
(`native/pillow/requirements-x86_64.txt`): each such module starts with `pytest.importorskip`."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for extra in (ROOT / "processing",):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))
