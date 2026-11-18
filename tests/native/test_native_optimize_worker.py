"""`lambda/optimize_worker` skeleton: the task and the handler flow, with fakes only.

The envelope module and runtime are injected (`handler.bind`) because `asset.optimize` and its
queue are registered by Workstream A; the fake envelope below mirrors the calls the handler makes
on `jobs_core.envelope`. No AWS client, no network.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from test_native_optimize_meshopt import FakeRun, compressed_grid

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lambda"))

from optimize_worker import handler, task  # noqa: E402

ON = {"LAI_GLB_MESHOPT": "on"}
PAYLOAD = {
    "storage_key": "assets/models/abc.glb",
    "format": "glb",
    "profile": "meshopt-conservative",
}


class Ports(handler.StubArtifactPort):
    def __init__(self, source: bytes | None) -> None:
        super().__init__()
        self.source = source

    def asset_object_size(self, key: str) -> int | None:
        return None if self.source is None else len(self.source)

    def read_asset(self, key: str, start: int, length: int) -> bytes:
        assert self.source is not None
        return self.source[start : start + length]


@pytest.fixture
def fake_optimizer(monkeypatch):  # type: ignore[no-untyped-def]
    source, output = compressed_grid()
    run = FakeRun(output)
    real = task.optimize_meshopt

    def optimize(data, **kwargs):  # type: ignore[no-untyped-def]
        return real(data, run=run, **kwargs)

    monkeypatch.setattr(task, "optimize_meshopt", optimize)
    return SimpleNamespace(source=source, output=output, run=run)


def _tools() -> Any:
    from lai_native.optimize import ToolPaths

    return ToolPaths(gltfpack=Path("/opt/gltfpack"))


def test_task_writes_two_create_only_artifacts(fake_optimizer, tmp_path: Path) -> None:
    ports = Ports(fake_optimizer.source)
    result = task.run_optimize(
        PAYLOAD, ports, environ=ON, tools=_tools(), workdir_root=str(tmp_path)
    )
    roles = {a["role"]: a for a in result["artifacts"]}
    model = roles["model.optimized"]
    assert model["key"].startswith("processing/artifacts/dev/")
    assert ports.objects[model["key"]][2] == fake_optimizer.output
    assert model["sha256"] == ports.sha256(model["key"])
    report = json.loads(ports.objects[roles["model.optimize_report"]["key"]][2])
    assert report["profile"] == "meshopt-conservative/v1"
    assert result["summary"]["output_bytes"] < result["summary"]["source_bytes"]
    assert PAYLOAD["storage_key"] not in ports.objects  # the original is never written
    assert list(tmp_path.iterdir()) == []  # the private work directory is removed


def test_task_refuses_when_the_control_is_off(fake_optimizer) -> None:
    with pytest.raises(task.OptimizeTaskError) as caught:
        task.run_optimize(PAYLOAD, Ports(fake_optimizer.source), environ={}, tools=_tools())
    assert caught.value.code == "optimization_disabled"
    assert fake_optimizer.run.calls == []


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({**PAYLOAD, "extra": 1}, "invalid_payload"),
        ({**PAYLOAD, "storage_key": "../x.glb"}, "invalid_asset_key"),
        ({**PAYLOAD, "format": "gltf"}, "unsupported_format"),
        ({**PAYLOAD, "profile": "meshopt-aggressive"}, "unknown_profile"),
        ({**PAYLOAD, "max_bytes": 0}, "invalid_payload"),
        ({**PAYLOAD, "max_bytes": 10}, "object_too_large"),
        ("nope", "invalid_payload"),
    ],
)
def test_task_payload_errors(fake_optimizer, payload: Any, code: str) -> None:
    with pytest.raises(task.OptimizeTaskError) as caught:
        task.run_optimize(payload, Ports(fake_optimizer.source), environ=ON, tools=_tools())
    assert caught.value.code == code
    assert not caught.value.retryable


def test_task_missing_object(fake_optimizer) -> None:
    with pytest.raises(task.OptimizeTaskError) as caught:
        task.run_optimize(PAYLOAD, Ports(None), environ=ON, tools=_tools())
    assert caught.value.code == "object_missing"


def test_task_maps_optimizer_failures(fake_optimizer) -> None:  # type: ignore[no-untyped-def]
    fake_optimizer.run.output = fake_optimizer.source  # gltfpack "output" no smaller
    with pytest.raises(task.OptimizeTaskError) as caught:
        task.run_optimize(PAYLOAD, Ports(fake_optimizer.source), environ=ON, tools=_tools())
    assert caught.value.code == "no_size_gain"
    assert not caught.value.retryable


def test_stub_artifact_port_is_create_only() -> None:
    port = handler.StubArtifactPort()
    port.put_artifact(role="r", content_type="application/json", data=b"{}", logical_id="a")
    with pytest.raises(task.OptimizeTaskError):
        port.put_artifact(role="r", content_type="application/json", data=b"{}", logical_id="a")


# --- handler flow with a fake envelope and runtime --------------------------------------------


class FakeEnvelope:
    RUNNING, SUCCEEDED, FAILED = "running", "succeeded", "failed"

    @staticmethod
    def parse_work(body: str, *, allowed_kinds: frozenset[str]) -> dict:
        data = json.loads(body)
        if data["kind"] not in allowed_kinds:
            raise ValueError("queue")
        return data

    @staticmethod
    def build_result(job_id, kind, status, result=None, error_code=None, **worker):  # type: ignore[no-untyped-def]
        return {
            "job_id": job_id,
            "kind": kind,
            "status": status,
            "result": result,
            "error": {"code": error_code} if error_code else None,
        }

    @staticmethod
    def for_message(final: dict) -> dict:
        return final


class FakeRuntime:
    def __init__(self, ports: Ports) -> None:
        self.settings = SimpleNamespace(allowed_kinds=frozenset({"asset.optimize"}))
        self.sent: list[dict] = []
        self.stored: dict[str, dict] = {}
        self._ports = ports

    def load_result(self, job_id: str) -> dict | None:
        return self.stored.get(job_id)

    def store_result(self, final: dict) -> None:
        self.stored[final["job_id"]] = final

    def send_result(self, message: dict) -> None:
        self.sent.append(message)

    def ports(self, kind: str, context: Any) -> Ports:
        return self._ports


def _event(job_id: str = "j1", kind: str = "asset.optimize") -> dict:
    body = json.dumps({"job_id": job_id, "kind": kind, "payload": PAYLOAD})
    return {"Records": [{"messageId": "m1", "body": body}]}


def test_handler_success_then_redelivery(monkeypatch, fake_optimizer, tmp_path) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LAI_GLB_MESHOPT", "on")
    monkeypatch.setenv("LAI_GLTFPACK", "/opt/gltfpack")
    runtime = FakeRuntime(Ports(fake_optimizer.source))
    handler.bind(envelope=FakeEnvelope, runtime=runtime)
    assert handler.handle(_event(), None) == {"batchItemFailures": []}
    assert [m["status"] for m in runtime.sent] == ["running", "succeeded"]
    assert handler.handle(_event(), None) == {"batchItemFailures": []}
    assert [m["status"] for m in runtime.sent] == ["running", "succeeded", "succeeded"]
    assert len(fake_optimizer.run.calls) == 1  # redelivery does not run gltfpack again


def test_handler_failed_result_when_disabled(monkeypatch, fake_optimizer) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("LAI_GLB_MESHOPT", raising=False)
    runtime = FakeRuntime(Ports(fake_optimizer.source))
    handler.bind(envelope=FakeEnvelope, runtime=runtime)
    assert handler.handle(_event("j2"), None) == {"batchItemFailures": []}
    assert runtime.sent[-1]["error"] == {"code": "optimization_disabled"}


def test_handler_reports_unreadable_envelopes_as_batch_failures(fake_optimizer) -> None:  # type: ignore[no-untyped-def]
    runtime = FakeRuntime(Ports(fake_optimizer.source))
    handler.bind(envelope=FakeEnvelope, runtime=runtime)
    result = handler.handle({"Records": [{"messageId": "bad", "body": "{"}]}, None)
    assert result == {"batchItemFailures": [{"itemIdentifier": "bad"}]}
