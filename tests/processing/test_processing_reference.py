"""Reference processor: deterministic, content-safe checksum metadata."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from lai_processing.contracts import (
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
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.limits import DEFAULT_LIMITS
from lai_processing.core.processor import CancellationToken, ProcessingContext
from lai_processing.core.registry import default_registry
from lai_processing.core.workspace import Workspace
from lai_processing.processors.reference import REFERENCE_PROFILE, ReferenceProcessor
from lai_processing.testing import ManualClock, MemoryObjectStorage, RecordingTelemetry

NS = "test"
JOB_ID = "11111111-1111-4111-8111-111111111111"
ATTEMPT_ID = "22222222-2222-4222-8222-222222222222"
KEY = f"processing/quarantine/{NS}/{JOB_ID}/input.bin"


def make_request(data: bytes, options: dict[str, Any] | None = None) -> ProcessingJobRequest:
    return ProcessingJobRequest(
        job_id=JOB_ID,
        job_type="reference.checksum",
        namespace=NS,
        subject=SubjectRef("upload", "u-1"),
        profile=ProfileRef("reference-default", 1),
        idempotency_key="ik1:" + "b" * 64,
        correlation_id="corr-0002",
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
    )


def run(tmp_path: Path, data: bytes, options: dict[str, Any] | None = None) -> Any:
    tmp_path.mkdir(parents=True, exist_ok=True)
    storage = MemoryObjectStorage()
    storage.seed(ObjectRef(StoreName.QUARANTINE, KEY, None, NS), data)
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=RecordingTelemetry(),
        clock=ManualClock(),
        workspace_root=tmp_path,
    )
    result = engine.execute(make_request(data, options))
    assert decode_result(encode(result)) == result
    return result, storage


def test_basic_metadata(tmp_path: Path) -> None:
    data = b"glTF\x02\x00\x00\x00binary"
    result, storage = run(tmp_path, data)
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.PASS
    assert dict(result.metadata) == {
        "byte_count": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "content_type": "model/gltf-binary",
        "checksum_verified": True,
    }
    assert result.findings == ()
    assert result.artifacts == ()
    assert storage.keys(StoreName.ARTIFACTS) == []


def test_full_metadata(tmp_path: Path) -> None:
    data = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ\x00\x01\x02\x03"
    result, _ = run(tmp_path, data, {"metadata_level": "full"})
    assert result.metadata["leading_bytes_hex"] == data[:16].hex()
    assert result.metadata["ascii_printable_permille"] == 26 * 1000 // 30


def test_full_metadata_short_input(tmp_path: Path) -> None:
    result, _ = run(tmp_path, b"hi", {"metadata_level": "full"})
    assert result.metadata["leading_bytes_hex"] == "6869"
    assert result.metadata["ascii_printable_permille"] == 1000


def test_empty_input_warns_but_passes(tmp_path: Path) -> None:
    result, _ = run(tmp_path, b"", {"metadata_level": "full"})
    assert result.status is ResultStatus.SUCCEEDED
    assert result.verdict is Verdict.PASS
    assert [(f.code, f.severity.value) for f in result.findings] == [("empty_input", "warning")]
    assert result.metadata["byte_count"] == 0
    assert result.metadata["ascii_printable_permille"] == 0
    assert result.metadata["leading_bytes_hex"] == ""


def test_multi_chunk_input(tmp_path: Path) -> None:
    data = bytes(range(256)) * 9000  # > 2 MiB, several chunks
    result, _ = run(tmp_path, data, {"metadata_level": "full"})
    assert result.metadata["sha256"] == hashlib.sha256(data).hexdigest()
    assert result.metadata["byte_count"] == len(data)


def test_write_report_artifact(tmp_path: Path) -> None:
    data = b"report me"
    result, storage = run(tmp_path, data, {"write_report": True})
    assert len(result.artifacts) == 1
    artifact = result.artifacts[0]
    assert artifact.logical_id == "reference-report"
    assert artifact.artifact_type == "report.reference"
    assert artifact.content_type == "application/json"
    body = storage.objects[("artifacts", artifact.ref.key)][0].data
    assert body == canonical_json(dict(result.metadata))


def test_metadata_has_no_timestamps_paths_or_ids(tmp_path: Path) -> None:
    result, _ = run(tmp_path, b"abc", {"metadata_level": "full"})
    rendered = canonical_json(dict(result.metadata)).decode()
    for forbidden in (JOB_ID, ATTEMPT_ID, str(tmp_path), "2026", "input.bin", KEY):
        assert forbidden not in rendered


def test_deterministic_across_runs(tmp_path: Path) -> None:
    data = b"same bytes"
    a, _ = run(tmp_path / "a", data, {"metadata_level": "full", "write_report": True})
    b, _ = run(tmp_path / "b", data, {"metadata_level": "full", "write_report": True})
    assert a.status is ResultStatus.SUCCEEDED
    assert encode(a) == encode(b)


def _context(tmp_path: Path, data: bytes | None, ws: Workspace) -> ProcessingContext:
    request = make_request(data or b"")
    processor = ReferenceProcessor()
    context = ProcessingContext(
        request=request,
        profile=REFERENCE_PROFILE,
        options=REFERENCE_PROFILE.resolve_options({}),
        limits=DEFAULT_LIMITS,
        storage=MemoryObjectStorage(),
        telemetry=RecordingTelemetry(),
        clock=ManualClock(),
        workspace=ws,
        cancellation=CancellationToken(),
        deadline=ManualClock().monotonic() + 100,
        processor=processor.identity,
    )
    if data is not None:
        context.input_path = ws.write("input.bin", data)
    return context


def test_refuses_without_input_path(tmp_path: Path) -> None:
    with Workspace.create(max_bytes=1000, root=tmp_path) as ws:
        context = _context(tmp_path, None, ws)
        for step in (ReferenceProcessor().validate, ReferenceProcessor().process):
            with pytest.raises(ProcessingError) as info:
                step(context)
            assert info.value.code is ErrorCode.INVALID_INPUT


def test_refuses_tampered_workspace_copy(tmp_path: Path) -> None:
    with Workspace.create(max_bytes=1000, root=tmp_path) as ws:
        context = _context(tmp_path, b"original", ws)
        assert context.input_path is not None
        context.input_path.write_bytes(b"tampered")
        with pytest.raises(ProcessingError) as info:
            ReferenceProcessor().process(context)
        assert info.value.code is ErrorCode.CHECKSUM_MISMATCH


def test_observes_cancellation(tmp_path: Path) -> None:
    with Workspace.create(max_bytes=1000, root=tmp_path) as ws:
        context = _context(tmp_path, b"data", ws)
        context.cancellation.cancel()
        with pytest.raises(ProcessingError) as info:
            ReferenceProcessor().process(context)
        assert info.value.code is ErrorCode.CANCELLED


def test_identity_and_profile() -> None:
    processor = ReferenceProcessor()
    assert processor.identity.processor_id == "reference.checksum"
    assert processor.identity.processor_version == "1.0.0"
    assert processor.job_types == frozenset({"reference.checksum"})
    (profile,) = processor.profiles()
    assert profile.ref == ProfileRef("reference-default", 1)
    assert dict(profile.resolve_options({})) == {"metadata_level": "basic", "write_report": False}
