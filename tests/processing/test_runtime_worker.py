"""The shared worker core: WAVE2_INTERFACES.md section 5, record by record."""

from __future__ import annotations

import hashlib
import io
import json
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import IO

import pytest
from processing_samples import INPUT_BYTES, reference_request

from lai_processing.contracts.codec import decode_event, decode_result, encode
from lai_processing.contracts.common import ObjectRef, ProfileRef
from lai_processing.contracts.events import RESULT_ARTIFACT_TYPE
from lai_processing.contracts.identifiers import StoreName
from lai_processing.contracts.jobs import ProcessingJobRequest
from lai_processing.contracts.profiles import ProcessingProfile
from lai_processing.contracts.results import ResultStatus, Verdict
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.processor import (
    CancellationToken,
    ProcessingContext,
    Processor,
    ProcessorOutput,
)
from lai_processing.core.registry import ProcessorRegistry, default_registry
from lai_processing.ports.queue import QueueFull, SendReceipt
from lai_processing.ports.storage import ObjectInfo, StorageUnavailable
from lai_processing.testing.fakes import (
    ManualClock,
    MemoryObjectStorage,
    MemoryQueue,
    RecordingTelemetry,
)
from lai_processing_runtime.filesystem import FilesystemObjectStorage
from lai_processing_runtime.worker import (
    OutcomeReason,
    RecordOutcome,
    clamped_engine,
    job_budget_seconds,
    process_work_message,
)

MARGIN = 30


def ids() -> Callable[[], str]:
    counter = iter(range(1, 10_000))
    return lambda: str(uuid.UUID(int=next(counter), version=4))


class Harness:
    def __init__(
        self,
        tmp_path: Path,
        *,
        registry: ProcessorRegistry | None = None,
        completions: MemoryQueue | None = None,
        verify_keys: bool = True,
    ) -> None:
        self.clock = ManualClock()
        self.storage = MemoryObjectStorage()
        self.telemetry = RecordingTelemetry()
        self.completions = completions if completions is not None else MemoryQueue()
        self.engine = ExecutionEngine(
            registry=registry or default_registry(),
            storage=self.storage,
            telemetry=self.telemetry,
            clock=self.clock,
            namespace="local",
            workspace_root=tmp_path,
            id_factory=ids(),
            verify_idempotency_keys=verify_keys,
        )

    def seed(self, request: ProcessingJobRequest, data: bytes = INPUT_BYTES) -> None:
        assert request.input is not None
        self.storage.seed(request.input.ref, data, content_type="text/plain")

    def run(
        self, body: bytes, deadline: float = 600.0, **kwargs: CancellationToken
    ) -> RecordOutcome:
        return process_work_message(
            body,
            engine=self.engine,
            completions_queue=self.completions,
            deadline_seconds=deadline,
            margin=MARGIN,
            telemetry=self.telemetry,
            **kwargs,
        )

    def completion_bodies(self) -> list[bytes]:
        return [d.body for d in self.completions.receive(max_messages=100)]


@pytest.fixture
def h(tmp_path: Path) -> Iterator[Harness]:
    yield Harness(tmp_path)


def test_success_sends_a_valid_completion(h: Harness) -> None:
    request = reference_request()
    h.seed(request)
    outcome = h.run(encode(request))
    assert outcome.success and outcome.reason is OutcomeReason.COMPLETED
    [body] = h.completion_bodies()
    event = decode_event(body)
    assert event.job_id == request.job_id and event.attempt_id == request.attempt_id
    assert event.status is ResultStatus.SUCCEEDED
    assert event.result is not None and event.result.verdict is Verdict.PASS
    assert "work.completed" in h.telemetry.names()


def test_completion_send_failure_fails_the_record(tmp_path: Path) -> None:
    class Failing(MemoryQueue):
        def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
            raise QueueFull("down")

    h = Harness(tmp_path, completions=Failing())
    request = reference_request()
    h.seed(request)
    outcome = h.run(encode(request))
    assert not outcome.success
    assert outcome.reason is OutcomeReason.SEND_FAILED
    assert outcome.transport_failure
    names = h.telemetry.names()
    assert "work.completion_failed" in names and "work.completed" not in names


def test_duplicate_delivery_gives_an_identical_completion_and_idempotent_artifacts(
    tmp_path: Path,
) -> None:
    request = reference_request()
    bodies: list[bytes] = []
    storage = MemoryObjectStorage()
    storage.seed(request.input.ref, INPUT_BYTES)  # type: ignore[union-attr]
    for _ in range(2):
        h = Harness(tmp_path)
        h.storage = storage
        h.engine.storage = storage
        assert h.run(encode(request)).success
        bodies.extend(h.completion_bodies())
    assert bodies[0] == bodies[1]
    artifacts = storage.keys(StoreName.ARTIFACTS)
    assert len(artifacts) == 1
    assert len(storage.objects[("artifacts", artifacts[0])]) == 1  # no second version


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"not json SECRET-MARKER",
        b'{"kind":"lai.processing.job_request"}',
        b"[1,2,3]",
        b"\xff\xfe",
        json.dumps({"kind": "lai.processing.job_completed", "schema_version": 1}).encode(),
    ],
)
def test_undecodable_work_fails_without_a_completion(h: Harness, body: bytes) -> None:
    outcome = h.run(body)
    assert not outcome.success
    assert outcome.reason is OutcomeReason.INVALID_WORK
    assert not outcome.transport_failure
    assert h.completion_bodies() == []
    name, fields = h.telemetry.events[-1]
    assert name == "work.invalid"
    assert "SECRET" not in repr(fields)


def test_unsupported_schema_version_is_invalid_work(h: Harness) -> None:
    data = json.loads(encode(reference_request()))
    data["schema_version"] = 99
    outcome = h.run(json.dumps(data).encode())
    assert outcome.reason is OutcomeReason.INVALID_WORK
    assert outcome.error_code == "unsupported_schema_version"
    assert h.completion_bodies() == []


def test_oversized_work_message_is_invalid(h: Harness) -> None:
    outcome = h.run(b" " * (240 * 1024 + 1))
    assert outcome.reason is OutcomeReason.INVALID_WORK
    assert outcome.error_code == "message_too_large"


def test_retryable_result_produces_a_completion(h: Harness) -> None:
    request = reference_request()
    h.seed(request)
    h.storage.fail_next("head", StorageUnavailable())
    outcome = h.run(encode(request))
    assert outcome.success
    assert outcome.retry_class == "retryable"
    event = decode_event(h.completion_bodies()[0])
    assert event.status is ResultStatus.FAILED
    assert event.retry_class is not None and event.retry_class.value == "retryable"


def test_permanent_result_produces_a_completion(h: Harness) -> None:
    request = reference_request()
    h.seed(request, b"different bytes, same length!!!\n")
    outcome = h.run(encode(request))
    assert outcome.success
    assert outcome.retry_class == "permanent"
    assert outcome.error_code == "checksum_mismatch"


def test_namespace_mismatch_is_a_permanent_completion(h: Harness) -> None:
    h.engine.namespace = "dev"
    request = reference_request()
    h.seed(request)
    outcome = h.run(encode(request))
    assert outcome.success and outcome.error_code == "namespace_mismatch"


def slow_registry(clock: ManualClock) -> ProcessorRegistry:
    profile = ProcessingProfile(
        profile_id="slow", version=1, job_type="reference.checksum", description="slow"
    )

    class Slow(Processor):
        processor_id = "test.slow"
        version = "0.1.0"
        job_types = frozenset({"reference.checksum"})

        def profiles(self) -> tuple[ProcessingProfile, ...]:
            return (profile,)

        def process(self, context: ProcessingContext) -> ProcessorOutput:
            for _ in range(100):
                clock.advance(1.0)
                context.check()
            return ProcessorOutput(verdict=Verdict.PASS)

    registry = ProcessorRegistry()
    registry.register(Slow())
    registry.freeze()
    return registry


def test_deadline_clamp_turns_a_long_job_into_processing_timeout(tmp_path: Path) -> None:
    h = Harness(tmp_path, verify_keys=False)
    h.engine.registry = slow_registry(h.clock)
    request = reference_request(profile=ProfileRef("slow", 1), options={})
    h.seed(request)
    outcome = h.run(encode(request), deadline=MARGIN + 5)
    assert outcome.success
    assert outcome.error_code == "processing_timeout"
    assert outcome.retry_class == "retryable"
    event = decode_event(h.completion_bodies()[0])
    assert event.result is not None and event.result.duration_ms <= 6000


def test_insufficient_time_starts_nothing(h: Harness) -> None:
    request = reference_request()
    h.seed(request)
    outcome = h.run(encode(request), deadline=MARGIN - 1)
    assert outcome.reason is OutcomeReason.INSUFFICIENT_TIME
    assert h.completion_bodies() == []
    assert "job.started" not in h.telemetry.names()


def test_budget_and_clamp() -> None:
    assert job_budget_seconds(10_000, 30) == 840
    assert job_budget_seconds(600, 30) == 570
    assert job_budget_seconds(30.5, 30) == 1
    assert job_budget_seconds(0, 30) == 1
    engine = ExecutionEngine(registry=default_registry(), storage=MemoryObjectStorage())
    clamped = clamped_engine(engine, 100)
    assert clamped.ceilings.max_execution_seconds == 100
    assert clamped.ceilings.max_input_bytes == engine.ceilings.max_input_bytes
    assert engine.ceilings.max_execution_seconds == 840  # the original is untouched
    assert clamped.storage is engine.storage


def test_oversized_result_goes_by_reference(tmp_path: Path) -> None:
    h = Harness(tmp_path, completions=MemoryQueue(max_message_bytes=2000))
    request = reference_request()
    h.seed(request)
    assert h.run(encode(request)).success
    event = decode_event(h.completion_bodies()[0])
    assert event.result is None and event.result_ref is not None
    assert event.result_ref.artifact_type == RESULT_ARTIFACT_TYPE
    assert ("artifacts", event.result_ref.ref.key) in h.storage.objects


def test_failure_to_store_a_by_reference_result_fails_the_record(tmp_path: Path) -> None:
    class SecondPutFails(MemoryObjectStorage):
        puts = 0

        def put(
            self,
            ref: ObjectRef,
            data: IO[bytes],
            *,
            content_type: str,
            sha256: str,
            size_bytes: int,
        ) -> ObjectInfo:
            SecondPutFails.puts += 1
            if SecondPutFails.puts == 2:
                raise StorageUnavailable()
            return super().put(
                ref, data, content_type=content_type, sha256=sha256, size_bytes=size_bytes
            )

    h = Harness(tmp_path, completions=MemoryQueue(max_message_bytes=2000))
    h.storage = SecondPutFails()
    h.engine.storage = h.storage
    request = reference_request()
    h.seed(request)
    outcome = h.run(encode(request))
    assert outcome.reason is OutcomeReason.COMPLETION_FAILED
    assert h.completion_bodies() == []


def test_interruption_is_not_reported_as_a_cancellation(h: Harness) -> None:
    request = reference_request()
    h.seed(request)
    token = CancellationToken()
    token.cancel()
    outcome = h.run(encode(request), cancellation=token)
    assert outcome.reason is OutcomeReason.INTERRUPTED
    assert h.completion_bodies() == []


def test_telemetry_never_carries_the_body(h: Harness) -> None:
    request = reference_request()
    h.seed(request)
    h.run(encode(request))
    h.run(b'{"kind":"SECRET-MARKER"}')
    rendered = repr(h.telemetry.events) + repr(h.telemetry.metrics)
    assert "SECRET" not in rendered
    assert "Learning makes the island grow" not in rendered


class _FailFirstSend(MemoryQueue):
    """A completions queue whose first send fails (after `complete` stored the result)."""

    def __init__(self, max_message_bytes: int) -> None:
        super().__init__(max_message_bytes=max_message_bytes)
        self.sends = 0

    def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
        self.sends += 1
        if self.sends == 1:
            raise QueueFull("down")
        return super().send(body, delay_seconds=delay_seconds)


@pytest.mark.parametrize("backend", ["memory", "filesystem"])
def test_by_reference_completion_survives_a_failed_send_and_a_later_clock(
    tmp_path: Path, backend: str
) -> None:
    """Redelivery after a failed send reruns with new timestamps: the stored job-result is
    this attempt's own and is resent, instead of conflicting forever (COMPLETION_FAILED)."""
    queue = _FailFirstSend(max_message_bytes=2000)
    h = Harness(tmp_path / "ws", completions=queue)
    if backend == "filesystem":
        roots = {
            StoreName.ASSETS: tmp_path / "assets",
            StoreName.QUARANTINE: tmp_path / "proc",
            StoreName.ARTIFACTS: tmp_path / "proc",
        }
        fs = FilesystemObjectStorage(
            roots, writable=frozenset({StoreName.ARTIFACTS, StoreName.QUARANTINE})
        )
        h.engine.storage = fs  # type: ignore[assignment]
        request = reference_request()
        assert request.input is not None
        fs.put(
            request.input.ref,
            io.BytesIO(INPUT_BYTES),
            content_type="text/plain",
            sha256=hashlib.sha256(INPUT_BYTES).hexdigest(),
            size_bytes=len(INPUT_BYTES),
        )
    else:
        request = reference_request()
        h.seed(request)
    (tmp_path / "ws").mkdir(exist_ok=True)

    first = h.run(encode(request))
    assert first.reason is OutcomeReason.SEND_FAILED
    h.clock.advance(5)
    second = h.run(encode(request))
    assert second.success and second.reason is OutcomeReason.COMPLETED
    [body] = h.completion_bodies()
    event = decode_event(body)
    assert event.result_ref is not None
    stored = h.engine.storage.read(event.result_ref.ref, max_bytes=1 << 22)
    original = decode_result(stored)
    event.verify_result(original)  # what Django does after reading result_ref
    assert event.result_ref.belongs_to(request.job_id, request.attempt_id)
    assert "job.result_reused" in h.telemetry.names()
