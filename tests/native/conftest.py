"""Tests for `processing/lai_native` (native tool steps). The synthetic GLB builders live with
the processing tests; make them importable here. Real-tool tests skip unless the tool path
environment variable is set (`native/gltf/fetch-tools.sh` prints them)."""

import sys
from pathlib import Path

_PROCESSING_TESTS = Path(__file__).resolve().parents[1] / "processing"
if str(_PROCESSING_TESTS) not in sys.path:
    sys.path.insert(0, str(_PROCESSING_TESTS))


def pytest_configure(config):  # type: ignore[no-untyped-def]
    config.addinivalue_line(
        "markers", "real_preparer: keep the production texture preparer (Pillow when installed)"
    )
