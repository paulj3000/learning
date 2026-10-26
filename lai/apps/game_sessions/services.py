"""Authoritative transitions for adventure sessions (LAI-0305, LAI-0601).

Python owns the outcome (ADR-019 sub-decision 8). `submit_answer` evaluates an answer with
`apps.adventures.engine` against the catalog's step records, then records it, all on one
row-locked session in one transaction. The client supplies only what the child did (the step it
believes is current, the answer, and a request id); correctness, hint level, the next step and
completion are decided here.

Rules, each from the existing code rather than new:
- start or resume: one ACTIVE session per child and adventure (`resumeOrStartSession`), only for
  a playable adventure (`isAdventurePlayable`);
- answers only on an ACTIVE session and only for its current step (`submitAdventureAnswer`);
- the decision tree is `decideSubmission`; the hint level it escalates is the server's own record
  for the step (`AdventureSession.hint_levels`), never a client value;
- reaching a `COMPLETE` step, or the reserved `complete` id, completes the session in the same
  transaction (the client did this with a separate `completeSession` call); completion is final;
- a resolved step (ADVANCE) records its learning evidence and mastery in the same transaction
  (`apps.education.services.record_step_evidence`, LAI-0603); completion itself adds none.

Not offered: transitions into PAUSED, ABANDONED and SAFETY_STOPPED, which no code defines.
Every function takes the child resolved by `ChildScopedMixin`; another child's session is
`ProgressNotFound`, exactly like a missing one.
"""

import json
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.adventures import engine
from apps.education import services as education
from apps.catalog.models import Adventure, AdventureStep, ContentRelease
from apps.game_sessions.models import (
    COMPLETE_STEP_ID,
    AdventureAction,
    AdventureSession,
    Correctness,
    SessionKind,
    SessionStatus,
)


class ProgressError(Exception):
    """A rejected progress write. Views map each subclass to a fixed code and message."""


class ProgressNotFound(ProgressError):
    pass


class InvalidTransition(ProgressError):
    pass


class SessionNotActive(InvalidTransition):
    pass


class StepNotCurrent(InvalidTransition):
    pass


class ContentVersionChanged(InvalidTransition):
    """The catalog no longer holds the content this session started on (no snapshots yet)."""


class InvalidAnswer(ProgressError):
    pass


class RequestConflict(ProgressError):
    """A request id reused for a different submission."""


class SessionNotComplete(InvalidTransition):
    """Completion asked for before the engine reached the end of the adventure (LAI-0608)."""


def _now(now):
    return now or timezone.now()


def is_playable(adventure: Adventure) -> bool:
    location = adventure.location
    return adventure.active and (location is None or location.active)


def _locked_session(child, session_id) -> AdventureSession:
    """The child's session, row-locked for this transaction; anyone else's is not found."""
    try:
        return (
            AdventureSession.objects.for_child(child)
            .select_for_update(of=("self",))
            .select_related("adventure")
            .get(pk=session_id)
        )
    except AdventureSession.DoesNotExist:
        raise ProgressNotFound from None


def _current_step_record(session: AdventureSession) -> AdventureStep:
    """The catalog step the session is on, only if it is the content the session started with.

    The catalog keeps one version of each adventure. A session whose adventure version has
    changed, or whose step was not part of the adventure's latest import, cannot be evaluated
    safely, so it is refused rather than graded against different content.
    """
    adventure = session.adventure
    if adventure.version != session.template_version:
        raise ContentVersionChanged
    step = AdventureStep.objects.filter(
        adventure=adventure, step_id=session.current_step_id
    ).first()
    if step is None or step.last_seen_release_id != adventure.last_seen_release_id:
        raise ContentVersionChanged
    return step


def ends_adventure(session: AdventureSession, next_step_id: str) -> bool:
    if next_step_id == COMPLETE_STEP_ID:
        return True
    return AdventureStep.objects.filter(
        adventure=session.adventure, step_id=next_step_id, step_type="COMPLETE"
    ).exists()


def _record_attempt(
    session,
    *,
    step_id,
    correctness,
    next_step_id,
    action_type,
    normalized_answer="",
    hint_level=0,
    duration_ms=None,
    request_id=None,
    at,
):
    """Records one attempt on a locked ACTIVE session. `next_step_id=None` stays on the step."""
    if session.status != SessionStatus.ACTIVE:
        raise SessionNotActive
    if step_id != session.current_step_id:
        raise StepNotCurrent
    if next_step_id is not None and next_step_id != COMPLETE_STEP_ID:
        if not session.adventure.steps.filter(step_id=next_step_id).exists():
            raise InvalidTransition
    previous = session.actions.filter(step_id=step_id).order_by("-attempt_number").first()
    action = AdventureAction.objects.create(
        session=session,
        step_id=step_id,
        action_type=action_type,
        normalized_answer=normalized_answer,
        correctness=correctness,
        hint_level=hint_level,
        attempt_number=(previous.attempt_number + 1) if previous else 1,
        next_step_id=next_step_id or "",
        duration_ms=duration_ms,
        request_id=request_id,
        created_at=at,
    )
    if next_step_id is not None:
        session.current_step_id = next_step_id
    session.last_activity_at = max(at, session.last_activity_at)
    session.save(update_fields=["current_step_id", "last_activity_at", "hint_levels"])
    return action


def _complete(session, at) -> None:
    if session.status != SessionStatus.ACTIVE:
        raise SessionNotActive
    at = max(at, session.last_activity_at)
    session.status = SessionStatus.COMPLETED
    session.completed_at = at
    session.last_activity_at = at
    session.save(update_fields=["status", "completed_at", "last_activity_at"])


# --- Public operations ----------------------------------------------------------------------


@transaction.atomic
def start_or_resume_session(
    child, adventure: Adventure, *, now=None
) -> tuple[AdventureSession, bool]:
    """The child's ACTIVE session for this adventure, or a new one at its entry step."""
    if not is_playable(adventure):
        raise InvalidTransition
    existing = (
        AdventureSession.objects.for_child(child)
        .filter(adventure=adventure, status=SessionStatus.ACTIVE)
        .first()
    )
    if existing:
        return existing, False
    release = ContentRelease.objects.order_by("-imported_at", "-id").first()
    if release is None:
        raise ProgressNotFound
    at = _now(now)
    try:
        with transaction.atomic():
            session = AdventureSession.objects.create(
                child=child,
                adventure=adventure,
                template_version=adventure.version,
                content_release=release,
                status=SessionStatus.ACTIVE,
                current_step_id=adventure.entry_step_id,
                started_at=at,
                last_activity_at=at,
            )
    except IntegrityError:
        # A concurrent start won the one-active-session constraint: resume that one.
        return AdventureSession.objects.for_child(child).get(
            adventure=adventure, status=SessionStatus.ACTIVE
        ), False
    return session, True


@transaction.atomic
def record_step_attempt(
    child,
    session_id,
    *,
    step_id,
    correctness,
    next_step_id,
    action_type,
    normalized_answer="",
    hint_level=0,
    duration_ms=None,
    now=None,
):
    """Records an attempt whose outcome server code already decided (`next_step_id=None` stays)."""
    session = _locked_session(child, session_id)
    return _record_attempt(
        session,
        step_id=step_id,
        correctness=correctness,
        next_step_id=next_step_id,
        action_type=action_type,
        normalized_answer=normalized_answer,
        hint_level=hint_level,
        duration_ms=duration_ms,
        at=_now(now),
    )


@transaction.atomic
def complete_session(child, session_id, *, now=None) -> AdventureSession:
    session = _locked_session(child, session_id)
    _complete(session, _now(now))
    return session


@transaction.atomic
def finalize_session(child, session_id, adventure: Adventure, *, now=None):
    """Completes the session only if the engine has already reached the end (LAI-0608).

    Returns `(session, completed_now)`. A session the answer route already completed is returned
    unchanged (`completed_now` False), so a repeated or late request has no second effect. A
    session that has not reached a COMPLETE step, or the reserved `complete` id, is
    `SessionNotComplete`: the client cannot finish an adventure by asking. A session of another
    adventure or kind is not found.
    """
    session = _locked_session(child, session_id)
    if session.kind != SessionKind.ADVENTURE or session.adventure_id != adventure.pk:
        raise ProgressNotFound
    if session.status == SessionStatus.COMPLETED:
        return session, False
    if session.status != SessionStatus.ACTIVE:
        raise SessionNotActive
    if not ends_adventure(session, session.current_step_id):
        raise SessionNotComplete
    _complete(session, _now(now))
    return session, True


def completed_step_ids(child, session_id) -> list[str]:
    """Steps the child has moved past in this session, in the order they left them."""
    try:
        session = AdventureSession.objects.for_child(child).get(pk=session_id)
    except AdventureSession.DoesNotExist:
        raise ProgressNotFound from None
    moved = session.actions.exclude(next_step_id="").order_by("created_at", "attempt_number")
    return list(dict.fromkeys(moved.values_list("step_id", flat=True)))


_CORRECTNESS = {
    engine.CORRECT: Correctness.CORRECT,
    engine.INCORRECT: Correctness.INCORRECT,
    engine.PARTIAL: Correctness.PARTIAL,
    engine.NOT_APPLICABLE: Correctness.NOT_APPLICABLE,
}
_ANSWER_LIMIT = 200  # AdventureAction.normalized_answer


def canonical_answer(answer: dict[str, Any]) -> str:
    """The structured answer as stable JSON: what is stored and what a replay is compared to."""
    return json.dumps(answer, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


@dataclass
class AnswerOutcome:
    correctness: str
    support_level: int
    action: str  # "RETRY" or "ADVANCE"
    next_step_id: str | None
    attempt_number: int
    replayed: bool
    session: AdventureSession


def _outcome(action: AdventureAction, session: AdventureSession, replayed: bool) -> AnswerOutcome:
    return AnswerOutcome(
        correctness=action.correctness,
        support_level=action.hint_level,
        action="ADVANCE" if action.next_step_id else "RETRY",
        next_step_id=action.next_step_id or None,
        attempt_number=action.attempt_number,
        replayed=replayed,
        session=session,
    )


@transaction.atomic
def submit_answer(
    child, session_id, *, step_id: str, answer: Any, request_id, now=None
) -> AnswerOutcome:
    """Grades one answer and applies the outcome. Safe to retry with the same `request_id`."""
    if request_id is None:
        raise InvalidAnswer  # without it a retry could not be told from a new attempt
    session = _locked_session(child, session_id)
    answer_text = canonical_answer(answer) if isinstance(answer, dict) else ""

    replay = session.actions.filter(request_id=request_id).first()
    if replay is not None:
        if replay.step_id != step_id or replay.normalized_answer != answer_text:
            raise RequestConflict
        return _outcome(replay, session, replayed=True)

    if session.status != SessionStatus.ACTIVE:
        raise SessionNotActive
    if step_id != session.current_step_id:
        raise StepNotCurrent
    step = _current_step_record(session)
    if not engine.is_step_answer(answer) or len(answer_text) > _ANSWER_LIMIT:
        raise InvalidAnswer
    hint_level = int(session.hint_levels.get(step_id, 0))
    try:
        decision = engine.decide_submission(step.source, answer, hint_level)
    except engine.AnswerKindMismatch:
        raise InvalidAnswer from None
    except engine.EngineError:
        raise ContentVersionChanged from None  # authored content the engine cannot follow

    at = _now(now)
    next_step = decision.get("nextStepId") if decision["action"] == "ADVANCE" else None
    session.hint_levels = {**session.hint_levels, step_id: decision["supportLevel"]}
    action = _record_attempt(
        session,
        step_id=step_id,
        correctness=_CORRECTNESS[decision["correctness"]],
        next_step_id=next_step,
        action_type="ANSWER",
        normalized_answer=answer_text,
        hint_level=decision["supportLevel"],
        request_id=request_id,
        at=at,
    )
    if next_step is not None:
        # The step resolved: its learning evidence and mastery, in this same transaction
        # (LAI-0603). A RETRY is not evidence yet; the step's final outcome is.
        education.record_step_evidence(
            session,
            action,
            step_type=step.step_type,
            objective_ids=step.objective_ids,
            correctness=decision["correctness"],
            support_level=decision["supportLevel"],
            at=at,
        )
    if next_step is not None and ends_adventure(session, next_step):
        _complete(session, at)
    return _outcome(action, session, replayed=False)


@transaction.atomic
def request_hint(child, session_id, *, step_id: str, from_level: int, now=None):
    """Escalates the current step's hint once (`nextHintLevel`); returns (level, hint text).

    Compare-and-set: the level moves only if it is still `from_level`, the level the child saw,
    so a retried request cannot escalate twice.
    """
    session = _locked_session(child, session_id)
    if session.status != SessionStatus.ACTIVE:
        raise SessionNotActive
    if step_id != session.current_step_id:
        raise StepNotCurrent
    step = _current_step_record(session)
    level = int(session.hint_levels.get(step_id, 0))
    if level == from_level:
        level = engine.next_hint_level(level)
        session.hint_levels = {**session.hint_levels, step_id: level}
        session.last_activity_at = max(_now(now), session.last_activity_at)
        session.save(update_fields=["hint_levels", "last_activity_at"])
    return level, engine.hint_text(step.source, level)
