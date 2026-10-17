"""Tooling-level checks for LAI-0202: they guard Python setup reproducibility, not app behaviour."""

import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_pyproject_declares_python_312_tooling():
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert config["project"]["requires-python"] == ">=3.12"
    assert config["tool"]["ruff"]["target-version"] == "py312"
    assert config["tool"]["pytest"]["ini_options"]["testpaths"] == ["tests"]


def test_requirements_are_exactly_pinned():
    for name in ("requirements.txt", "requirements-dev.txt"):
        for raw in (ROOT / name).read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith(("#", "-r ")):
                continue
            assert re.fullmatch(r"[A-Za-z0-9_.\-\[\]]+==[0-9][0-9A-Za-z.\-]*", line), (
                f"{name}: '{line}' is not pinned with =="
            )


def test_python_version_file_matches_pyproject():
    assert (ROOT / ".python-version").read_text().strip() == "3.12"
