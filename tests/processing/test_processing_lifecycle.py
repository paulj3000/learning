"""Application job state transitions and the completion decision matrix (core/lifecycle.py)."""

from __future__ import annotations

from dataclasses import replace
from itertools import product
from typing import Any

import pytest
from processing_samples import (
    ATTEMPT_ID,
    JOB_ID,
    NAMESPACE,
    OTHER_ATTEMPT_ID,
    OTHER_JOB_ID,
    event_by_reference,
    event_inline,
    reference_request,
    result_base,
    result_cancelled,
    result_failed_retryable,
    result_succeeded,
)

from lai_processing.contracts import InputIdentity, JobError, ProcessingJobResult, ResultStatus
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.lifecycle import (
    AUTOMATION_STOP_STATES,
    MANUAL_TRANSITIONS,
    TERMINAL_STATES,
    TRANSITIONS,
    CompletionAction,
    CompletionDecision,
    InvalidTransition,
    JobSnapshot,
    JobState,
    check_transition,
    decide_completion,
    next_attempt_number,
)

S = JobState

EXPECTED = {
    S.CREATED: {S.UPLOADING, S.QUEUED, S.FAILED, S.CANCELLED},
    S.UPLOADING: {S.QUEUED, S.FAILED, S.CANCELLED},
    S.QUEUED: {S.PROCESSING, S.VALIDATED, S.FAILED, S.CANCELLED, S.QUEUED},
    S.PROCESSING: {S.VALIDATED, S.QUEUED, S.FAILED, S.CANCELLED},
    S.VALIDATED: {S.READY_FOR_REVIEW, S.FAILED},
    S.READY_FOR_REVIEW: set(),
    S.FAILED: {S.QUEUED},
    S.CANCELLED: set(),
}


def test_state_values() -> None:
    assert [s.value for s in JobState] == [
        "created",
        "uploading",
        "queued",
        "processing",
        "validated",
        "ready_for_review",
        "failed",
        "cancelled",
    ]


def test_transition_table_is_exactly_as_specified() -> None:
    assert {k: set(v) for k, v in TRANSITIONS.items()} == EXPECTED
    assert set(TRANSITIONS) == set(JobState)
    with pytest.raises(TypeError):
        TRANSITIONS[S.CANCELLED] = frozenset({S.QUEUED})  # type: ignore[index]


def test_state_groups() -> None:
    assert TERMINAL_STATES == {S.READY_FOR_REVIEW, S.CANCELLED}
    assert AUTOMATION_STOP_STATES == {S.READY_FOR_REVIEW, S.CANCELLED, S.FAILED}
    assert MANUAL_TRANSITIONS == {(S.FAILED, S.QUEUED)}
    for state in TERMINAL_STATES:
        assert not TRANSITIONS[state]
    for pair in MANUAL_TRANSITIONS:
        assert pair[1] in TRANSITIONS[pair[0]]


@pytest.mark.parametrize(("current", "target"), list(product(JobState, JobState)))
def test_every_pair(current: JobState, target: JobState) -> None:
    allowed = target in EXPECTED[current]
    manual_only = (current, target) in MANUAL_TRANSITIONS
    if allowed and not manual_only:
        assert check_transition(current, target) is target
        assert check_transition(current.value, target.value) is target
        assert check_transition(current, target, manual=True) is target
    elif manual_only:
        with pytest.raises(InvalidTransition):
            check_transition(current, target)
        assert check_transition(current, target, manual=True) is target
    else:
        for manual in (False, True):
            with pytest.raises(InvalidTransition) as err:
                check_transition(current, target, manual=manual)
            assert err.value.current is current and err.value.target is target


@pytest.mark.parametrize(("current", "target"), [("queued", "done"), ("nope", "queued"), (1, 2)])
def test_unknown_states_are_invalid_transitions(current: Any, target: Any) -> None:
    with pytest.raises(InvalidTransition) as err:
        check_transition(current, target)
    assert (err.value.current, err.value.target) == (current, target)


def test_invalid_transition_is_not_a_processing_error() -> None:
    assert not issubclass(InvalidTransition, ProcessingError)


# --- decide_completion -------------------------------------------------------------------------


def _job(**overrides: Any) -> JobSnapshot:
    request = reference_request()
    assert request.input is not None
    fields: dict[str, Any] = {
        "job_id": JOB_ID,
        "namespace": NAMESPACE,
        "state": S.QUEUED,
        "idempotency_key": request.idempotency_key,
        "current_attempt_id": ATTEMPT_ID,
        "current_attempt_number": 1,
        "input_sha256": request.input.sha256,
        "applied_attempt_ids": frozenset(),
        "max_attempts": 3,
    }
    fields.update(overrides)
    return JobSnapshot(**fields)


def _expect(
    decision: CompletionDecision,
    action: CompletionAction,
    reason: str,
    next_state: JobState | None = None,
) -> None:
    assert decision == CompletionDecision(action, next_state, reason, True)


@pytest.mark.parametrize("state", [S.QUEUED, S.PROCESSING])
def test_success_applies_validated(state: JobState) -> None:
    decision = decide_completion(_job(state=state), event_inline())
    _expect(decision, CompletionAction.APPLY, "succeeded", S.VALIDATED)
    assert check_transition(state, decision.next_state)  # type: ignore[arg-type]


def test_success_by_reference_with_fetched_result() -> None:
    event = event_by_reference()
    _expect(
        decide_completion(_job(), event, result_succeeded()),
        CompletionAction.APPLY,
        "succeeded",
        S.VALIDATED,
    )
    _expect(decide_completion(_job(), event), CompletionAction.APPLY, "succeeded", S.VALIDATED)


def test_cancelled_applies_cancelled() -> None:
    _expect(
        decide_completion(_job(state=S.PROCESSING), event_inline(result_cancelled())),
        CompletionAction.APPLY,
        "cancelled",
        S.CANCELLED,
    )


@pytest.mark.parametrize("attempt", [1, 2])
def test_retryable_failure_with_attempts_left_retries(attempt: int) -> None:
    decision = decide_completion(
        _job(current_attempt_number=attempt), event_inline(result_failed_retryable())
    )
    _expect(decision, CompletionAction.RETRY, "retryable_failure", S.QUEUED)
    assert check_transition(S.QUEUED, decision.next_state)  # type: ignore[arg-type]


@pytest.mark.parametrize("attempt", [3, 4])
def test_retry_exhaustion_fails(attempt: int) -> None:
    _expect(
        decide_completion(
            _job(current_attempt_number=attempt), event_inline(result_failed_retryable())
        ),
        CompletionAction.APPLY,
        "retries_exhausted",
        S.FAILED,
    )


def _failed_result(code: ErrorCode) -> ProcessingJobResult:

    return ProcessingJobResult(
        **result_base(reference_request()),
        status=ResultStatus.FAILED,
        errors=(JobError.from_error(ProcessingError(code)),),
    )


@pytest.mark.parametrize(
    ("code", "reason"),
    [
        (ErrorCode.CHECKSUM_MISMATCH, "failed_permanent"),
        (ErrorCode.INVALID_INPUT, "failed_permanent"),
        (ErrorCode.UNEXPECTED_FAILURE, "failed_manual"),
        (ErrorCode.PERMISSION_DENIED, "failed_manual"),
    ],
)
def test_non_retryable_failures_fail(code: ErrorCode, reason: str) -> None:
    _expect(
        decide_completion(_job(), event_inline(_failed_result(code))),
        CompletionAction.APPLY,
        reason,
        S.FAILED,
    )


def test_by_reference_failure_is_routed_by_the_event_retry_class() -> None:
    event = event_by_reference(result_failed_retryable())
    _expect(decide_completion(_job(), event), CompletionAction.RETRY, "retryable_failure", S.QUEUED)
    _expect(
        decide_completion(_job(), event, result_failed_retryable()),
        CompletionAction.RETRY,
        "retryable_failure",
        S.QUEUED,
    )


@pytest.mark.parametrize("state", list(JobState))
def test_duplicate_delivery_is_duplicate_in_every_state(state: JobState) -> None:
    job = _job(state=state, applied_attempt_ids=frozenset({ATTEMPT_ID}))
    _expect(decide_completion(job, event_inline()), CompletionAction.DUPLICATE, "already_applied")


@pytest.mark.parametrize("state", [S.VALIDATED, S.READY_FOR_REVIEW, S.FAILED, S.CANCELLED])
@pytest.mark.parametrize("builder", [result_succeeded, result_failed_retryable, result_cancelled])
def test_finished_jobs_ignore_late_events(state: JobState, builder: Any) -> None:
    _expect(
        decide_completion(_job(state=state), event_inline(builder())),
        CompletionAction.STALE,
        "job_finished",
    )


def test_late_success_after_cancel_is_stale() -> None:
    _expect(
        decide_completion(_job(state=S.CANCELLED), event_inline()),
        CompletionAction.STALE,
        "job_finished",
    )


def test_cancel_after_completion_is_stale() -> None:
    _expect(
        decide_completion(_job(state=S.VALIDATED), event_inline(result_cancelled())),
        CompletionAction.STALE,
        "job_finished",
    )


@pytest.mark.parametrize("state", [S.QUEUED, S.PROCESSING])
def test_superseded_attempt_is_stale(state: JobState) -> None:
    job = _job(state=state, current_attempt_id=OTHER_ATTEMPT_ID, current_attempt_number=2)
    _expect(decide_completion(job, event_inline()), CompletionAction.STALE, "superseded_attempt")


@pytest.mark.parametrize("state", [S.CREATED, S.UPLOADING])
def test_not_running_is_stale(state: JobState) -> None:
    _expect(
        decide_completion(_job(state=state), event_inline()), CompletionAction.STALE, "not_running"
    )


def test_no_current_attempt_is_superseded() -> None:
    _expect(
        decide_completion(_job(current_attempt_id=None), event_inline()),
        CompletionAction.STALE,
        "superseded_attempt",
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"job_id": OTHER_JOB_ID},
        {"namespace": "prod"},
        {"idempotency_key": "ik1:" + "0" * 64},
    ],
)
def test_forged_or_misrouted_events_are_rejected_but_acked(overrides: dict[str, Any]) -> None:
    for state in JobState:
        decision = decide_completion(_job(state=state, **overrides), event_inline())
        _expect(decision, CompletionAction.REJECT, "identity_mismatch")


def test_identity_check_precedes_duplicate_check() -> None:
    job = _job(job_id=OTHER_JOB_ID, applied_attempt_ids=frozenset({ATTEMPT_ID}))
    assert decide_completion(job, event_inline()).action is CompletionAction.REJECT


def test_input_checksum_mismatch_is_rejected() -> None:
    _expect(
        decide_completion(_job(input_sha256="f" * 64), event_inline()),
        CompletionAction.REJECT,
        "input_mismatch",
    )


def test_input_checksum_unknown_or_unread_is_not_rejected() -> None:
    assert decide_completion(_job(input_sha256=None), event_inline()).action is (
        CompletionAction.APPLY
    )
    no_input = event_inline(result_failed_retryable())
    assert no_input.result is not None and no_input.result.input is None
    assert decide_completion(_job(input_sha256="f" * 64), no_input).action is (
        CompletionAction.RETRY
    )


def test_input_mismatch_found_through_fetched_result() -> None:
    request = reference_request()
    assert request.input is not None
    tampered = replace(
        result_succeeded(),
        input=InputIdentity(request.input.ref, "e" * 64, 32, True),
    )
    event = event_by_reference(tampered)
    _expect(decide_completion(_job(), event, tampered), CompletionAction.REJECT, "input_mismatch")


def test_result_not_matching_event_is_rejected() -> None:
    event = event_by_reference()
    _expect(
        decide_completion(_job(), event, result_failed_retryable()),
        CompletionAction.REJECT,
        "result_mismatch",
    )


def test_every_decision_acks() -> None:
    for state, builder in product(JobState, [result_succeeded, result_failed_retryable]):
        assert decide_completion(_job(state=state), event_inline(builder())).ack is True


def test_next_attempt_number() -> None:
    assert next_attempt_number(_job(current_attempt_number=0)) == 1
    assert next_attempt_number(_job(current_attempt_number=2)) == 3


def test_snapshot_validation() -> None:
    job = _job(state="queued", applied_attempt_ids={ATTEMPT_ID})
    assert job.state is S.QUEUED and isinstance(job.applied_attempt_ids, frozenset)
    for bad in (
        {"max_attempts": 0},
        {"current_attempt_number": -1},
        {"current_attempt_number": True},
        {"state": "done"},
    ):
        with pytest.raises(ValueError):
            _job(**bad)


def test_full_retry_scenario() -> None:
    """Attempt 1 fails (retryable), attempt 2 succeeds, attempt 1 is redelivered late."""
    job = _job()
    first = decide_completion(job, event_inline(result_failed_retryable()))
    assert first.action is CompletionAction.RETRY
    job = replace(
        job,
        state=first.next_state,
        current_attempt_id=OTHER_ATTEMPT_ID,
        current_attempt_number=next_attempt_number(job),
        applied_attempt_ids=job.applied_attempt_ids | {ATTEMPT_ID},
    )
    request2 = reference_request(attempt_id=OTHER_ATTEMPT_ID, attempt_number=2)
    second = decide_completion(job, event_inline(result_succeeded(request2)))
    _expect(second, CompletionAction.APPLY, "succeeded", S.VALIDATED)
    job = replace(
        job, state=S.VALIDATED, applied_attempt_ids=job.applied_attempt_ids | {OTHER_ATTEMPT_ID}
    )
    late = decide_completion(job, event_inline(result_failed_retryable()))
    _expect(late, CompletionAction.DUPLICATE, "already_applied")
    unknown_late = decide_completion(
        replace(job, applied_attempt_ids=frozenset({OTHER_ATTEMPT_ID})),
        event_inline(result_failed_retryable()),
    )
    _expect(unknown_late, CompletionAction.STALE, "job_finished")
