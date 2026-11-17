"""Runtime independence, telemetry privacy and the Lambda image definition."""

from __future__ import annotations

import ast
import io
import json
import logging
import os
import re
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from lai_processing_runtime.telemetry import JsonLogTelemetry

REPO = Path(__file__).resolve().parents[2]
PROCESSING = REPO / "processing"
RUNTIME = PROCESSING / "lai_processing_runtime"
CORE = PROCESSING / "lai_processing"


def _imports(path: Path) -> list[tuple[str, bool]]:
    """(module, at module level) for every import in `path`."""
    tree = ast.parse(path.read_text(), filename=str(path))
    top_level = {id(node) for node in tree.body}
    found: list[tuple[str, bool]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((alias.name, id(node) in top_level) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            found.append((node.module, id(node) in top_level))
    return found


@pytest.mark.parametrize("path", sorted(RUNTIME.rglob("*.py")), ids=lambda p: p.name)
def test_runtime_never_imports_django_or_lai_and_boto_only_lazily(path: Path) -> None:
    for module, top in _imports(path):
        root = module.split(".")[0]
        assert root not in {"django", "rest_framework", "lai", "apps", "config"}, module
        if root in {"boto3", "botocore"}:
            assert not top, f"{module} must be imported lazily in {path.name}"


@pytest.mark.parametrize("path", sorted(CORE.rglob("*.py")), ids=lambda p: p.name)
def test_core_never_imports_the_runtime_or_boto(path: Path) -> None:
    for module, _ in _imports(path):
        assert module.split(".")[0] not in {"lai_processing_runtime", "boto3", "botocore"}


PROBE = """
import json, pkgutil, sys
sys.path.insert(0, sys.argv[1])
import lai_processing_runtime
for info in pkgutil.walk_packages(lai_processing_runtime.__path__, "lai_processing_runtime."):
    if info.name != "lai_processing_runtime.__main__":
        __import__(info.name)
leaked = sorted(m for m in sys.modules if m.split(".")[0] in {"django", "boto3", "botocore"})
print(json.dumps(leaked))
"""


def test_importing_every_runtime_module_loads_no_django_and_no_boto() -> None:
    completed = subprocess.run(  # noqa: S603 - the test interpreter, fixed script
        [sys.executable, "-I", "-c", PROBE, str(PROCESSING)],
        capture_output=True,
        text=True,
        env={"PATH": os.environ.get("PATH", "")},
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == []


def _pins(path: Path) -> dict[str, str]:
    pins: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if "==" in line:
            name, version = line.split("==", 1)
            pins[re.sub(r"\[.*\]", "", name).lower()] = version
    return pins


def test_runtime_requirements_match_the_repository_pins() -> None:
    runtime = _pins(PROCESSING / "runtime-requirements.txt")
    repository = _pins(REPO / "requirements.txt")
    assert set(runtime) == {
        "boto3",
        "botocore",
        "s3transfer",
        "jmespath",
        "python-dateutil",
        "six",
        "urllib3",
    }
    for name, version in runtime.items():
        assert repository[name] == version, name
    pyproject = (PROCESSING / "pyproject.toml").read_text()
    assert f'aws = ["boto3=={repository["boto3"]}"]' in pyproject
    assert '"lai_processing_runtime*"' in pyproject


def test_dockerfile_builds_only_the_two_packages() -> None:
    text = (PROCESSING / "Dockerfile.lambda").read_text()
    assert "ARG BASE_IMAGE=public.ecr.aws/lambda/python:3.12" in text
    assert "FROM ${BASE_IMAGE}" in text
    assert 'CMD ["lai_processing_runtime.lambda_handler.handler"]' in text
    assert "pip install --no-cache-dir" in text and "runtime-requirements.txt" in text
    copies = [line.split()[1] for line in text.splitlines() if line.startswith("COPY ")]
    assert copies == ["runtime-requirements.txt", "lai_processing/", "lai_processing_runtime/"]
    assert not re.search(r"AWS_(ACCESS|SECRET|SESSION)", text)
    assert "--platform linux/arm64" in text
    ignore = (PROCESSING / ".dockerignore").read_text().splitlines()
    assert ignore[ignore.index("*")] == "*"
    assert "lai_processing/contracts/fixtures" in ignore
    assert "**/__pycache__" in ignore


def test_handler_reference_resolves() -> None:
    from lai_processing_runtime import lambda_handler

    assert callable(lambda_handler.handler)


# Telemetry ---------------------------------------------------------------------------------


def clock() -> datetime:
    return datetime(2026, 11, 16, 12, 0, tzinfo=UTC)


def test_json_lines_with_the_closed_vocabulary() -> None:
    stream = io.StringIO()
    t = JsonLogTelemetry(stream, clock=clock)
    t.event("work.completed", job_id="j", status="succeeded", receive_count=2)
    t.event("work.invalid", error_code="invalid_input")
    t.metric("job.duration", 12, unit="Milliseconds", job_type="reference.checksum")
    lines = [json.loads(line) for line in stream.getvalue().splitlines()]
    assert lines[0] == {
        "ts": "2026-11-16T12:00:00.000000Z",
        "level": "INFO",
        "logger": "lai_processing",
        "event": "work.completed",
        "job_id": "j",
        "status": "succeeded",
        "receive_count": 2,
    }
    assert lines[1]["level"] == "WARNING"
    assert lines[2]["metric"] == "job.duration" and lines[2]["value"] == 12.0
    with pytest.raises(ValueError):
        t.event("work.completed", body="secret")
    with pytest.raises(ValueError):
        t.event("work.completed", job_id="multi\nline")


def test_level_threshold_and_logger_output(caplog: pytest.LogCaptureFixture) -> None:
    stream = io.StringIO()
    t = JsonLogTelemetry(stream, level="WARNING")
    t.event("job.started", job_id="j")
    t.event("work.completion_failed", job_id="j")
    assert [json.loads(x)["event"] for x in stream.getvalue().splitlines()] == [
        "work.completion_failed"
    ]
    logger = logging.getLogger("test.runtime.telemetry")
    with caplog.at_level(logging.INFO, logger="test.runtime.telemetry"):
        JsonLogTelemetry(logger=logger).event("job.started", job_id="j")
    assert json.loads(caplog.records[0].getMessage())["event"] == "job.started"
    with pytest.raises(ValueError):
        JsonLogTelemetry(level="LOUD")
