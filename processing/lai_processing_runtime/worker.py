"""The per-record worker core shared by the Lambda handler and the local worker.

`process_work_message` implements docs/processing/WAVE2_INTERFACES.md, section 5, exactly:

1. Less remaining time than the cleanup margin: do not start; the record fails.
2. Decode, then execute with `max_execution_seconds` clamped to `remaining - margin` (at least
   1 s, at most 840 s and never above the engine's own ceiling), so a deadline becomes a
   `processing_timeout` result (retryable), never a silent kill.
3. `complete` (inline, or by reference when the result does not fit the completion queue).
4. Send the completion. Before 3 and before 4 the remaining time is read again (when the
   runtime can, the Lambda): too little for one AWS call fails the record (redelivered).
5. The record succeeds only after the send succeeded. Any failure on steps 3 or 4 fails the
   record, so the transport redelivers it and the same attempt reruns; artifacts are
   create-only and identical rewrites are idempotent, and Django deduplicates the second
   completion.

An undecodable work message (bad JSON, wrong kind, unsupported schema version, invalid
contract) produces no completion: there is no job to report on. The record fails, is logged as
`work.invalid` with only the error code and receive count, and reaches the DLQ after
`maxReceiveCount` receives.

An interruption (the caller's `CancellationToken`, cancelled because the worker is shutting
down) is not a job cancellation: a CANCELLED result caused by it is not sent, and the record
fails so the work is redelivered later.

Nothing here acknowledges a message; the caller does, and only on `RecordOutcome.success`.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from lai_processing.contracts.codec import DEFAULT_MAX_MESSAGE_BYTES, decode_request, encode
from lai_processing.contracts.results import ResultStatus
from lai_processing.core.errors import ProcessingError
from lai_processing.core.execution import ExecutionEngine
from lai_processing.core.limits import PLATFORM_CEILINGS
from lai_processing.core.processor import CancellationToken
from lai_processing.ports.queue import MessageQueue
from lai_processing.ports.telemetry import NullTelemetry, Telemetry

__all__ = [
    "MAX_JOB_SECONDS",
    "OutcomeReason",
    "RecordOutcome",
    "clamped_engine",
    "job_budget_seconds",
    "process_work_message",
]

MAX_JOB_SECONDS: Final = PLATFORM_CEILINGS.max_execution_seconds  # 840


class OutcomeReason(StrEnum):
    COMPLETED = "completed"
    INSUFFICIENT_TIME = "insufficient_time"
    INVALID_WORK = "invalid_work"
    COMPLETION_FAILED = "completion_failed"
    SEND_FAILED = "send_failed"
    INTERRUPTED = "interrupted"


@dataclass(frozen=True, slots=True)
class RecordOutcome:
    """What happened to one work record. `success` means: acknowledge it (the completion was
    sent). Otherwise the transport must redeliver it (a batch item failure, or a release)."""

    success: bool
    reason: OutcomeReason
    job_id: str | None = None
    attempt_id: str | None = None
    status: str | None = None
    retry_class: str | None = None
    error_code: str | None = None

    @property
    def transport_failure(self) -> bool:
        """A failure the job itself did not cause (time, the completion path, interruption)."""
        return not self.success and self.reason is not OutcomeReason.INVALID_WORK


def job_budget_seconds(remaining_seconds: float, margin_seconds: int) -> int:
    """The execution budget for one job: `remaining - margin`, within 1..840 seconds."""
    return max(1, min(MAX_JOB_SECONDS, int(remaining_seconds - margin_seconds)))


def clamped_engine(engine: ExecutionEngine, budget_seconds: int) -> ExecutionEngine:
    """A copy of `engine` whose execution ceiling is at most `budget_seconds`."""
    ceiling = min(engine.ceilings.max_execution_seconds, budget_seconds)
    ceilings = dataclasses.replace(engine.ceilings, max_execution_seconds=max(1, ceiling))
    return dataclasses.replace(engine, ceilings=ceilings)


def _emit(telemetry: Telemetry, name: str, **fields: str | int | None) -> None:
    try:
        telemetry.event(name, **fields)
    except Exception:  # noqa: BLE001, S110 - telemetry must never change an outcome
        pass


def process_work_message(
    body: bytes,
    *,
    engine: ExecutionEngine,
    completions_queue: MessageQueue,
    deadline_seconds: float,
    margin: int,
    cancellation: CancellationToken | None = None,
    telemetry: Telemetry | None = None,
    receive_count: int | None = None,
    time_left: Callable[[], float] | None = None,
    call_seconds: float = 0.0,
) -> RecordOutcome:
    """Run one work message to a sent completion. `deadline_seconds` is the time left before
    the runtime's hard deadline (the Lambda remaining time, or the local job timeout).

    With `time_left` (a fresh reading of that remaining time), the time is checked again
    before the completion is stored and before it is sent: when less than `call_seconds` (the
    longest one storage or queue call can take) remains, the record fails as
    INSUFFICIENT_TIME instead of being killed mid-call, and the redelivered attempt reruns."""
    log = telemetry if telemetry is not None else NullTelemetry()
    if deadline_seconds < margin:
        _emit(log, "work.skipped", phase="deadline", receive_count=receive_count)
        return RecordOutcome(False, OutcomeReason.INSUFFICIENT_TIME)

    run = clamped_engine(engine, job_budget_seconds(deadline_seconds, margin))
    limit = min(DEFAULT_MAX_MESSAGE_BYTES, run.ceilings.max_message_bytes)
    try:
        request = decode_request(body, max_bytes=limit)
    except ProcessingError as error:
        _emit(log, "work.invalid", error_code=error.code.value, receive_count=receive_count)
        return RecordOutcome(False, OutcomeReason.INVALID_WORK, error_code=error.code.value)
    except Exception as exc:  # noqa: BLE001 - a decoder bug is still invalid work
        _emit(log, "work.invalid", exception_type=type(exc).__name__, receive_count=receive_count)
        return RecordOutcome(False, OutcomeReason.INVALID_WORK)

    ids: dict[str, str] = {"job_id": request.job_id, "attempt_id": request.attempt_id}
    token = cancellation if cancellation is not None else CancellationToken()
    result = run.execute(request, cancellation=token)
    if token.cancelled and result.status is ResultStatus.CANCELLED:
        _emit(log, "work.interrupted", **ids)
        return RecordOutcome(False, OutcomeReason.INTERRUPTED, **ids)

    retry_class = result.retry_class.value if result.retry_class else None
    status = result.status.value
    error = result.primary_error
    error_code = error.code.value if error else None

    def out_of_time(phase: str) -> RecordOutcome | None:
        if time_left is None or time_left() >= call_seconds:
            return None
        _emit(log, "work.skipped", phase=phase, receive_count=receive_count, **ids)
        return RecordOutcome(
            False, OutcomeReason.INSUFFICIENT_TIME, status=status, retry_class=retry_class, **ids
        )

    if (late := out_of_time("complete")) is not None:
        return late
    try:
        event = run.complete(result, max_message_bytes=completions_queue.max_message_bytes)
        payload = encode(event)
    except Exception as exc:  # noqa: BLE001 - redeliver; the rerun rebuilds the same result
        code = exc.code.value if isinstance(exc, ProcessingError) else None
        _emit(
            log,
            "work.completion_failed",
            phase="complete",
            error_code=code,
            exception_type=type(exc).__name__,
            **ids,
        )
        return RecordOutcome(
            False, OutcomeReason.COMPLETION_FAILED, status=status, retry_class=retry_class, **ids
        )
    if (late := out_of_time("send")) is not None:
        return late
    try:
        completions_queue.send(payload)
    except Exception as exc:  # noqa: BLE001 - never acknowledge work whose completion is lost
        _emit(
            log,
            "work.completion_failed",
            phase="send",
            exception_type=type(exc).__name__,
            size_bytes=len(payload),
            **ids,
        )
        return RecordOutcome(
            False, OutcomeReason.SEND_FAILED, status=status, retry_class=retry_class, **ids
        )
    _emit(
        log,
        "work.completed",
        status=status,
        retry_class=retry_class,
        error_code=error_code,
        size_bytes=len(payload),
        receive_count=receive_count,
        **ids,
    )
    return RecordOutcome(
        True,
        OutcomeReason.COMPLETED,
        status=status,
        retry_class=retry_class,
        error_code=error_code,
        **ids,
    )
