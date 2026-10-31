"""The image entry point (lai/docker-entrypoint.sh): serve by default, run one-off tasks as given.

A release runs `migrate`, `check --deploy` and the bootstrap tasks with `docker compose run django
python manage.py ...`; if the entry point ignored its arguments those would start gunicorn and
never finish (found by the local end-to-end run, ADR-037).
"""

import os
import stat
import subprocess
from pathlib import Path

ENTRYPOINT = Path(__file__).resolve().parents[2] / "lai/docker-entrypoint.sh"


def run(tmp_path: Path, *args: str, **env: str) -> subprocess.CompletedProcess:
    fake = tmp_path / "gunicorn"
    fake.write_text('#!/bin/sh\necho "gunicorn $*"\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return subprocess.run(
        ["sh", str(ENTRYPOINT), *args],
        env={**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", **env},
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )


def test_without_arguments_it_serves_with_gunicorn(tmp_path):
    out = run(tmp_path, FORWARDED_ALLOW_IPS="172.30.10.0/24").stdout
    assert out.startswith("gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2")
    assert "--forwarded-allow-ips 172.30.10.0/24" in out
    assert "access" not in out  # no access log (ADR-025)


def test_with_arguments_it_runs_that_command_instead(tmp_path):
    out = run(tmp_path, "echo", "manage.py", "migrate").stdout
    assert out == "manage.py migrate\n"
