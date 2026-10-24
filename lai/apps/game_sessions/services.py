"""Treasure Rush play services (TR-4): the transactional boundary the TR-5 play API calls.

No HTTP here. Every function takes a `ChildProfile` already resolved through the parent
(`ChildScopedMixin`) and looks child-owned records up *with* that child, so another child's
session or attempt is indistinguishable from one that does not exist.

`submit_chest_answer` is the one place a chest opens. Grading, the attempt's outcome, skill
evidence, the chest's world change, the reward, and quest progress are written in one
transaction: if any part fails, none of it is kept and the attempt can be answered again.
"""

import secrets
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from apps.core.catalog import ContentStatus
from apps.education.challenges import Correctness, generate_challenge, grade_answer
from apps.education.services import record_attempt_evidence
from apps.inventory.services import RewardGrant, grant_reward_rule
from apps.islands.models import TreasureChest, WorldRegion
from apps.progression.models import WorldChange
from apps.progression.services import record_world_change_once
from apps.quests.services import QuestUpdate, refresh_active_quests

from .models import (
    OPEN_STATUSES,
    AdventureSession,
    AttemptStatus,
    ChallengeAttempt,
    SessionKind,
    SessionStatus,
)

CHEST_CHANGE_TYPE = "UNLOCK"
SEED_LIMIT = 2**31


class PlayError(Exception):
    """A request the play API refuses. `code` is stable and safe to show as an error code."""

    code = "play_error"


class ContentUnavailable(PlayError):
    code = "content_unavailable"


class SessionNotOpen(PlayError):
    code = "session_not_open"


class ChestAlreadyOpen(PlayError):
    code = "chest_already_open"


class AttemptNotFound(PlayError):
    code = "not_found"


class AttemptAlreadyAnswered(PlayError):
    code = "attempt_already_answered"


def _require_published_region(region: WorldRegion) -> None:
    if (
        region.status != ContentStatus.PUBLISHED
        or region.location.status != ContentStatus.PUBLISHED
    ):
        raise ContentUnavailable


def start_or_resume_region_session(child, region: WorldRegion) -> tuple[AdventureSession, bool]:
    """The child's open session in `region`, or a new one. Returns (session, created).

    At most one open session per child and region (a partial unique constraint), so two
    concurrent starts end with one session. A paused session is resumed.
    """
    if not child.active:
        raise ContentUnavailable
    _require_published_region(region)
    lookup = {"child": child, "kind": SessionKind.REGION, "region_id": region.region_id}
    with transaction.atomic():
        session = (
            AdventureSession.objects.select_for_update()
            .filter(status__in=OPEN_STATUSES, **lookup)
            .first()
        )
        created = False
        if session is None:
            try:
                with transaction.atomic():
                    session = AdventureSession.objects.create(
                        location_slug=region.location.slug, **lookup
                    )
                    created = True
            except IntegrityError:
                session = AdventureSession.objects.select_for_update().get(
                    status__in=OPEN_STATUSES, **lookup
                )
        session.status = SessionStatus.ACTIVE
        session.last_activity_at = now()
        session.save(update_fields=["status", "last_activity_at"])
        return session, created


def end_session(session: AdventureSession, status: str = SessionStatus.COMPLETED) -> None:
    """Close an open session (the calm stop, a finished visit, or a safety stop)."""
    if status in OPEN_STATUSES:
        raise ValueError("Use start_or_resume_region_session to open a session.")
    with transaction.atomic():
        session = AdventureSession.objects.select_for_update().get(pk=session.pk)
        if not session.is_open:
            return
        session.status = status
        session.last_activity_at = now()
        session.completed_at = session.last_activity_at if status == SessionStatus.COMPLETED else None
        session.save(update_fields=["status", "last_activity_at", "completed_at"])


def chest_is_open(child, chest: TreasureChest) -> bool:
    return WorldChange.objects.filter(
        child=child,
        location_slug=chest.region.location.slug,
        change_key=chest.world_change_key,
    ).exists()


def issue_chest_challenge(
    session: AdventureSession, chest: TreasureChest, *, seed: int | None = None
) -> tuple[ChallengeAttempt, bool]:
    """The challenge to show for `chest`. Returns (attempt, created).

    Asking again while a challenge is outstanding returns the same attempt, so a retried
    request never reshuffles the numbers. The seed is chosen here, never by the client.
    """
    child = session.child
    with transaction.atomic():
        # Serialises attempt numbering within the session.
        session = AdventureSession.objects.select_for_update().get(pk=session.pk)
        if not session.is_open or session.kind != SessionKind.REGION:
            raise SessionNotOpen
        if chest.region.region_id != session.region_id:
            raise ContentUnavailable
        _require_published_region(chest.region)
        if chest_is_open(child, chest):
            raise ChestAlreadyOpen
        outstanding = ChallengeAttempt.objects.filter(
            session=session, target_entity_id=chest.entity_id, status=AttemptStatus.ISSUED
        ).first()
        if outstanding is not None:
            return outstanding, False
        spec = chest.challenge_for(child.age_band)
        if spec is None or spec.status != ContentStatus.PUBLISHED:
            raise ContentUnavailable
        seed = secrets.randbelow(SEED_LIMIT) if seed is None else seed
        challenge = generate_challenge(spec.parameters(), child.age_band, seed)
        previous = ChallengeAttempt.objects.filter(
            session=session, target_entity_id=chest.entity_id
        ).count()
        attempt = ChallengeAttempt.objects.create(
            child=child,
            session=session,
            region_id=session.region_id,
            target_entity_id=chest.entity_id,
            chest=chest,
            challenge_spec=spec,
            challenge_spec_slug=spec.slug,
            age_band=child.age_band,
            skill_id=spec.skill_id,
            min_value=spec.min_value,
            max_value=spec.max_value,
            response_mode=spec.response_mode,
            choice_count=spec.choice_count,
            seed=seed,
            operation=challenge.operation,
            operands=list(challenge.operands),
            choices=list(challenge.choices),
            answer=challenge.answer,
            attempt_number=previous + 1,
        )
        session.last_activity_at = now()
        session.save(update_fields=["last_activity_at"])
        return attempt, True


@dataclass(frozen=True)
class ChestOutcome:
    attempt: ChallengeAttempt
    correct: bool
    chest_opened: bool = False
    """True only on the answer that opened the chest; a replay of that state is impossible."""
    reward: RewardGrant | None = None
    quest_updates: tuple[QuestUpdate, ...] = ()


def submit_chest_answer(
    child, attempt_id, raw_answer: object, *, hint_level: int = 0, duration_ms: int | None = None
) -> ChestOutcome:
    """Grade an outstanding attempt and apply everything a correct answer earns, atomically.

    Raises `AttemptNotFound` for an unknown attempt or another child's, `AttemptAlreadyAnswered`
    for a replay, and TR-1 `InvalidAnswer` for malformed input (nothing is written, the
    attempt stays open). Correctness comes only from `grade_answer` on the stored snapshot.
    """
    with transaction.atomic():
        try:
            attempt = ChallengeAttempt.objects.select_for_update().get(pk=attempt_id, child=child)
        except (ChallengeAttempt.DoesNotExist, ValueError, ValidationError):
            raise AttemptNotFound from None
        if attempt.status == AttemptStatus.ANSWERED:
            raise AttemptAlreadyAnswered
        session = AdventureSession.objects.select_for_update().get(pk=attempt.session_id)
        if not session.is_open:
            raise SessionNotOpen

        correctness = grade_answer(attempt.challenge(), raw_answer)
        attempt.status = AttemptStatus.ANSWERED
        attempt.submitted_answer = raw_answer
        attempt.correctness = correctness
        attempt.hint_level = hint_level
        attempt.duration_ms = duration_ms
        attempt.answered_at = now()
        attempt.save()
        record_attempt_evidence(attempt)
        session.last_activity_at = attempt.answered_at
        session.save(update_fields=["last_activity_at"])

        if correctness != Correctness.CORRECT:
            return ChestOutcome(attempt=attempt, correct=False)

        chest = attempt.chest
        if chest is None:  # deleted by an administrator after the challenge was shown
            raise ContentUnavailable
        _, opened = record_world_change_once(
            child,
            location_slug=chest.region.location.slug,
            change_type=CHEST_CHANGE_TYPE,
            change_key=chest.world_change_key,
            payload={"regionId": chest.region.region_id, "entityId": chest.entity_id},
            source_session=session,
        )
        reward = (
            grant_reward_rule(child, chest.reward_rule, source_session=session)
            if chest.reward_rule is not None
            else None
        )
        quest_updates = tuple(refresh_active_quests(child, source_session=session))
        return ChestOutcome(
            attempt=attempt,
            correct=True,
            chest_opened=opened,
            reward=reward,
            quest_updates=quest_updates,
        )
