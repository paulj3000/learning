"""Persistence transitions for adventure sessions (LAI-0305).

Server-side only (ADR-019 sub-decision 8): no endpoint calls these yet. LAI-0601 calls them
with the outcome of its Python validators, so `correctness` and `next_step_id` are rule
results, never client input. What this module enforces is the persistence half of the rules
the current code already has:

- start or resume: one ACTIVE session per child and adventure (`resumeOrStartSession`);
- a step attempt is accepted only on an ACTIVE session and only for its current step
  (`submitAdventureAnswer`), and moves the session to an authored step of the same adventure;
- completion is ACTIVE -> COMPLETED with `completed_at` (`completeSession`); a completed
  session never changes again.

Transitions into PAUSED, ABANDONED and SAFETY_STOPPED exist in the status enum but no code
performs them today, so none is offered here (an open specification item, not a guess).

Every function takes the child resolved by `ChildScopedMixin` and refuses records of any other
child with `ProgressNotFound`, the same answer as for a record that does not exist.
"""

from datetime import datetime

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Adventure, ContentRelease
from apps.game_sessions.models import (
    COMPLETE_STEP_ID,
    AdventureAction,
    AdventureSession,
    Correctness,
    SessionStatus,
)


class ProgressError(Exception):
    """A rejected progress write. `message` is safe to show to a parent."""

    message = "That progress could not be saved."


class ProgressNotFound(ProgressError):
    message = "That adventure could not be found."


class InvalidTransition(ProgressError):
    message = "That adventure cannot change that way."


def _now(now: datetime | None) -> datetime:
    return now or timezone.now()


def _locked_session(child, session_id) -> AdventureSession:
    """The child's session, row-locked for this transaction; anyone else's is not found."""
    try:
        return AdventureSession.objects.for_child(child).select_for_update().get(pk=session_id)
    except AdventureSession.DoesNotExist:
        raise ProgressNotFound from None


def _step_ids(adventure: Adventure) -> set[str]:
    return set(adventure.steps.values_list("step_id", flat=True))


def is_playable(adventure: Adventure) -> bool:
    location = adventure.location
    return adventure.active and (location is None or location.active)


@transaction.atomic
def start_or_resume_session(child, adventure: Adventure, *, now=None) -> tuple[AdventureSession, bool]:
    """The child's ACTIVE session for this adventure, or a new one at its entry step.

    Checked first, as `resumeOrStartSession` does: the adventure must be playable, which is
    `isAdventurePlayable` (catalog/availability.ts): it and its location are active. A story-only
    adventure has no location record and is gated by its own flag. `World.active` is not part
    of the rule yet (open item, see docs/DATA_MODEL.md).
    """
    if not is_playable(adventure):
        raise InvalidTransition
    existing = AdventureSession.objects.for_child(child).filter(
        adventure=adventure, status=SessionStatus.ACTIVE
    ).first()
    if existing:
        return existing, False
    release = ContentRelease.objects.order_by("-imported_at", "-id").first()
    if release is None:
        raise ProgressNotFound
    at = _now(now)
    try:
        with transaction.atomic():
            session = AdventureSession.objects.create(
                child=child, adventure=adventure, template_version=adventure.version,
                content_release=release, status=SessionStatus.ACTIVE,
                current_step_id=adventure.entry_step_id, started_at=at, last_activity_at=at,
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
    step_id: str,
    correctness: Correctness,
    next_step_id: str,
    action_type: str,
    normalized_answer: str = "",
    hint_level: int = 0,
    duration_ms: int | None = None,
    now=None,
) -> AdventureAction:
    """Records one validated attempt at the current step and moves the session.

    `next_step_id` equal to `step_id` keeps the child on the step (for example a retry).
    """
    session = _locked_session(child, session_id)
    if session.status != SessionStatus.ACTIVE:
        raise InvalidTransition
    if step_id != session.current_step_id:
        raise InvalidTransition
    steps = _step_ids(session.adventure)
    if next_step_id != COMPLETE_STEP_ID and next_step_id not in steps:
        raise InvalidTransition
    previous = session.actions.filter(step_id=step_id).order_by("-attempt_number").first()
    at = _now(now)
    action = AdventureAction.objects.create(
        session=session, step_id=step_id, action_type=action_type,
        normalized_answer=normalized_answer, correctness=correctness, hint_level=hint_level,
        attempt_number=(previous.attempt_number + 1) if previous else 1,
        next_step_id="" if next_step_id == step_id else next_step_id,
        duration_ms=duration_ms, created_at=at,
    )
    session.current_step_id = next_step_id
    session.last_activity_at = max(at, session.last_activity_at)
    session.save(update_fields=["current_step_id", "last_activity_at"])
    return action


@transaction.atomic
def complete_session(child, session_id, *, now=None) -> AdventureSession:
    session = _locked_session(child, session_id)
    if session.status != SessionStatus.ACTIVE:
        raise InvalidTransition
    at = max(_now(now), session.last_activity_at)
    session.status = SessionStatus.COMPLETED
    session.completed_at = at
    session.last_activity_at = at
    session.save(update_fields=["status", "completed_at", "last_activity_at"])
    return session


def completed_step_ids(child, session_id) -> list[str]:
    """Steps the child has moved past in this session, in the order they left them."""
    try:
        session = AdventureSession.objects.for_child(child).get(pk=session_id)
    except AdventureSession.DoesNotExist:
        raise ProgressNotFound from None
    moved = session.actions.exclude(next_step_id="").order_by("created_at", "attempt_number")
    return list(dict.fromkeys(moved.values_list("step_id", flat=True)))
