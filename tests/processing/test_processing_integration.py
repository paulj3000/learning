"""Cross-module Wave 1 integration tests (principal-owned, LAI-LAMBDA-001).

These drive the whole Wave 1 seam together, with only in-memory adapters: a tiny stand-in for
Django (a dict of `JobSnapshot`s guarded by `check_transition` and `decide_completion`), a work
queue, the execution engine as the worker, a completion queue, and a consumer that acknowledges
only after its "commit". They prove the at-least-once design holds across modules: duplicates,
redelivery after a crash, retries with new attempts, late and forged completions, a consumer
that is down overnight, and a database that fails mid-commit. Wave 2 replaces the stand-in with
the real Django app (LAI-LAMBDA-004) and the fakes with SQS/S3 adapters (LAI-LAMBDA-003).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime

import pytest

from lai_processing.contracts import (
    CompletionEvent,
    InputObject,
    ObjectRef,
    ProcessingJobRequest,
    ProfileRef,
    ResultStatus,
    StoreName,
    SubjectRef,
    build_completion_event,
    decode_event,
    decode_request,
    decode_result,
    encode,
)
from lai_processing.core.errors import ErrorCode, ProcessingError, RetryClass
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.idempotency import request_idempotency_key
from lai_processing.core.lifecycle import (
    CompletionAction,
    InvalidTransition,
    JobSnapshot,
    JobState,
    check_transition,
    decide_completion,
)
from lai_processing.core.registry import default_registry
from lai_processing.core.retry import DEFAULT_RETRY_POLICY
from lai_processing.ports.storage import StorageUnavailable
from lai_processing.testing import ManualClock, MemoryObjectStorage, MemoryQueue, RecordingTelemetry

NS = "it"
DATA = b"Learning makes the island grow.\n"


def _uuid() -> str:
    return str(uuid.uuid4())


@dataclass
class FakeDjango:
    """The authoritative side: job rows, an applied-attempt ledger, guarded transitions."""

    storage: MemoryObjectStorage
    work: MemoryQueue
    jobs: dict[str, JobSnapshot] = field(default_factory=dict)
    requests: dict[str, ProcessingJobRequest] = field(default_factory=dict)
    fail_next_commit: bool = False
    security_signals: list[str] = field(default_factory=list)

    def submit(self, data: bytes = DATA) -> ProcessingJobRequest:
        job_id = _uuid()
        key = f"processing/quarantine/{NS}/{job_id}/input.bin"
        info = self.storage.seed(
            ObjectRef(StoreName.QUARANTINE, key, None, NS), data, content_type="text/plain"
        )
        draft = ProcessingJobRequest(
            job_id=job_id,
            job_type="reference.checksum",
            namespace=NS,
            subject=SubjectRef("upload", job_id),
            profile=ProfileRef("reference-default", 1),
            idempotency_key="ik1:" + "0" * 64,
            correlation_id=f"corr-{job_id[:8]}",
            attempt_id=_uuid(),
            attempt_number=1,
            submitted_at=datetime(2026, 11, 16, 12, 0, tzinfo=UTC),
            # Django resolves options against the profile before computing the key.
            options={"metadata_level": "full", "write_report": True},
            input=InputObject(
                ref=ObjectRef(StoreName.QUARANTINE, key, info.version_id, NS),
                content_type="text/plain",
                size_bytes=len(data),
                sha256=info.sha256 or "",
            ),
        )
        request = replace(draft, idempotency_key=request_idempotency_key(draft))
        self.jobs[job_id] = JobSnapshot(
            job_id=job_id,
            namespace=NS,
            state=JobState.CREATED,
            idempotency_key=request.idempotency_key,
            current_attempt_id=None,
            current_attempt_number=0,
            input_sha256=request.input.sha256 if request.input else None,
            applied_attempt_ids=frozenset(),
            max_attempts=DEFAULT_RETRY_POLICY.max_attempts,
        )
        self._dispatch(request)
        return request

    def _set_state(self, job_id: str, target: JobState, **changes: object) -> None:
        job = self.jobs[job_id]
        check_transition(job.state, target)
        self.jobs[job_id] = replace(job, state=target, **changes)  # type: ignore[arg-type]

    def _dispatch(self, request: ProcessingJobRequest) -> None:
        # Real Django: state change + outbox row in one transaction, then the relay sends.
        self._set_state(
            request.job_id,
            JobState.QUEUED,
            current_attempt_id=request.attempt_id,
            current_attempt_number=request.attempt_number,
        )
        self.requests[request.job_id] = request
        self.work.send(encode(request))

    def consume(self, completions: MemoryQueue) -> list[CompletionAction]:
        """Drain the completion queue. Acknowledge only after the commit succeeds."""
        actions: list[CompletionAction] = []
        while deliveries := completions.receive(max_messages=10):
            for delivery in deliveries:
                event = decode_event(delivery.body)
                result = event.result
                if result is None and event.result_ref is not None:
                    result = decode_result(
                        self.storage.read(event.result_ref.ref, max_bytes=1_000_000)
                    )
                    event.verify_result(result)
                decision = decide_completion(self.jobs[event.job_id], event, result)
                if self.fail_next_commit:
                    # The database is down: no ack, the message comes back later.
                    self.fail_next_commit = False
                    completions.release(delivery, delay_seconds=0)
                    continue
                self._commit(event, decision.action, decision.next_state)
                if decision.action is CompletionAction.REJECT:
                    self.security_signals.append(decision.reason)
                completions.ack(delivery)
                actions.append(decision.action)
        return actions

    def _commit(
        self, event: CompletionEvent, action: CompletionAction, next_state: JobState | None
    ) -> None:
        job = self.jobs[event.job_id]
        if action is CompletionAction.APPLY and next_state is not None:
            self._set_state(
                job.job_id,
                next_state,
                applied_attempt_ids=job.applied_attempt_ids | {event.attempt_id},
            )
        elif action is CompletionAction.RETRY:
            self.jobs[job.job_id] = replace(
                job, applied_attempt_ids=job.applied_attempt_ids | {event.attempt_id}
            )
            previous = self.requests[job.job_id]
            retry = replace(
                previous, attempt_id=_uuid(), attempt_number=previous.attempt_number + 1
            )
            self._dispatch(retry)

    def review(self, job_id: str) -> None:
        """Staff opens the validated job for review. Publication is a separate staff action
        on the asset, outside this state machine; nothing here can publish."""
        self._set_state(job_id, JobState.READY_FOR_REVIEW)


@dataclass
class World:
    clock: ManualClock
    storage: MemoryObjectStorage
    work: MemoryQueue
    completions: MemoryQueue
    django: FakeDjango
    engine: ExecutionEngine
    telemetry: RecordingTelemetry

    def run_worker(self, *, crash_before_ack: bool = False) -> int:
        """One worker pass (Lambda): execute, publish the completion, then delete the work."""
        handled = 0
        for delivery in self.work.receive(max_messages=10):
            request = decode_request(delivery.body)
            result = self.engine.execute(request)
            event = self.engine.complete(
                result, max_message_bytes=self.completions.max_message_bytes
            )
            self.completions.send(encode(event))
            if not crash_before_ack:
                self.work.ack(delivery)
            handled += 1
        return handled


@pytest.fixture
def world() -> World:
    clock = ManualClock()
    storage = MemoryObjectStorage()
    work = MemoryQueue(clock=clock.monotonic)
    completions = MemoryQueue(clock=clock.monotonic)
    telemetry = RecordingTelemetry()
    engine = ExecutionEngine(
        registry=default_registry(),
        storage=storage,
        telemetry=telemetry,
        clock=clock,
        namespace=NS,
    )
    return World(clock, storage, work, completions, FakeDjango(storage, work), engine, telemetry)


def test_happy_path_reaches_review_and_never_publishes(world: World) -> None:
    request = world.django.submit()
    assert world.run_worker() == 1
    assert world.django.consume(world.completions) == [CompletionAction.APPLY]
    assert world.django.jobs[request.job_id].state is JobState.VALIDATED
    world.django.review(request.job_id)
    assert world.django.jobs[request.job_id].state is JobState.READY_FOR_REVIEW
    # READY_FOR_REVIEW is terminal for the job; there is no publish transition in this machine.
    with pytest.raises(InvalidTransition):
        check_transition(JobState.READY_FOR_REVIEW, JobState.QUEUED)
    assert len(world.work) == 0 and len(world.completions) == 0


def test_duplicate_completion_delivery_is_applied_once(world: World) -> None:
    request = world.django.submit()
    world.run_worker()
    [message_id] = [m for m in world.completions._messages]  # noqa: SLF001 - test inspection
    world.completions.inject_duplicate(message_id)
    actions = world.django.consume(world.completions)
    assert sorted(actions) == sorted([CompletionAction.APPLY, CompletionAction.DUPLICATE])
    assert world.django.jobs[request.job_id].applied_attempt_ids == {request.attempt_id}


def test_worker_crash_redelivers_the_same_attempt_harmlessly(world: World) -> None:
    request = world.django.submit()
    world.run_worker(crash_before_ack=True)  # completion sent, work message never deleted
    world.work.expire_visibility()
    assert world.run_worker() == 1  # redelivered: the same attempt runs again
    # Identical artifacts at immutable attempt keys: the rewrite is idempotent, not a conflict.
    artifact_keys = world.storage.keys(StoreName.ARTIFACTS)
    assert artifact_keys == [
        f"processing/artifacts/{NS}/{request.job_id}/{request.attempt_id}/reference-report.json"
    ]
    actions = world.django.consume(world.completions)
    assert actions.count(CompletionAction.APPLY) == 1
    assert actions.count(CompletionAction.DUPLICATE) == 1


def test_retryable_failure_gets_a_new_attempt_with_the_same_logical_key(world: World) -> None:
    request = world.django.submit()
    world.storage.fail_next("open", StorageUnavailable())
    world.run_worker()
    assert world.django.consume(world.completions) == [CompletionAction.RETRY]
    retry = world.django.requests[request.job_id]
    assert retry.attempt_number == 2 and retry.attempt_id != request.attempt_id
    assert retry.idempotency_key == request.idempotency_key
    world.run_worker()
    assert world.django.consume(world.completions) == [CompletionAction.APPLY]
    assert world.django.jobs[request.job_id].state is JobState.VALIDATED


def test_a_late_event_from_a_superseded_attempt_is_ignored(world: World) -> None:
    request = world.django.submit()
    world.storage.fail_next("open", StorageUnavailable())
    world.run_worker()
    first_failure = world.completions.receive()[0].body
    world.completions.expire_visibility()
    world.django.consume(world.completions)  # RETRY: attempt 2 dispatched
    world.run_worker()
    world.django.consume(world.completions)  # attempt 2 applied
    world.completions.send(first_failure)  # the old attempt's event arrives again, late
    assert world.django.consume(world.completions) == [CompletionAction.DUPLICATE]
    assert world.django.jobs[request.job_id].state is JobState.VALIDATED


def test_retries_are_bounded(world: World) -> None:
    request = world.django.submit()
    for _ in range(DEFAULT_RETRY_POLICY.max_attempts):
        world.storage.fail_next("open", StorageUnavailable())
        world.run_worker()
        world.django.consume(world.completions)
    job = world.django.jobs[request.job_id]
    assert job.state is JobState.FAILED
    assert job.current_attempt_number == DEFAULT_RETRY_POLICY.max_attempts
    assert len(world.work) == 0


def test_completions_wait_while_django_is_stopped_then_drain(world: World) -> None:
    requests = [world.django.submit(DATA + bytes([i])) for i in range(5)]
    world.run_worker()  # Lambda keeps working overnight; Django and RDS are stopped.
    world.clock.advance(8 * 3600)
    assert len(world.completions) == 5
    actions = world.django.consume(world.completions)  # EC2 starts at 08:00 and drains.
    assert actions == [CompletionAction.APPLY] * 5
    assert {world.django.jobs[r.job_id].state for r in requests} == {JobState.VALIDATED}


def test_a_failed_commit_never_acknowledges_the_completion(world: World) -> None:
    request = world.django.submit()
    world.run_worker()
    world.django.fail_next_commit = True
    assert world.django.consume(world.completions) == [CompletionAction.APPLY]
    assert world.django.jobs[request.job_id].state is JobState.VALIDATED
    assert world.completions.acked and len(world.completions) == 0


def test_forged_completions_are_rejected_acknowledged_and_signalled(world: World) -> None:
    victim = world.django.submit()
    other = world.django.submit(b"something else\n")
    world.run_worker()
    honest_deliveries = world.completions.receive(max_messages=10)
    by_job = {decode_event(d.body).job_id: decode_event(d.body) for d in honest_deliveries}
    for delivery in honest_deliveries:
        world.completions.ack(delivery)  # set the honest events aside; deliver only forgeries
    honest = by_job[victim.job_id]
    assert honest.result is not None and honest.result.input is not None

    # 1. A self-consistent event for the victim's job that claims different input bytes.
    bad_input = replace(honest.result.input, sha256="f" * 64)
    swapped = replace(honest.result, input=bad_input)
    forged_input = build_completion_event(
        swapped, event_id=_uuid(), emitted_at=honest.emitted_at, max_message_bytes=240 * 1024
    )
    # 2. Another job's genuine event, replayed under that job's identity, is applied to that
    #    job only; re-addressing it to the victim cannot pass contract validation.
    with pytest.raises(ProcessingError):
        replace(by_job[other.job_id], job_id=victim.job_id)
    # 3. An event with the victim's ids but another logical job's idempotency key.
    wrong_key = replace(honest.result, idempotency_key=other.idempotency_key)
    forged_key = build_completion_event(
        wrong_key, event_id=_uuid(), emitted_at=honest.emitted_at, max_message_bytes=240 * 1024
    )
    world.completions.send(encode(forged_input))
    world.completions.send(encode(forged_key))
    actions = world.django.consume(world.completions)
    assert actions == [CompletionAction.REJECT, CompletionAction.REJECT]
    assert sorted(world.django.security_signals) == ["identity_mismatch", "input_mismatch"]
    assert world.django.jobs[victim.job_id].state is JobState.QUEUED  # untouched
    assert len(world.completions) == 0  # acknowledged: forgeries never loop


def test_worker_refuses_a_request_whose_key_does_not_match(world: World) -> None:
    request = world.django.submit()
    world.work.receive()  # take the honest message out of the way
    tampered = replace(request, options={"metadata_level": "basic", "write_report": True})
    result = world.engine.execute(tampered)
    assert result.status is ResultStatus.FAILED
    assert result.errors[0].code is ErrorCode.INVALID_INPUT
    assert dict(result.errors[0].details) == {"field": "idempotency_key"}
    assert result.input is None  # refused before any input byte was read


def test_by_reference_failure_must_carry_its_retry_class(world: World) -> None:
    world.django.submit()
    world.storage.fail_next("open", StorageUnavailable())
    world.run_worker()
    event = decode_event(world.completions.receive()[0].body)
    assert event.retry_class is RetryClass.RETRYABLE
    with pytest.raises(ProcessingError):
        replace(event, retry_class=None)
    with pytest.raises(ProcessingError):
        replace(event, retry_class=RetryClass.PERMANENT)


def test_large_results_travel_by_reference(world: World) -> None:
    request = world.django.submit()
    small = MemoryQueue(max_message_bytes=2048)
    assert len(encode(request)) < small.max_message_bytes
    for delivery in world.work.receive():
        result = world.engine.execute(decode_request(delivery.body))
        event = world.engine.complete(result, max_message_bytes=small.max_message_bytes)
        small.send(encode(event))
    assert world.django.consume(small) == [CompletionAction.APPLY]
    assert any(k.endswith("/job-result.json") for k in world.storage.keys(StoreName.ARTIFACTS))


def test_telemetry_carries_no_input_content(world: World) -> None:
    world.django.submit()
    world.run_worker()
    for _, fields in world.telemetry.events:
        for value in fields.values():
            assert "island" not in str(value)
