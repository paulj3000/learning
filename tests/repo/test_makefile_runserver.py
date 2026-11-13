"""`make runserver` defaults AWS_PROFILE to learning-dev and allows an override.

PY is pointed at a stub that prints its environment and arguments, so no Django server starts.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(shutil.which("make") is None, reason="make is not installed")


def _run(tmp_path: Path, *args: str, env_profile: str | None = None) -> list[str]:
    stub = tmp_path / "fake-python"
    stub.write_text(
        '#!/bin/sh\necho "AWS_PROFILE=${AWS_PROFILE:-<unset>}"\necho "CWD=$(pwd)"\necho "ARGS=$*"\n'
    )
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
    env = {k: v for k, v in os.environ.items() if k != "AWS_PROFILE"}
    if env_profile is not None:
        env["AWS_PROFILE"] = env_profile
    result = subprocess.run(
        [
            "make",
            "-s",
            "-C",
            str(ROOT),
            "runserver",
            f"PY={stub}",
            f"ENV_FILE={tmp_path / 'none.env'}",
            *args,
        ],
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.splitlines()


def test_runserver_defaults_to_learning_dev_profile(tmp_path):
    out = _run(tmp_path)
    assert "AWS_PROFILE=learning-dev" in out
    assert f"CWD={ROOT / 'lai'}" in out
    # Development ports (owner, 2026-11-05): runserver binds 127.0.0.1:$(DJANGO_DEV_PORT), 8010.
    assert "ARGS=manage.py runserver 127.0.0.1:8010" in out


def test_runserver_profile_can_be_overridden_on_command_line(tmp_path):
    assert "AWS_PROFILE=alternate" in _run(tmp_path, "AWS_PROFILE=alternate")


def test_runserver_keeps_profile_exported_in_shell(tmp_path):
    assert "AWS_PROFILE=from-shell" in _run(tmp_path, env_profile="from-shell")


def test_aws_profile_default_is_scoped_to_runserver(tmp_path):
    makefile = (ROOT / "Makefile").read_text()
    assert "runserver: export AWS_PROFILE ?= learning-dev" in makefile
    assert makefile.count("AWS_PROFILE ?=") == 1


def test_runserver_port_comes_from_dotenv(tmp_path):
    # P0: DJANGO_DEV_PORT in the root .env moves runserver and the Vite proxy together.
    (tmp_path / "ports.env").write_text("DJANGO_DEV_PORT=8000\n")
    out = _run(tmp_path, f"ENV_FILE={tmp_path / 'ports.env'}")
    assert "ARGS=manage.py runserver 127.0.0.1:8000" in out


def test_runserver_port_on_command_line_wins_over_dotenv(tmp_path):
    (tmp_path / "ports.env").write_text("DJANGO_DEV_PORT=8000\n")
    out = _run(tmp_path, f"ENV_FILE={tmp_path / 'ports.env'}", "DJANGO_DEV_PORT=8123")
    assert "ARGS=manage.py runserver 127.0.0.1:8123" in out


def test_web_target_proxies_to_the_same_port(tmp_path):
    (tmp_path / "ports.env").write_text("DJANGO_DEV_PORT=8000\n")
    result = subprocess.run(
        ["make", "-n", "-s", "-C", str(ROOT), "web", f"ENV_FILE={tmp_path / 'ports.env'}"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "DJANGO_DEV_PORT=8000 npm run dev" in result.stdout
