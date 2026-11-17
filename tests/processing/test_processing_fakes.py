"""In-memory adapters: at-least-once queue and create-only versioned object storage."""

from __future__ import annotations

import io
import logging
from datetime import UTC, datetime

import pytest

from lai_processing.contracts import ObjectRef, StoreName
from lai_processing.core.canonical import sha256_hex
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.ports import (
    Clock,
    LoggingTelemetry,
    MessageQueue,
    NullTelemetry,
    ObjectExists,
    ObjectMissing,
    ObjectStorage,
    StoragePermissionDenied,
    StorageUnavailable,
    Telemetry,
)
from lai_processing.testing import (
    ManualClock,
    MemoryObjectStorage,
    MemoryQueue,
    RecordingTelemetry,
)

JOB = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"
ATT = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d"
ART = ObjectRef(
    StoreName.ARTIFACTS, f"processing/artifacts/local/{JOB}/{ATT}/report.json", None, "local"
)
INP = ObjectRef(StoreName.QUARANTINE, f"processing/quarantine/local/{JOB}/input.bin", None, "local")
ASSET = ObjectRef(StoreName.ASSETS, "assets/models/npc-pip/v1/model.glb", None, "local")


class Ticker:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _queue(**kwargs: object) -> tuple[MemoryQueue, Ticker]:
    ticker = Ticker()
    return MemoryQueue(clock=ticker, **kwargs), ticker  # type: ignore[arg-type]


# --- queue -------------------------------------------------------------------------------------


def test_queue_satisfies_port() -> None:
    assert isinstance(MemoryQueue(), MessageQueue)


def test_send_receive_ack() -> None:
    queue, _ = _queue()
    receipt = queue.send(b"hello")
    [delivery] = queue.receive()
    assert (delivery.message_id, delivery.body, delivery.receive_count) == (
        receipt.message_id,
        b"hello",
        1,
    )
    queue.ack(delivery)
    assert len(queue) == 0 and queue.acked == [receipt.message_id]
    assert queue.receive() == []


def test_in_flight_message_is_hidden_until_visibility_expires() -> None:
    queue, ticker = _queue()
    queue.send(b"m")
    [first] = queue.receive(visibility_seconds=30)
    assert queue.receive() == []
    ticker.now = 29.9
    assert queue.receive() == []
    ticker.now = 30
    [again] = queue.receive()
    assert again.message_id == first.message_id
    assert again.receipt != first.receipt
    assert again.receive_count == 2


def test_expire_visibility_redelivers_after_consumer_crash() -> None:
    queue, _ = _queue()
    queue.send(b"m")
    [first] = queue.receive(visibility_seconds=300)
    queue.expire_visibility()
    [second] = queue.receive()
    assert second.message_id == first.message_id and second.receive_count == 2


def test_stale_receipt_ack_is_ignored() -> None:
    queue, _ = _queue()
    queue.send(b"m")
    [first] = queue.receive()
    queue.expire_visibility()
    [second] = queue.receive()
    queue.ack(first)
    assert len(queue) == 1 and queue.acked == []
    queue.release(first, delay_seconds=0)
    queue.ack(second)
    assert len(queue) == 0


def test_release_with_delay() -> None:
    queue, ticker = _queue()
    queue.send(b"m")
    [delivery] = queue.receive(visibility_seconds=300)
    queue.release(delivery, delay_seconds=60)
    assert queue.receive() == []
    ticker.now = 60
    assert len(queue.receive()) == 1


def test_delayed_send() -> None:
    queue, ticker = _queue()
    queue.send(b"m", delay_seconds=10)
    assert queue.receive() == []
    ticker.now = 10
    assert len(queue.receive()) == 1


def test_injected_duplicate_is_a_separate_delivery_with_same_body() -> None:
    queue, _ = _queue()
    original = queue.send(b"same")
    duplicate = queue.inject_duplicate(original.message_id)
    deliveries = queue.receive(max_messages=10)
    assert [d.body for d in deliveries] == [b"same", b"same"]
    assert {d.message_id for d in deliveries} == {original.message_id, duplicate}


def test_dead_letter_after_max_receives() -> None:
    queue, _ = _queue(max_receive_count=3)
    queue.send(b"poison")
    for count in (1, 2, 3):
        [delivery] = queue.receive()
        assert delivery.receive_count == count
        queue.expire_visibility()
    assert queue.receive() == []
    assert queue.dead_letters == [b"poison"] and len(queue) == 0


def test_max_messages_bound() -> None:
    queue, _ = _queue()
    for i in range(5):
        queue.send(bytes([i]))
    assert len(queue.receive(max_messages=2)) == 2
    assert len(queue.receive(max_messages=10)) == 3


def test_size_limit() -> None:
    queue, _ = _queue(max_message_bytes=10)
    queue.send(b"x" * 10)
    with pytest.raises(ValueError):
        queue.send(b"x" * 11)
    assert len(queue) == 1


def test_body_is_copied() -> None:
    queue, _ = _queue()
    body = bytearray(b"abc")
    queue.send(body)  # type: ignore[arg-type]
    body[0] = ord("z")
    assert queue.receive()[0].body == b"abc"


# --- storage -----------------------------------------------------------------------------------


def _put(storage: MemoryObjectStorage, ref: ObjectRef, data: bytes) -> object:
    return storage.put(
        ref,
        io.BytesIO(data),
        content_type="application/json",
        sha256=sha256_hex(data),
        size_bytes=len(data),
    )


def test_storage_satisfies_port() -> None:
    assert isinstance(MemoryObjectStorage(), ObjectStorage)


def test_seed_head_open_read() -> None:
    storage = MemoryObjectStorage()
    info = storage.seed(INP, b"data", content_type="text/plain")
    assert info.size_bytes == 4 and info.sha256 == sha256_hex(b"data")
    assert info.ref.version_id == info.version_id
    assert storage.head(INP) == info
    with storage.open(INP) as stream:
        assert stream.read() == b"data"
    assert storage.read(INP, max_bytes=4) == b"data"


def test_read_refuses_oversized() -> None:
    storage = MemoryObjectStorage()
    storage.seed(INP, b"12345")
    with pytest.raises(ProcessingError) as err:
        storage.read(INP, max_bytes=4)
    assert err.value.code is ErrorCode.RESOURCE_LIMIT_EXCEEDED


def test_missing_object_and_missing_version() -> None:
    storage = MemoryObjectStorage()
    with pytest.raises(ObjectMissing) as err:
        storage.head(INP)
    assert err.value.code is ErrorCode.INPUT_MISSING
    storage.seed(INP, b"v1")
    with pytest.raises(ObjectMissing):
        storage.head(ObjectRef(INP.store, INP.key, "v999999", "local"))


def test_versioned_reads_never_substitute_a_newer_version() -> None:
    storage = MemoryObjectStorage()
    v1 = storage.seed(INP, b"first")
    v2 = storage.seed(INP, b"second")
    assert v1.version_id != v2.version_id
    pinned = ObjectRef(INP.store, INP.key, v1.version_id, "local")
    assert storage.read(pinned, max_bytes=100) == b"first"
    assert storage.read(INP, max_bytes=100) == b"second"


def test_put_is_create_only() -> None:
    storage = MemoryObjectStorage()
    first = _put(storage, ART, b'{"a":1}')
    again = _put(storage, ART, b'{"a":1}')
    assert again == first
    with pytest.raises(ObjectExists) as err:
        _put(storage, ART, b'{"a":2}')
    assert err.value.code is ErrorCode.ARTIFACT_CONFLICT
    assert storage.read(ART, max_bytes=100) == b'{"a":1}'


def test_put_verifies_checksum_and_size() -> None:
    storage = MemoryObjectStorage()
    with pytest.raises(ProcessingError) as err:
        storage.put(ART, io.BytesIO(b"abc"), content_type="x/y", sha256="0" * 64, size_bytes=3)
    assert err.value.code is ErrorCode.CHECKSUM_MISMATCH
    with pytest.raises(ProcessingError):
        storage.put(
            ART, io.BytesIO(b"abc"), content_type="x/y", sha256=sha256_hex(b"abc"), size_bytes=4
        )
    assert storage.keys(StoreName.ARTIFACTS) == []


@pytest.mark.parametrize("ref", [INP, ASSET])
def test_workers_cannot_write_input_stores(ref: ObjectRef) -> None:
    storage = MemoryObjectStorage()
    with pytest.raises(StoragePermissionDenied) as err:
        _put(storage, ref, b"x")
    assert err.value.code is ErrorCode.PERMISSION_DENIED


def test_assets_store_cannot_be_deleted() -> None:
    storage = MemoryObjectStorage()
    storage.seed(ASSET, b"glb")
    with pytest.raises(StoragePermissionDenied):
        storage.delete(ASSET)
    assert storage.read(ASSET, max_bytes=10) == b"glb"


def test_delete_owned_and_missing() -> None:
    storage = MemoryObjectStorage()
    _put(storage, ART, b"{}")
    storage.delete(ART)
    storage.delete(ART)
    assert storage.deleted == [(StoreName.ARTIFACTS.value, ART.key)]
    assert storage.keys(StoreName.ARTIFACTS) == []


@pytest.mark.parametrize("operation", ["head", "open", "read", "put", "delete"])
def test_fault_injection_is_one_shot(operation: str) -> None:
    storage = MemoryObjectStorage()
    storage.seed(ART, b"{}")
    storage.fail_next(operation, StorageUnavailable({"phase": "test"}))

    def call() -> object:
        if operation == "head":
            return storage.head(ART)
        if operation == "open":
            return storage.open(ART)
        if operation == "read":
            return storage.read(ART, max_bytes=10)
        if operation == "put":
            return _put(storage, ART, b"{}")
        return storage.delete(ART)

    with pytest.raises(StorageUnavailable) as err:
        call()
    assert err.value.retryable
    call()


def test_storage_error_codes() -> None:
    assert StorageUnavailable().code is ErrorCode.STORAGE_FAILURE
    assert ObjectMissing().retry_class.value == "manual"
    assert ObjectExists().retry_class.value == "manual"


# --- telemetry and clock -----------------------------------------------------------------------


def test_recording_telemetry_enforces_vocabulary() -> None:
    telemetry = RecordingTelemetry()
    assert isinstance(telemetry, Telemetry)
    telemetry.event("job.started", job_id=JOB, attempt_number=1)
    telemetry.metric("job.duration", 12.5, unit="Milliseconds", job_type="reference.checksum")
    assert telemetry.names() == ["job.started"]
    assert telemetry.metrics[0][:3] == ("job.duration", 12.5, "Milliseconds")
    for bad in (
        {"file_name": "x"},
        {"job_id": ["list"]},
        {"job_id": "a\nb"},
        {"job_id": "x" * 129},
    ):
        with pytest.raises(ValueError):
            telemetry.event("job.started", **bad)  # type: ignore[arg-type]
    assert len(telemetry.events) == 1


def test_null_and_logging_telemetry_check_fields(caplog: pytest.LogCaptureFixture) -> None:
    with pytest.raises(ValueError):
        NullTelemetry().event("x", message="free text")  # type: ignore[arg-type]
    logger = logging.getLogger("test_processing_fakes")
    with caplog.at_level(logging.INFO, logger="test_processing_fakes"):
        LoggingTelemetry(logger).event("job.done", status="succeeded", job_id=JOB)
    assert f"job.done job_id={JOB} status=succeeded" in caplog.text
    with pytest.raises(ValueError):
        LoggingTelemetry(logger).metric("m", 1, exception_message="boom")  # type: ignore[arg-type]


def test_manual_clock() -> None:
    clock = ManualClock()
    assert isinstance(clock, Clock)
    start, mono = clock.now(), clock.monotonic()
    assert start.tzinfo is not None
    clock.advance(2.5)
    assert (clock.now() - start).total_seconds() == 2.5
    assert clock.monotonic() - mono == 2.5
    assert ManualClock(datetime(2030, 1, 1, tzinfo=UTC)).now().year == 2030
