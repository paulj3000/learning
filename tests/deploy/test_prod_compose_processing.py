"""The prod compose project runs the processing dispatcher and completion consumer (ADR-037,
ADR-062; docs/infrastructure/processing-infrastructure.md, section 10).

With LAI_PROCESSING_BACKEND=sqs something must run `manage.py jobs_dispatch` and
`manage.py jobs_consume_completions` next to Django, as the native dev units do. The commands exit
0 at once while the backend is `disabled`, so the services wrap them in a gate that idles instead
(an exited service would fail `up --wait` or hot-loop under its restart policy).
"""

import os
import signal
import subprocess
import time
from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

REPO = Path(__file__).resolve().parents[2]
COMPOSE = yaml.safe_load((REPO / "deploy/ec2/docker-compose.yml").read_text())
SERVICES = COMPOSE["services"]
PROCESSING = {"jobs-dispatch": "jobs_dispatch", "jobs-completions": "jobs_consume_completions"}


@pytest.mark.parametrize("name", PROCESSING)
def test_processing_services_run_the_django_release_without_a_port(name):
    service, django = SERVICES[name], SERVICES["django"]
    assert service["image"] == django["image"]
    assert service["env_file"] == django["env_file"]
    assert service["environment"]["DJANGO_SETTINGS_MODULE"] == "config.settings.production"
    assert service["restart"] == "unless-stopped"
    assert "ports" not in service and "expose" not in service
    # The image's HEALTHCHECK probes gunicorn, which these containers never start.
    assert service["healthcheck"] == {"disable": True}
    assert service["read_only"] is True
    assert service["cap_drop"] == ["ALL"]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert service["volumes"] == django["volumes"]  # the RDS CA bundle (verify-full)
    assert service["networks"] == ["app"]
    assert service["logging"]["options"]["awslogs-group"] == "${LAI_APP_LOG_GROUP:?}"
    assert service["command"][:2] == ["sh", "-c"]
    assert service["command"][3] == PROCESSING[name]


def gate(tmp_path: Path, backend: str | None, command: str) -> subprocess.Popen:
    """Run the compose command's shell gate as compose would hand it to the container."""
    script = SERVICES["jobs-dispatch"]["command"][2].replace("$$", "$")
    fake = tmp_path / "bin"
    fake.mkdir(exist_ok=True)
    (fake / "python").write_text(f'#!/bin/sh\necho "python $*" > "{tmp_path}/ran"\n')
    (fake / "python").chmod(0o755)
    env = {"PATH": f"{fake}:{os.environ['PATH']}"}
    if backend is not None:
        env["LAI_PROCESSING_BACKEND"] = backend
    out = (tmp_path / "out").open("w")
    return subprocess.Popen(["sh", "-c", script, command], env=env, stdout=out)


def test_the_gate_runs_the_command_when_the_backend_is_sqs(tmp_path):
    process = gate(tmp_path, "sqs", "jobs_consume_completions")
    assert process.wait(timeout=10) == 0
    assert (tmp_path / "ran").read_text().strip() == "python manage.py jobs_consume_completions"


@pytest.mark.parametrize("backend", [None, "disabled", "inline"])
def test_the_gate_idles_until_stopped_when_the_backend_is_not_sqs(tmp_path, backend):
    process = gate(tmp_path, backend, "jobs_dispatch")
    time.sleep(0.5)
    assert process.poll() is None, "an idle service must keep running"
    process.send_signal(signal.SIGTERM)
    assert process.wait(timeout=10) == 0
    assert not (tmp_path / "ran").exists()
    assert "idles" in (tmp_path / "out").read_text()
