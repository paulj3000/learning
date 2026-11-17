"""Application-level job state and the completion decision (Django-authoritative).

Four separate state machines describe a processing job. They are deliberately kept apart, and
none of them implies another:

1. Application job state (`JobState`, this module). Owned by Django's job row. Only Django
   changes it, inside a database transaction, using `check_transition` and
   `decide_completion`. The worker never changes it and never reads it.
2. Worker execution result (`contracts.results.ResultStatus`: succeeded, failed, cancelled).
   What one attempt reported. It is an input to the job state, not the job state itself.
3. Delivery state (the queue: in flight, acknowledged, released for redelivery, dead-lettered).
   A transport concern, with at-least-once delivery; a message id or receive count is never job
   identity (`ports.queue`).
4. Asset review and publication state (Django `AssetVersion`: DRAFT, VALIDATED, REJECTED,
   PUBLISHED, RETIRED). Processing success never publishes anything: a VALIDATED or
   READY_FOR_REVIEW job only makes a result available for staff review, and only a staff action
   in Django Admin changes publication (ADR-045, ADR-061).

Job states:
- CREATED: Django created the job row.
- UPLOADING: the input is being uploaded to quarantine (jobs whose input is not yet stored).
- QUEUED: an attempt was dispatched to the work queue.
- PROCESSING: a worker reported that the attempt started. Only workers that can report a start
  use it (the local inline worker). A Lambda worker has no database access, so Django may
  receive the completion while the job is still QUEUED; both states accept a completion.
- VALIDATED: Django applied a successful result.
- READY_FOR_REVIEW: the result is presented for staff review (terminal for processing).
- FAILED: the job failed permanently or exhausted its attempts. Automation stops here; an
  operator may requeue it (the only MANUAL transition).
- CANCELLED: the job was cancelled (terminal).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from types import MappingProxyType
from typing import Final

from ..contracts.events import CompletionEvent
from ..contracts.results import ProcessingJobResult, ResultStatus
from .errors import ProcessingError, RetryClass

__all__ = [
    "AUTOMATION_STOP_STATES",
    "MANUAL_TRANSITIONS",
    "TERMINAL_STATES",
    "TRANSITIONS",
    "CompletionAction",
    "CompletionDecision",
    "InvalidTransition",
    "JobSnapshot",
    "JobState",
    "check_transition",
    "decide_completion",
    "next_attempt_number",
]


class JobState(StrEnum):
    CREATED = "created"
    UPLOADING = "uploading"
    QUEUED = "queued"
    PROCESSING = "processing"
    VALIDATED = "validated"
    READY_FOR_REVIEW = "ready_for_review"
    FAILED = "failed"
    CANCELLED = "cancelled"


_S = JobState

TRANSITIONS: Final[Mapping[JobState, frozenset[JobState]]] = MappingProxyType(
    {
        _S.CREATED: frozenset({_S.UPLOADING, _S.QUEUED, _S.FAILED, _S.CANCELLED}),
        _S.UPLOADING: frozenset({_S.QUEUED, _S.FAILED, _S.CANCELLED}),
        # QUEUED -> QUEUED: a new attempt is dispatched after a retryable failure that arrived
        # before any start report. QUEUED -> VALIDATED: completion without a start report.
        _S.QUEUED: frozenset({_S.PROCESSING, _S.VALIDATED, _S.FAILED, _S.CANCELLED, _S.QUEUED}),
        _S.PROCESSING: frozenset({_S.VALIDATED, _S.QUEUED, _S.FAILED, _S.CANCELLED}),
        _S.VALIDATED: frozenset({_S.READY_FOR_REVIEW, _S.FAILED}),
        _S.READY_FOR_REVIEW: frozenset(),
        # Only an explicit operator requeue (MANUAL_TRANSITIONS).
        _S.FAILED: frozenset({_S.QUEUED}),
        _S.CANCELLED: frozenset(),
    }
)

TERMINAL_STATES: Final = frozenset({_S.READY_FOR_REVIEW, _S.CANCELLED})
# States in which no automated actor (consumer, retry scheduler) may move the job.
AUTOMATION_STOP_STATES: Final = frozenset({_S.READY_FOR_REVIEW, _S.CANCELLED, _S.FAILED})
MANUAL_TRANSITIONS: Final = frozenset({(_S.FAILED, _S.QUEUED)})


class InvalidTransition(Exception):
    """A refused application-state change. An application error, not a job result error."""

    def __init__(self, current: JobState | str, target: JobState | str) -> None:
        self.current = current
        self.target = target
        super().__init__(f"job state transition not allowed: {current} -> {target}")


def check_transition(
    current: JobState | str, target: JobState | str, *, manual: bool = False
) -> JobState:
    """Return `target` as a `JobState` if `current -> target` is allowed, else raise.

    A manual transition (FAILED -> QUEUED) requires `manual=True`, which only an explicit
    operator action may pass. Unknown state names are refused the same way.
    """
    try:
        cur = JobState(current)
        tgt = JobState(target)
    except ValueError:
        raise InvalidTransition(current, target) from None
    if tgt not in TRANSITIONS[cur]:
        raise InvalidTransition(cur, tgt)
    if (cur, tgt) in MANUAL_TRANSITIONS and not manual:
        raise InvalidTransition(cur, tgt)
    return tgt


@dataclass(frozen=True, slots=True)
class JobSnapshot:
    """What Django knows about a job when a completion arrives (read inside its transaction).

    - current_attempt_id / current_attempt_number: the attempt most recently dispatched.
    - input_sha256: the checksum Django recorded for the input, if the job has one.
    - applied_attempt_ids: attempts whose completion was already applied.
    - max_attempts: the retry policy's bound for this job.
    """

    job_id: str
    namespace: str
    state: JobState
    idempotency_key: str
    current_attempt_id: str | None
    current_attempt_number: int
    input_sha256: str | None
    applied_attempt_ids: frozenset[str]
    max_attempts: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "state", JobState(self.state))
        object.__setattr__(self, "applied_attempt_ids", frozenset(self.applied_attempt_ids))
        if type(self.current_attempt_number) is not int or self.current_attempt_number < 0:
            raise ValueError("current_attempt_number must be a non-negative integer")
        if type(self.max_attempts) is not int or self.max_attempts < 1:
            raise ValueError("max_attempts must be a positive integer")


class CompletionAction(StrEnum):
    APPLY = "apply"  # record the result and move the job to `next_state`
    RETRY = "retry"  # record the failed attempt and dispatch a new attempt (`next_state` QUEUED)
    DUPLICATE = "duplicate"  # this attempt's completion was already applied; change nothing
    STALE = "stale"  # a valid but outdated event (superseded attempt, finished job)
    REJECT = "reject"  # the event does not belong to this job: a security signal


@dataclass(frozen=True, slots=True)
class CompletionDecision:
    """What the completion consumer must do.

    `ack` says whether the consumer acknowledges (deletes) the queue message once it has acted
    (after its database commit). It is True for every action, REJECT included: a forged or
    misrouted message would never become valid by redelivery, and releasing it would only loop
    it until the dead-letter queue. A REJECT must instead be recorded as a security signal (a
    SafetyEvent-style record and a `job.completion_rejected` telemetry event with the safe
    reason code), never silently dropped. DUPLICATE and STALE are normal at-least-once traffic
    and are logged at info level only.
    """

    action: CompletionAction
    next_state: JobState | None
    reason: str
    ack: bool = True


def _decision(
    action: CompletionAction, reason: str, next_state: JobState | None = None
) -> CompletionDecision:
    return CompletionDecision(action=action, next_state=next_state, reason=reason, ack=True)


def next_attempt_number(job: JobSnapshot) -> int:
    """The attempt number of the next dispatch (the first attempt is 1)."""
    return job.current_attempt_number + 1


_RUNNING: Final = frozenset({_S.QUEUED, _S.PROCESSING})


def decide_completion(
    job: JobSnapshot, event: CompletionEvent, result: ProcessingJobResult | None = None
) -> CompletionDecision:
    """Decide what a completion event does to a job. Pure: no I/O, no clock.

    `result` is the result the event describes: its inline result, or the one the consumer
    fetched by reference. The caller must have run `event.verify_result(result)` already; this
    function re-checks it and rejects a result that does not match the event. Rules, in order:

    1. job id, namespace or idempotency key differ from the job -> REJECT identity_mismatch
       (also result_mismatch when `result` does not match `event`);
    2. the result's observed input checksum differs from Django's record -> REJECT
       input_mismatch;
    3. the attempt was already applied -> DUPLICATE;
    4. the job is VALIDATED or in an automation stop state -> STALE job_finished (a late
       success after a cancel, or a cancel after completion, changes nothing);
    5. the event is not for the current attempt -> STALE superseded_attempt;
    6. the job is not QUEUED or PROCESSING -> STALE not_running;
    7. SUCCEEDED -> APPLY VALIDATED; CANCELLED -> APPLY CANCELLED;
    8. FAILED and RETRYABLE with attempts left -> RETRY QUEUED; otherwise APPLY FAILED.
    """
    if (
        event.job_id != job.job_id
        or event.namespace != job.namespace
        or event.idempotency_key != job.idempotency_key
    ):
        return _decision(CompletionAction.REJECT, "identity_mismatch")
    if result is None:
        result = event.result
    elif result is not event.result:
        try:
            event.verify_result(result)
        except ProcessingError:
            return _decision(CompletionAction.REJECT, "result_mismatch")
    if (
        result is not None
        and job.input_sha256 is not None
        and result.input is not None
        and result.input.sha256 != job.input_sha256
    ):
        return _decision(CompletionAction.REJECT, "input_mismatch")
    if event.attempt_id in job.applied_attempt_ids:
        return _decision(CompletionAction.DUPLICATE, "already_applied")
    if job.state in AUTOMATION_STOP_STATES or job.state is JobState.VALIDATED:
        return _decision(CompletionAction.STALE, "job_finished")
    if event.attempt_id != job.current_attempt_id:
        return _decision(CompletionAction.STALE, "superseded_attempt")
    if job.state not in _RUNNING:
        return _decision(CompletionAction.STALE, "not_running")
    if event.status is ResultStatus.SUCCEEDED:
        return _decision(CompletionAction.APPLY, "succeeded", JobState.VALIDATED)
    if event.status is ResultStatus.CANCELLED:
        return _decision(CompletionAction.APPLY, "cancelled", JobState.CANCELLED)
    retry_class = result.retry_class if result is not None else None
    if retry_class is None:
        # A by-reference failure whose result the caller did not supply: never retry blindly.
        return _decision(CompletionAction.APPLY, "retry_class_unknown", JobState.FAILED)
    if retry_class is RetryClass.RETRYABLE:
        if job.current_attempt_number < job.max_attempts:
            return _decision(CompletionAction.RETRY, "retryable_failure", JobState.QUEUED)
        return _decision(CompletionAction.APPLY, "retries_exhausted", JobState.FAILED)
    return _decision(CompletionAction.APPLY, f"failed_{retry_class.value}", JobState.FAILED)
