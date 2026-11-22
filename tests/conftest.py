"""Session checks for the repository tests (tests/).

With LAI_REQUIRE_HOST_TOOLS=1 (GitHub CI and the EC2 runner) a missing host tool stops the
session instead of letting the tests that need it skip (GE-090; scripts/ci/host_tools.py).
"""

import importlib.util
import os
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "lai_host_tools", Path(__file__).resolve().parents[1] / "scripts/ci/host_tools.py"
)
assert _SPEC and _SPEC.loader
host_tools = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(host_tools)


def pytest_sessionstart(session):
    if os.environ.get("LAI_REQUIRE_HOST_TOOLS") != "1":
        return
    absent = host_tools.missing()
    if absent:
        pytest.exit(
            f"LAI_REQUIRE_HOST_TOOLS=1 but these host tools are missing: {', '.join(absent)} "
            "(install them with scripts/ci/host_tools.py; see its docstring)",
            returncode=3,
        )
