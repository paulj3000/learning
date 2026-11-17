"""The `asset.glb_validator` processor through the registry, the engine and the CLI."""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from glb_builder import MIXAMO_CLIP, glb, png, skinned_glb, static_glb

from lai_processing.cli.main import main
from lai_processing.contracts import (
    AssetContext,
    InputObject,
    ObjectRef,
    ProcessingJobRequest,
    ProfileRef,
    ResultStatus,
    StoreName,
    SubjectRef,
    Verdict,
    decode_result,
    encode,
)
from lai_processing.core.canonical import canonical_json
from lai_processing.core.errors import ErrorCode
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.idempotency import request_idempotency_key
from lai_processing.core.limits import DEFAULT_LIMITS, ResourceLimits
from lai_processing.core.processor import CancellationToken
from lai_processing.core.registry import default_registry
from lai_processing.processors.gltf import GLB_PROFILE, GLB_REPORT_TYPE, GlbValidatorProcessor
from lai_processing.processors.gltf.document import COMPLEXITY_DEFAULTS
from lai_processing.testing import ManualClock, MemoryObjectStorage, RecordingTelemetry

NS = "test"
JOB_ID = "11111111-1111-4111-8111-111111111111"
ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
VERSION_ID = "33333333-3333-4333-8333-333333333333"
KEY = f"processing/quarantine/{NS}/{JOB_ID}/input.bin"


def make_request(
    data: bytes,
    options: dict[str, Any] | None = None,
    limits: ResourceLimits = DEFAULT_LIMITS,
) -> ProcessingJobRequest:
    request = ProcessingJobRequest(
        job_id=JOB_ID,
        job_type="asset.validate_model",
        namespace=NS,
        subject=SubjectRef("asset_version", VERSION_ID),
        asset=AssetContext("crab-model", VERSION_ID, 1),
        profile=ProfileRef("glb-default", 1),
        idempotency_key="ik1:" + "c" * 64,
        correlation_id="corr-glb-0001",
        attempt_id=ATTEMPT_ID,
        attempt_number=1,
        submitted_at=datetime(2026, 11, 16, 11, 0, tzinfo=UTC),
        input=InputObject(
            ref=ObjectRef(StoreName.QUARANTINE, KEY, None, NS),
            content_type="model/gltf-binary",
            size_bytes=len(data),
            sha256=hashlib.sha256(data).hexdigest(),
        ),
        options=options or {},
        limits=limits,
    )
    return replace(request, idempotency_key=request_idempotency_key(request))


class SteppingClock(ManualClock):
    """A clock whose monotonic time advances by `step` on every read."""

    def __init__(self, step: float) -> None:
        super().__init__()
        self.step = step

    def monotonic(self) -> float:
        self.advance(self.step)
        return super().monotonic()


def run(
    tmp_path: Path,
    data: bytes,
    options: dict[str, Any] | None = None,
    *,
    clock: ManualClock | None = None,
    limits: ResourceLimits = DEFAULT_LIMITS,
    cancellation: CancellationToken | None = None,
) -> tuple[Any, MemoryObjectStorage]:
    tmp_path.mkdir(parents=True, exist_ok=True)
    storage = MemoryObjectStorage()
    storage.seed(ObjectRef(StoreName.QUARANTINE, KEY, None, NS), data)
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=RecordingTelemetry(),
        clock=clock or ManualClock(),
        workspace_root=tmp_path,
        id_factory=lambda: "44444444-4444-4444-8444-444444444444",
    )
    result = engine.execute(make_request(data, options, limits), cancellation=cancellation)
    assert decode_result(encode(result)) == result
    return result, storage


# --- registry and profile ---------------------------------------------------------------------


def test_registered_in_the_default_registry() -> None:
    registry = default_registry()
    processor, profile = registry.resolve("asset.validate_model", ProfileRef("glb-default", 1))
    assert isinstance(processor, GlbValidatorProcessor)
    assert profile is GLB_PROFILE
    assert processor.identity.processor_id == "asset.glb_validator"
    assert processor.version == "1.0.0"
    described = {p["processor_id"]: p for p in registry.describe()}["asset.glb_validator"]
    assert described["job_types"] == ["asset.validate_model"]
    assert described["profiles"][0]["options"] == {
        "max_texture_dimension": {
            "type": "int",
            "default": 8192,
            "required": False,
            "choices": None,
            "minimum": 1,
            "maximum": 16384,
        },
        "require_animations": {
            "type": "bool",
            "default": False,
            "required": False,
            "choices": None,
            "minimum": None,
            "maximum": None,
        },
        "write_report": {
            "type": "bool",
            "default": False,
            "required": False,
            "choices": None,
            "minimum": None,
            "maximum": None,
        },
    }


def test_profile_limits_carry_the_complexity_defaults() -> None:
    assert dict(GLB_PROFILE.limits.complexity) == dict(sorted(COMPLEXITY_DEFAULTS.items()))
    assert GLB_PROFILE.limits.complexity_limit("max_vertices") == 10_000_000
    assert len(GLB_PROFILE.limits.complexity) <= 32


# --- engine end to end ------------------------------------------------------------------------


def test_valid_static_model_passes(tmp_path: Path) -> None:
    result, storage = run(tmp_path, static_glb())
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.PASS
    assert result.processor.processor_id == "asset.glb_validator"
    assert result.findings == ()
    assert result.metadata["triangle_count"] == 2
    assert result.metadata["images"] == [
        {"height": 32, "index": 0, "mime_type": "image/png", "width": 64}
    ]
    assert result.artifacts == ()
    assert storage.keys(StoreName.ARTIFACTS) == []


def test_valid_skinned_model_reports_exact_clip_names(tmp_path: Path) -> None:
    result, _ = run(tmp_path, skinned_glb((MIXAMO_CLIP, "Walk")))
    assert result.verdict is Verdict.PASS
    assert [a["name"] for a in result.metadata["animations"]] == [MIXAMO_CLIP, "Walk"]
    assert [a["duration_seconds"] for a in result.metadata["animations"]] == [1.25, 2.5]
    codes = [(f.code, f.severity.value) for f in result.findings]
    assert ("generic_clip_name", "warning") in codes


def test_bad_file_is_a_fail_verdict_not_a_job_error(tmp_path: Path) -> None:
    result, _ = run(tmp_path, b"PK\x03\x04 a zip file")
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.FAIL
    assert result.errors == ()
    assert [f.code for f in result.findings] == ["not_a_model"]
    assert result.metadata["format"] is None


def test_finding_messages_never_echo_file_content(tmp_path: Path) -> None:
    marker = "SECRET-MARKER-9f2c"
    document = {
        "asset": {"version": "2.0", "generator": marker},
        "extensionsRequired": [marker],
        "buffers": [{"byteLength": 4, "uri": f"https://{marker}.invalid/x"}],
        "images": [{"uri": f"../{marker}.png"}],
        "animations": [{"name": marker}, {"name": marker}],
    }
    result, _ = run(tmp_path, glb(document, None))
    assert result.verdict is Verdict.FAIL
    for finding in result.findings:
        assert marker not in finding.message
        assert marker not in finding.path
    for warning in result.warnings:
        assert marker not in warning.message


def test_options_reach_the_validator(tmp_path: Path) -> None:
    big = static_glb(texture=png(2048, 2048))
    passed, _ = run(tmp_path / "a", big)
    assert passed.verdict is Verdict.PASS
    refused, _ = run(tmp_path / "b", big, {"max_texture_dimension": 1024})
    assert refused.verdict is Verdict.FAIL
    assert [f.code for f in refused.findings] == ["texture_too_large"]
    required, _ = run(tmp_path / "c", static_glb(), {"require_animations": True})
    assert [f.code for f in required.findings] == ["animations_required"]


def test_unknown_or_bad_options_are_refused(tmp_path: Path) -> None:
    result, _ = run(tmp_path, static_glb(), {"max_texture_dimension": 0})
    assert result.status is ResultStatus.FAILED
    assert result.errors[0].code is ErrorCode.INVALID_PROCESSING_PROFILE
    result, _ = run(tmp_path / "b", static_glb(), {"fetch_urls": True})
    assert result.errors[0].code is ErrorCode.INVALID_PROCESSING_PROFILE


def test_request_complexity_limits_are_enforced(tmp_path: Path) -> None:
    limits = replace(DEFAULT_LIMITS, complexity={"max_vertices": 3})
    result, _ = run(tmp_path, static_glb(), limits=limits)
    assert result.verdict is Verdict.FAIL
    assert [f.code for f in result.findings] == ["too_complex"]


def test_write_report_artifact(tmp_path: Path) -> None:
    result, storage = run(tmp_path, skinned_glb(), {"write_report": True})
    assert result.status is ResultStatus.SUCCEEDED
    (artifact,) = result.artifacts
    assert artifact.logical_id == "glb-report"
    assert artifact.artifact_type == GLB_REPORT_TYPE == "report.glb_validation"
    assert artifact.content_type == "application/json"
    body = json.loads(storage.objects[("artifacts", artifact.ref.key)][0].data)
    assert body["verdict"] == "pass"
    assert body["metadata"] == dict(result.metadata)
    assert body["findings"] == [f.to_dict() for f in result.findings]


def test_byte_identical_results_apart_from_timestamps(tmp_path: Path) -> None:
    data = skinned_glb((MIXAMO_CLIP, "Idle"))
    first, _ = run(tmp_path / "a", data, {"write_report": True})
    second, _ = run(tmp_path / "b", data, {"write_report": True})
    # The ManualClock fixes every timestamp, so the whole encoding must be identical.
    assert encode(first) == encode(second)
    stepped, _ = run(tmp_path / "c", data, {"write_report": True}, clock=SteppingClock(0.001))

    def without_time(result: Any) -> dict[str, Any]:
        payload = result.to_dict()
        for key in ("started_at", "completed_at", "duration_ms"):
            payload.pop(key)
        return payload

    assert canonical_json(without_time(first)) == canonical_json(without_time(stepped))


def test_deadline_in_a_parsing_loop_is_a_retryable_timeout(tmp_path: Path) -> None:
    nodes = [{"mesh": 0}] + [{} for _ in range(5000)]
    document = {
        "asset": {"version": "2.0"},
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
    }
    limits = replace(DEFAULT_LIMITS, max_execution_seconds=100)
    result, _ = run(tmp_path, glb(document, None), clock=SteppingClock(0.05), limits=limits)
    assert result.status is ResultStatus.FAILED
    assert result.errors[0].code is ErrorCode.PROCESSING_TIMEOUT
    assert result.retry_class.value == "retryable"


def test_cancellation_mid_validation(tmp_path: Path) -> None:
    token = CancellationToken()

    class CancellingClock(ManualClock):
        reads = 0

        def monotonic(self) -> float:
            CancellingClock.reads += 1
            if CancellingClock.reads > 40:
                token.cancel()
            return super().monotonic()

    nodes = [{"mesh": 0}] + [{} for _ in range(3000)]
    document = {"asset": {"version": "2.0"}, "scenes": [{"nodes": [0]}], "nodes": nodes}
    result, _ = run(tmp_path, glb(document, None), clock=CancellingClock(), cancellation=token)
    assert result.status is ResultStatus.CANCELLED
    assert result.errors[0].code is ErrorCode.CANCELLED


def test_cli_runs_the_glb_validator(tmp_path: Path) -> None:
    data = skinned_glb()
    request_path = tmp_path / "request.json"
    request_path.write_bytes(encode(make_request(data)))
    input_path = tmp_path / "model.glb"
    input_path.write_bytes(data)
    out, err = io.StringIO(), io.StringIO()
    code = main(["run", str(request_path), "--input-file", str(input_path)], stdout=out, stderr=err)
    assert code == 0, err.getvalue()
    result = json.loads(out.getvalue())
    assert result["status"] == "succeeded"
    assert result["verdict"] == "pass"
    assert result["processor"]["processor_id"] == "asset.glb_validator"


@pytest.mark.parametrize("data", [b"", b"glTF", static_glb()[:-3], b"\xff" * 1000])
def test_hostile_inputs_always_give_a_contract_valid_success(tmp_path: Path, data: bytes) -> None:
    result, _ = run(tmp_path, data)
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.FAIL
