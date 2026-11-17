"""Execution engine: every job ends in a contract-valid result, and nothing leaks or lingers."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from lai_processing.contracts import (
    AssetContext,
    Finding,
    InputObject,
    ObjectRef,
    ProcessingJobRequest,
    ProcessingJobResult,
    ProcessingProfile,
    ProfileRef,
    ResultStatus,
    Severity,
    StoreName,
    SubjectRef,
    Verdict,
    decode_event,
    decode_result,
    encode,
)
from lai_processing.core.canonical import canonical_json
from lai_processing.core.errors import ErrorCode, RetryClass
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.idempotency import request_idempotency_key
from lai_processing.core.limits import DEFAULT_LIMITS, PLATFORM_CEILINGS, ResourceLimits
from lai_processing.core.processor import (
    CancellationToken,
    ProcessingContext,
    Processor,
    ProcessorOutput,
)
from lai_processing.core.registry import ProcessorRegistry, default_registry
from lai_processing.ports.storage import StoragePermissionDenied, StorageUnavailable
from lai_processing.ports.telemetry import SAFE_FIELDS
from lai_processing.processors.reference import REFERENCE_PROFILE, ReferenceProcessor
from lai_processing.testing import ManualClock, MemoryObjectStorage, RecordingTelemetry

NS = "test"
JOB_ID = "11111111-1111-4111-8111-111111111111"
ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
INPUT_KEY = f"processing/quarantine/{NS}/{JOB_ID}/input.bin"
SECRET = "SECRET-CHILD-NAME-Zelda"
DATA = b"hello adventure island\n" * 10


def _ref(key: str = INPUT_KEY, version_id: str | None = None) -> ObjectRef:
    return ObjectRef(StoreName.QUARANTINE, key, version_id, NS)


def make_request(
    data: bytes = DATA,
    *,
    sha256: str | None = None,
    size: int | None = None,
    version_id: str | None = None,
    options: dict[str, Any] | None = None,
    limits: ResourceLimits = DEFAULT_LIMITS,
    job_type: str = "reference.checksum",
    profile: ProfileRef | None = None,
    namespace: str = NS,
    expires_at: datetime | None = None,
    submitted_at: datetime | None = None,
) -> ProcessingJobRequest:
    asset = None
    subject = SubjectRef("upload", "u-1")
    key = INPUT_KEY.replace(f"/{NS}/", f"/{namespace}/")
    if job_type.startswith("asset."):
        version_uuid = "33333333-3333-4333-8333-333333333333"
        asset = AssetContext("crab-model", version_uuid, 1)
        subject = SubjectRef("asset_version", version_uuid)
    request = ProcessingJobRequest(
        job_id=JOB_ID,
        job_type=job_type,
        namespace=namespace,
        subject=subject,
        profile=profile or ProfileRef("reference-default", 1),
        idempotency_key="ik1:" + "a" * 64,
        correlation_id="corr-0001",
        attempt_id=ATTEMPT_ID,
        attempt_number=1,
        submitted_at=submitted_at or datetime(2026, 11, 16, 11, 0, tzinfo=UTC),
        expires_at=expires_at,
        input=InputObject(
            ref=ObjectRef(StoreName.QUARANTINE, key, version_id, namespace),
            content_type="application/octet-stream",
            size_bytes=len(data) if size is None else size,
            sha256=sha256 or hashlib.sha256(data).hexdigest(),
        ),
        asset=asset,
        options=options or {},
        limits=limits,
    )
    # A real key, derived from the request, as the engine verifies it.
    return replace(request, idempotency_key=request_idempotency_key(request))


class Harness:
    def __init__(
        self,
        tmp_path: Path,
        *,
        registry: ProcessorRegistry | None = None,
        ceilings: ResourceLimits = PLATFORM_CEILINGS,
        namespace: str | None = None,
    ) -> None:
        self.storage = MemoryObjectStorage()
        self.telemetry = RecordingTelemetry()
        self.clock = ManualClock()
        self.root = tmp_path / "work"
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine = ExecutionEngine(
            registry=registry or default_registry(),
            storage=self.storage,
            telemetry=self.telemetry,
            clock=self.clock,
            ceilings=ceilings,
            namespace=namespace,
            workspace_root=self.root,
            id_factory=lambda: "44444444-4444-4444-8444-444444444444",
        )

    def seed(self, data: bytes = DATA) -> str:
        return self.storage.seed(_ref(), data).version_id or ""

    def run(self, request: ProcessingJobRequest, **kwargs: Any) -> ProcessingJobResult:
        result = self.engine.execute(request, **kwargs)
        assert_contract_valid(result)
        assert list(self.root.iterdir()) == [], "workspace not cleaned up"
        return result


def assert_contract_valid(result: ProcessingJobResult) -> bytes:
    encoded = encode(result)
    assert decode_result(encoded) == result
    assert encode(decode_result(encoded)) == encoded
    return encoded


def assert_error(result: ProcessingJobResult, code: ErrorCode) -> None:
    assert result.status is (
        ResultStatus.CANCELLED if code is ErrorCode.CANCELLED else ResultStatus.FAILED
    )
    assert result.primary_error is not None
    assert result.primary_error.code is code, result.primary_error
    assert result.verdict is None


def custom_registry(
    process: Callable[[ProcessingContext], ProcessorOutput],
    *,
    validate: Callable[[ProcessingContext], None] | None = None,
    cleanup: Callable[[ProcessingContext], None] | None = None,
    profile_id: str = "custom",
) -> ProcessorRegistry:
    profile = ProcessingProfile(
        profile_id=profile_id, version=1, job_type="reference.checksum", description="custom"
    )

    class Custom(Processor):
        processor_id = "test.custom"
        version = "0.1.0"
        job_types = frozenset({"reference.checksum"})

        def profiles(self) -> tuple[ProcessingProfile, ...]:
            return (profile,)

        def validate(self, context: ProcessingContext) -> None:
            if validate is not None:
                validate(context)

        def process(self, context: ProcessingContext) -> ProcessorOutput:
            return process(context)

        def cleanup(self, context: ProcessingContext) -> None:
            if cleanup is not None:
                cleanup(context)

    registry = ProcessorRegistry()
    registry.register(Custom())
    registry.freeze()
    return registry


CUSTOM = ProfileRef("custom", 1)


def _pass(_: ProcessingContext) -> ProcessorOutput:
    return ProcessorOutput(verdict=Verdict.PASS)


# Success -------------------------------------------------------------------------------------


def test_success_path(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    version = h.seed()
    result = h.run(make_request(options={"metadata_level": "full", "write_report": True}))
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.PASS
    assert result.processor is not None
    assert result.processor.processor_id == "reference.checksum"
    assert result.input is not None and result.input.verified
    assert result.input.ref.version_id == version
    assert result.metadata["byte_count"] == len(DATA)
    assert result.metadata["sha256"] == hashlib.sha256(DATA).hexdigest()
    assert len(result.artifacts) == 1
    artifact = result.artifacts[0]
    assert artifact.ref.key == (
        f"processing/artifacts/{NS}/{JOB_ID}/{ATTEMPT_ID}/reference-report.json"
    )
    assert artifact.ref.version_id is not None
    stored = h.storage.objects[("artifacts", artifact.ref.key)][0].data
    assert hashlib.sha256(stored).hexdigest() == artifact.sha256
    assert h.telemetry.names() == ["job.started", "job.succeeded"]
    assert h.telemetry.metrics[0][0] == "job.duration"
    assert h.telemetry.metrics[0][2] == "Milliseconds"


def test_request_version_pin_is_honoured(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    version = h.seed()
    result = h.run(make_request(version_id=version))
    assert result.status is ResultStatus.SUCCEEDED


def test_newer_object_version_is_not_substituted(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    old = h.seed()
    h.storage.seed(_ref(), DATA + b"tampered")
    # Pinned to the old version: the old bytes are read, never the newer object.
    result = h.run(make_request(version_id=old))
    assert result.status is ResultStatus.SUCCEEDED
    assert result.input is not None and result.input.ref.version_id == old


# Input failures ------------------------------------------------------------------------------


def test_input_missing(tmp_path: Path) -> None:
    result = Harness(tmp_path).run(make_request())
    assert_error(result, ErrorCode.INPUT_MISSING)
    assert result.retry_class is RetryClass.MANUAL
    assert result.input is None


def test_unknown_version_is_missing(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    assert_error(h.run(make_request(version_id="v999999")), ErrorCode.INPUT_MISSING)


def test_permission_denied(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    h.storage.fail_next("head", StoragePermissionDenied({"store": "quarantine"}))
    result = h.run(make_request())
    assert_error(result, ErrorCode.PERMISSION_DENIED)
    assert result.retry_class is RetryClass.MANUAL


@pytest.mark.parametrize("operation", ["head", "open"])
def test_storage_transient_failure_is_retryable(tmp_path: Path, operation: str) -> None:
    h = Harness(tmp_path)
    h.seed()
    h.storage.fail_next(operation, StorageUnavailable())
    result = h.run(make_request())
    assert_error(result, ErrorCode.STORAGE_FAILURE)
    assert result.retry_class is RetryClass.RETRYABLE


def test_connection_error_is_temporary(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    h.storage.fail_next("open", ConnectionResetError(SECRET))
    result = h.run(make_request())
    assert_error(result, ErrorCode.TEMPORARY_FAILURE)
    assert SECRET.encode() not in encode(result)


def test_checksum_mismatch_bytes_differ(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed(DATA)
    result = h.run(make_request(sha256="0" * 64))
    assert_error(result, ErrorCode.CHECKSUM_MISMATCH)
    assert result.retry_class is RetryClass.PERMANENT


def test_checksum_mismatch_same_size_different_bytes_streamed(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed(DATA)

    # Hide the store's recorded checksum so the mismatch is caught while streaming.
    real_head = h.storage.head

    def head(ref: ObjectRef) -> Any:
        info = real_head(ref)
        return type(info)(info.ref, info.size_bytes, info.content_type, info.version_id, None)

    h.storage.head = head  # type: ignore[method-assign]
    expected = DATA[:-1] + b"?"
    result = h.run(make_request(expected))
    assert_error(result, ErrorCode.CHECKSUM_MISMATCH)
    assert result.input is not None
    assert result.input.verified is False
    assert result.input.sha256 == hashlib.sha256(DATA).hexdigest()


def test_checksum_mismatch_size_differs(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed(DATA)
    result = h.run(make_request(DATA, size=len(DATA) - 1))
    assert_error(result, ErrorCode.CHECKSUM_MISMATCH)
    assert result.primary_error is not None
    assert result.primary_error.details["field"] == "input.size_bytes"


def test_stream_longer_than_head_is_cut_off(tmp_path: Path) -> None:
    """A store whose body is longer than its `head` claims is refused before full read."""
    h = Harness(tmp_path)
    h.seed(DATA)
    real_open = h.storage.open
    reads: list[int] = []

    class Endless:
        def read(self, n: int) -> bytes:
            reads.append(n)
            return b"x" * n

        def close(self) -> None:
            pass

    h.storage.open = lambda ref: Endless()  # type: ignore[method-assign, assignment, return-value]
    result = h.run(make_request())
    assert_error(result, ErrorCode.CHECKSUM_MISMATCH)
    assert len(reads) == 1
    del real_open


def test_oversized_input_vs_request_limits(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed(DATA)
    limits = ResourceLimits(**{**DEFAULT_LIMITS.to_dict(), "max_input_bytes": 1000})
    request = make_request(limits=limits)
    # The request itself is consistent; the stored object is larger than declared.
    h.storage.seed(_ref(), b"x" * 2000)
    result = h.run(request)
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)
    assert result.primary_error is not None
    assert result.primary_error.details["limit"] == "max_input_bytes"


def test_oversized_input_vs_ceiling_clamp(tmp_path: Path) -> None:
    ceilings = ResourceLimits(**{**PLATFORM_CEILINGS.to_dict(), "max_input_bytes": 10})
    h = Harness(tmp_path, ceilings=ceilings)
    h.seed(DATA)
    result = h.run(make_request())
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)


def test_input_larger_than_temp_budget(tmp_path: Path) -> None:
    ceilings = ResourceLimits(**{**PLATFORM_CEILINGS.to_dict(), "max_temp_bytes": 10})
    h = Harness(tmp_path, ceilings=ceilings)
    h.seed(DATA)
    result = h.run(make_request())
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)
    assert result.primary_error is not None
    assert result.primary_error.details["limit"] == "max_temp_bytes"


# Request-level refusals ----------------------------------------------------------------------


def test_expired_job(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    expires = h.clock.now() - timedelta(seconds=1)
    result = h.run(make_request(expires_at=expires, submitted_at=expires - timedelta(hours=1)))
    assert_error(result, ErrorCode.JOB_EXPIRED)
    assert result.processor is None


def test_namespace_mismatch(tmp_path: Path) -> None:
    h = Harness(tmp_path, namespace="prod")
    h.seed()
    result = h.run(make_request())
    assert_error(result, ErrorCode.NAMESPACE_MISMATCH)
    assert h.storage.objects and not h.storage.keys(StoreName.ARTIFACTS)


def test_unsupported_processor(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    request = make_request(job_type="asset.process_audio")  # declared, no processor yet
    result = h.run(request)
    assert_error(result, ErrorCode.UNSUPPORTED_PROCESSOR)
    assert result.retry_class is RetryClass.MANUAL
    assert result.processor is None


def test_unknown_profile(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    result = h.run(make_request(profile=ProfileRef("reference-default", 9)))
    assert_error(result, ErrorCode.INVALID_PROCESSING_PROFILE)


@pytest.mark.parametrize(
    "options",
    [
        {"metadata_level": "everything"},
        {"metadata_level": 3},
        {"write_report": "yes"},
        {"unknown_option": True},
    ],
)
def test_invalid_profile_options(tmp_path: Path, options: dict[str, Any]) -> None:
    h = Harness(tmp_path)
    h.seed()
    result = h.run(make_request(options=options))
    assert_error(result, ErrorCode.INVALID_PROCESSING_PROFILE)
    assert result.retry_class is RetryClass.PERMANENT
    # Resolved, so the failing processor is named.
    assert result.processor is not None


# Cancellation and time -----------------------------------------------------------------------


def test_cancelled_before_start(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    token = CancellationToken()
    token.cancel()
    result = h.run(make_request(), cancellation=token)
    assert_error(result, ErrorCode.CANCELLED)
    assert result.retry_class is RetryClass.CANCELLED
    assert h.telemetry.names()[-1] == "job.cancelled"


def test_cancelled_during_processing(tmp_path: Path) -> None:
    token = CancellationToken()

    def process(context: ProcessingContext) -> ProcessorOutput:
        token.cancel()
        context.check()
        raise AssertionError("not reached")

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    result = h.run(make_request(profile=CUSTOM), cancellation=token)
    assert_error(result, ErrorCode.CANCELLED)
    assert result.input is not None and result.input.verified


def test_cancelled_while_processor_ignores_checks(tmp_path: Path) -> None:
    token = CancellationToken()

    def process(context: ProcessingContext) -> ProcessorOutput:
        token.cancel()
        return ProcessorOutput(verdict=Verdict.PASS)

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM), cancellation=token), ErrorCode.CANCELLED)


def test_timeout_via_clock_inside_processor(tmp_path: Path) -> None:
    clock_holder: list[ManualClock] = []

    def process(context: ProcessingContext) -> ProcessorOutput:
        clock_holder[0].advance(DEFAULT_LIMITS.max_execution_seconds + 1)
        context.check()
        raise AssertionError("not reached")

    h = Harness(tmp_path, registry=custom_registry(process))
    clock_holder.append(h.clock)
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert_error(result, ErrorCode.PROCESSING_TIMEOUT)
    assert result.retry_class is RetryClass.RETRYABLE
    assert result.duration_ms == (DEFAULT_LIMITS.max_execution_seconds + 1) * 1000


def test_timeout_detected_after_process_returns(tmp_path: Path) -> None:
    holder: list[ManualClock] = []

    def process(context: ProcessingContext) -> ProcessorOutput:
        holder[0].advance(10_000)
        return ProcessorOutput(verdict=Verdict.PASS)

    h = Harness(tmp_path, registry=custom_registry(process))
    holder.append(h.clock)
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM)), ErrorCode.PROCESSING_TIMEOUT)


def test_processor_raising_timeout_error(tmp_path: Path) -> None:
    def process(context: ProcessingContext) -> ProcessorOutput:
        raise TimeoutError(SECRET)

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert_error(result, ErrorCode.PROCESSING_TIMEOUT)
    assert SECRET.encode() not in encode(result)


# Processor failures and leakage --------------------------------------------------------------


def test_processor_value_error_does_not_leak(tmp_path: Path) -> None:
    def process(context: ProcessingContext) -> ProcessorOutput:
        raise ValueError(f"cannot parse file for {SECRET} at /tmp/{SECRET}.glb")

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert_error(result, ErrorCode.UNEXPECTED_FAILURE)
    assert result.retry_class is RetryClass.MANUAL
    assert result.primary_error is not None
    assert result.primary_error.details == {"exception_type": "ValueError"}
    encoded = encode(result)
    assert SECRET.encode() not in encoded
    assert b"cannot parse" not in encoded
    assert SECRET not in repr(h.telemetry.events) + repr(h.telemetry.metrics)
    event = h.engine.complete(result, max_message_bytes=240 * 1024)
    assert SECRET.encode() not in encode(event)


def test_validate_refusal(tmp_path: Path) -> None:
    from lai_processing.core.errors import ProcessingError

    def validate(context: ProcessingContext) -> None:
        raise ProcessingError(ErrorCode.UNSUPPORTED_INPUT, {"field": "input.content_type"})

    h = Harness(tmp_path, registry=custom_registry(_pass, validate=validate))
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM)), ErrorCode.UNSUPPORTED_INPUT)


def test_processor_returning_wrong_type(tmp_path: Path) -> None:
    def process(context: ProcessingContext) -> Any:
        return {"verdict": "pass"}

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM)), ErrorCode.UNEXPECTED_FAILURE)


@pytest.mark.parametrize(
    "metadata",
    [{"x": {1, 2}}, {"x": float("nan")}, {"x": object()}],
)
def test_non_json_metadata_fails_safely(tmp_path: Path, metadata: dict[str, Any]) -> None:
    h = Harness(
        tmp_path,
        registry=custom_registry(
            lambda c: ProcessorOutput(verdict=Verdict.PASS, metadata=metadata)
        ),
    )
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM)), ErrorCode.UNEXPECTED_FAILURE)


def test_metadata_limit(tmp_path: Path) -> None:
    limits = ResourceLimits(**{**DEFAULT_LIMITS.to_dict(), "max_metadata_bytes": 64})
    h = Harness(
        tmp_path,
        registry=custom_registry(
            lambda c: ProcessorOutput(verdict=Verdict.PASS, metadata={"blob": "x" * 100})
        ),
    )
    h.seed()
    result = h.run(make_request(profile=CUSTOM, limits=limits))
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)
    assert result.primary_error is not None
    assert result.primary_error.details["limit"] == "max_metadata_bytes"


def test_too_many_findings_becomes_failure(tmp_path: Path) -> None:
    findings = tuple(Finding("f", Severity.INFO, "x") for _ in range(501))
    h = Harness(
        tmp_path,
        registry=custom_registry(
            lambda c: ProcessorOutput(verdict=Verdict.PASS, findings=findings)
        ),
    )
    h.seed()
    assert_error(h.run(make_request(profile=CUSTOM)), ErrorCode.RESOURCE_LIMIT_EXCEEDED)


def test_verdict_adjusted_when_error_finding_passes(tmp_path: Path) -> None:
    def process(context: ProcessingContext) -> ProcessorOutput:
        return ProcessorOutput(
            verdict=Verdict.PASS,
            findings=(Finding("broken_mesh", Severity.ERROR, "The mesh is broken.", "/meshes/0"),),
        )

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.FAIL
    assert [w.code for w in result.warnings] == ["verdict_adjusted"]


# Artifacts -----------------------------------------------------------------------------------


def _writer(count: int, size: int, logical: Callable[[int], str] = lambda i: f"part-{i}") -> Any:
    def process(context: ProcessingContext) -> ProcessorOutput:
        for i in range(count):
            context.write_artifact(
                logical_id=logical(i),
                artifact_type="derived.part",
                data=b"z" * size,
                content_type="application/octet-stream",
                extension="bin",
            )
        return ProcessorOutput(verdict=Verdict.PASS)

    return process


def test_artifact_count_limit_keeps_written_artifacts(tmp_path: Path) -> None:
    limits = ResourceLimits(**{**DEFAULT_LIMITS.to_dict(), "max_artifact_count": 2})
    h = Harness(tmp_path, registry=custom_registry(_writer(3, 4)))
    h.seed()
    result = h.run(make_request(profile=CUSTOM, limits=limits))
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)
    assert result.primary_error is not None
    assert result.primary_error.details["limit"] == "max_artifact_count"
    assert [a.logical_id for a in result.artifacts] == ["part-0", "part-1"]
    assert len(h.storage.keys(StoreName.ARTIFACTS)) == 2


def test_output_byte_limit(tmp_path: Path) -> None:
    limits = ResourceLimits(**{**DEFAULT_LIMITS.to_dict(), "max_output_bytes": 10})
    h = Harness(tmp_path, registry=custom_registry(_writer(3, 4)))
    h.seed()
    result = h.run(make_request(profile=CUSTOM, limits=limits))
    assert_error(result, ErrorCode.RESOURCE_LIMIT_EXCEEDED)
    assert result.primary_error is not None
    assert result.primary_error.details["limit"] == "max_output_bytes"
    assert len(result.artifacts) == 2


@pytest.mark.parametrize("logical_id", ["../escape", "a/b", "UPPER", "", "job-result"])
def test_hostile_or_reserved_logical_ids_refused(tmp_path: Path, logical_id: str) -> None:
    h = Harness(tmp_path, registry=custom_registry(_writer(1, 1, lambda i: logical_id)))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert result.status is ResultStatus.FAILED
    assert h.storage.keys(StoreName.ARTIFACTS) == []


def test_duplicate_logical_id_refused(tmp_path: Path) -> None:
    h = Harness(tmp_path, registry=custom_registry(_writer(2, 1, lambda i: "same")))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert_error(result, ErrorCode.ARTIFACT_CONFLICT)
    assert len(result.artifacts) == 1


def test_bad_artifact_content_type_writes_nothing(tmp_path: Path) -> None:
    def process(context: ProcessingContext) -> ProcessorOutput:
        context.write_artifact(
            logical_id="x",
            artifact_type="derived.part",
            data=b"1",
            content_type="Text/HTML; charset=evil",
            extension="bin",
        )
        return ProcessorOutput(verdict=Verdict.PASS)

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    assert h.run(make_request(profile=CUSTOM)).status is ResultStatus.FAILED
    assert h.storage.keys(StoreName.ARTIFACTS) == []


# Cleanup -------------------------------------------------------------------------------------


def test_cleanup_runs_after_failure_and_workspace_removed(tmp_path: Path) -> None:
    calls: list[Path] = []

    def process(context: ProcessingContext) -> ProcessorOutput:
        context.workspace.write("scratch.bin", b"temp")
        raise RuntimeError("boom")

    def cleanup(context: ProcessingContext) -> None:
        calls.append(context.workspace.root)

    h = Harness(tmp_path, registry=custom_registry(process, cleanup=cleanup))
    h.seed()
    h.run(make_request(profile=CUSTOM))
    assert len(calls) == 1
    assert not calls[0].exists()


def test_cleanup_failure_is_swallowed_and_reported(tmp_path: Path) -> None:
    def cleanup(context: ProcessingContext) -> None:
        raise OSError(SECRET)

    h = Harness(tmp_path, registry=custom_registry(_pass, cleanup=cleanup))
    h.seed()
    result = h.run(make_request(profile=CUSTOM))
    assert result.status is ResultStatus.SUCCEEDED
    failed = [f for n, f in h.telemetry.events if n == "job.cleanup_failed"]
    assert failed and failed[0]["exception_type"] == "OSError"
    assert SECRET not in repr(h.telemetry.events)


def test_workspace_cleanup_failure_is_swallowed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from lai_processing.core import workspace as workspace_module

    h = Harness(tmp_path)
    h.seed()

    def broken(*args: Any, **kwargs: Any) -> None:
        raise PermissionError("nope")

    monkeypatch.setattr(workspace_module.shutil, "rmtree", broken)
    result = h.engine.execute(make_request())
    assert result.status is ResultStatus.SUCCEEDED
    assert ("job.cleanup_failed") in h.telemetry.names()
    monkeypatch.undo()
    for leftover in h.root.iterdir():
        import shutil

        shutil.rmtree(leftover)


def test_input_copy_exists_during_processing_only(tmp_path: Path) -> None:
    seen: list[Path] = []

    def process(context: ProcessingContext) -> ProcessorOutput:
        assert context.input_path is not None
        assert context.input_path.read_bytes() == DATA
        assert context.input_path.parent == context.workspace.root
        seen.append(context.input_path)
        return ProcessorOutput(verdict=Verdict.PASS)

    h = Harness(tmp_path, registry=custom_registry(process))
    h.seed()
    h.run(make_request(profile=CUSTOM))
    assert seen and not seen[0].exists()


# Telemetry -----------------------------------------------------------------------------------


def test_telemetry_safe_fields_only_and_no_input_bytes(tmp_path: Path) -> None:
    payload = f"{SECRET} lives here".encode()
    h = Harness(tmp_path)
    h.storage.seed(_ref(), payload)
    h.run(make_request(payload, options={"metadata_level": "full"}))
    for _, fields in h.telemetry.events:
        assert set(fields) <= SAFE_FIELDS
    for _, _, _, fields in h.telemetry.metrics:
        assert set(fields) <= SAFE_FIELDS
    rendered = repr(h.telemetry.events) + repr(h.telemetry.metrics)
    assert SECRET not in rendered
    assert payload.hex()[:16] not in rendered
    final = dict(h.telemetry.events[-1][1])
    assert final["status"] == "succeeded" and final["verdict"] == "pass"
    assert final["error_code"] is None


def test_broken_telemetry_never_breaks_a_job(tmp_path: Path) -> None:
    class Broken:
        def event(self, name: str, **fields: Any) -> None:
            raise RuntimeError("telemetry down")

        def metric(self, name: str, value: float, **fields: Any) -> None:
            raise RuntimeError("telemetry down")

    h = Harness(tmp_path)
    h.engine.telemetry = Broken()
    h.seed()
    assert h.run(make_request()).status is ResultStatus.SUCCEEDED


# Completion, decoding, determinism -----------------------------------------------------------


def test_complete_inline_and_by_reference(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    result = h.run(make_request(options={"metadata_level": "full"}))
    inline = h.engine.complete(result, max_message_bytes=240 * 1024)
    assert inline.result == result and inline.result_ref is None
    assert decode_event(encode(inline)) == inline

    small = len(encode(inline)) - 1
    by_ref = h.engine.complete(result, max_message_bytes=small)
    assert by_ref.result is None and by_ref.result_ref is not None
    ref = by_ref.result_ref
    assert ref.logical_id == "job-result"
    assert ref.artifact_type == "report.job_result"
    assert ref.ref.key.endswith(f"/{JOB_ID}/{ATTEMPT_ID}/job-result.json")
    stored = h.storage.objects[("artifacts", ref.ref.key)][0].data
    assert stored == canonical_json(result.to_dict())
    by_ref.verify_result(decode_result(stored))
    assert decode_event(encode(by_ref)) == by_ref
    # Redelivery: storing the same result again is idempotent.
    assert h.engine.complete(result, max_message_bytes=small).result_ref == ref


def test_complete_resends_the_stored_result_of_a_rerun_attempt(tmp_path: Path) -> None:
    """A rerun's result has new timestamps; the attempt's stored job-result is reused."""
    h = Harness(tmp_path)
    h.seed()
    first = h.run(make_request(options={"metadata_level": "full"}))
    small = len(encode(h.engine.complete(first, max_message_bytes=240 * 1024))) - 1
    original = h.engine.complete(first, max_message_bytes=small)
    h.clock.advance(7)
    rerun = h.run(make_request(options={"metadata_level": "full"}))
    assert rerun != first
    event = h.engine.complete(rerun, max_message_bytes=small)
    assert event.result_ref == original.result_ref
    assert event.result_sha256 == original.result_sha256
    assert event.result_ref is not None
    stored = h.storage.read(event.result_ref.ref, max_bytes=1 << 22)
    event.verify_result(decode_result(stored))
    assert "job.result_reused" in h.telemetry.names()


@pytest.mark.parametrize("junk", [b"not json", b"{}"])
def test_complete_keeps_the_conflict_for_a_foreign_job_result(tmp_path: Path, junk: bytes) -> None:
    from lai_processing.ports.storage import ObjectExists

    h = Harness(tmp_path)
    h.seed()
    result = h.run(make_request(options={"metadata_level": "full"}))
    small = len(encode(h.engine.complete(result, max_message_bytes=240 * 1024))) - 1
    key = f"processing/artifacts/{NS}/{JOB_ID}/{ATTEMPT_ID}/job-result.json"
    h.storage.seed(ObjectRef(StoreName.ARTIFACTS, key, None, NS), junk)
    with pytest.raises(ObjectExists):
        h.engine.complete(result, max_message_bytes=small)


def test_complete_refuses_oversized_result_without_processor(tmp_path: Path) -> None:
    from lai_processing.core.errors import ProcessingError

    h = Harness(tmp_path)
    result = h.run(make_request(job_type="asset.validate_model"))
    assert result.processor is None
    with pytest.raises(ProcessingError) as info:
        h.engine.complete(result, max_message_bytes=100)
    assert info.value.code is ErrorCode.MESSAGE_TOO_LARGE
    assert h.storage.keys(StoreName.ARTIFACTS) == []


def test_decode_and_execute(tmp_path: Path) -> None:
    h = Harness(tmp_path)
    h.seed()
    result = h.engine.decode_and_execute(encode(make_request()))
    assert result.status is ResultStatus.SUCCEEDED


@pytest.mark.parametrize("body", [b"", b"{}", b"not json", b"[1]", b'{"kind": "x"}'])
def test_decode_and_execute_refuses_undecodable(tmp_path: Path, body: bytes) -> None:
    from lai_processing.core.errors import ProcessingError

    h = Harness(tmp_path)
    with pytest.raises(ProcessingError):
        h.engine.decode_and_execute(body)
    assert h.telemetry.events == []


def test_decode_and_execute_size_bound(tmp_path: Path) -> None:
    from lai_processing.core.errors import ProcessingError

    h = Harness(tmp_path)
    with pytest.raises(ProcessingError) as info:
        h.engine.decode_and_execute(encode(make_request()), max_message_bytes=50)
    assert info.value.code is ErrorCode.MESSAGE_TOO_LARGE


def test_determinism(tmp_path: Path) -> None:
    outputs = []
    for run in range(2):
        h = Harness(tmp_path / f"run{run}")
        h.seed()
        result = h.run(make_request(options={"metadata_level": "full", "write_report": True}))
        event = h.engine.complete(result, max_message_bytes=240 * 1024)
        outputs.append((encode(result), encode(event)))
    assert outputs[0] == outputs[1]


def test_reference_profile_is_the_default_profile() -> None:
    assert ReferenceProcessor().profiles() == (REFERENCE_PROFILE,)


def test_workspace_root_default_uses_system_temp(tmp_path: Path) -> None:
    storage = MemoryObjectStorage()
    storage.seed(_ref(), DATA)
    engine = ExecutionEngine(registry=default_registry(), storage=storage)
    result = engine.execute(make_request())
    assert result.status is ResultStatus.SUCCEEDED
    assert result.completed_at >= result.started_at
    assert os.path.isdir(tmp_path)
