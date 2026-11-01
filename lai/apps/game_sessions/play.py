"""Region play services (Treasure Rush TR-4, adapted in POST-MERGE-03): the transactional
boundary the play API (TR-5) calls, on the canonical session, catalog and progress models.

No HTTP here. Every function takes a `ChildProfile` already resolved through the parent
(`ChildScopedMixin`) and looks child-owned records up *with* that child, so another child's
session or attempt is indistinguishable from one that does not exist.

`submit_chest_answer` is the one place a chest opens. Grading, the attempt's outcome, skill
evidence, the chest's world change, the reward, and quest progress are written in one
transaction: if any part fails, none of it is kept and the attempt can be answered again.

Step-based adventures use `apps.game_sessions.services` (LAI-0601) instead; the lifecycle
actions here (pause, resume, complete, abandon) apply to REGION sessions only, because no rule
defines them for adventures yet.
"""

import secrets
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from apps.catalog import authoring
from apps.catalog.models import ContentRelease, RewardRule
from apps.core.content_status import ContentStatus
from apps.education.challenges import (
    ChallengeParameters,
    Correctness,
    ResponseMode,
    generate_challenge,
    grade_answer,
)
from apps.education.services import record_attempt_evidence
from apps.inventory.services import RewardGrant, grant_reward_rule
from apps.progression.models import WorldChange
from apps.progression.services import record_world_change
from apps.quests.services import QuestUpdate, refresh_active_quests
from apps.regions import puzzles
from apps.regions.models import AreaPuzzle, TreasureChest, WorldRegion

from .models import (
    OPEN_STATUSES,
    AdventureSession,
    AttemptStatus,
    ChallengeAttempt,
    PuzzleAttempt,
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
    # The region is seed content with a publication status; its location is a catalog row,
    # whose `active` flag is the catalog's equivalent of published.
    if region.status != ContentStatus.PUBLISHED or not region.location.active:
        raise ContentUnavailable


def start_or_resume_region_session(child, region: WorldRegion) -> tuple[AdventureSession, bool]:
    """The child's open session in `region`, or a new one. Returns (session, created).

    At most one open session per child and region (a partial unique constraint), so two
    concurrent starts end with one session. A paused session is resumed.
    """
    if not child.active or not region.supports_band(child.age_band):
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
            release = ContentRelease.objects.order_by("-imported_at", "-id").first()
            if release is None:
                raise ContentUnavailable
            at = now()
            try:
                with transaction.atomic():
                    session = AdventureSession.objects.create(
                        location_slug=region.location.slug,
                        content_release=release,
                        status=SessionStatus.ACTIVE,
                        started_at=at,
                        last_activity_at=at,
                        **lookup,
                    )
                    created = True
                    pin_region_content(session, region)
            except IntegrityError:
                session = AdventureSession.objects.select_for_update().get(
                    status__in=OPEN_STATUSES, **lookup
                )
        session.status = SessionStatus.ACTIVE
        session.last_activity_at = now()
        session.save(update_fields=["status", "last_activity_at"])
        return session, created


def pin_region_content(session: AdventureSession, region: WorldRegion) -> None:
    """LAI-0813: the content versions a region visit starts with. The 3D Area's copy, its
    puzzles, the NPCs placed in it, the quests it offers and its chests' challenge specs."""
    npcs = [p.npc for p in region.placements.select_related("npc") if p.npc_id is not None]
    specs = [
        spec
        for chest in region.chests.all()
        for spec in (chest.sprout_challenge, chest.pathfinder_challenge, chest.explorer_challenge)
        if spec is not None
    ]
    authoring.pin(
        session,
        [region, *region.puzzles.all(), *npcs, *region.offered_quests.all(), *specs],
    )


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
        session.completed_at = (
            session.last_activity_at if status == SessionStatus.COMPLETED else None
        )
        session.save(update_fields=["status", "last_activity_at", "completed_at"])


def chest_is_open(child, chest: TreasureChest) -> bool:
    return (
        WorldChange.objects.for_child(child)
        .filter(
            location_slug=chest.region.location.slug,
            change_key=chest.world_change_key,
        )
        .exists()
    )


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
        # LAI-0813: the spec as this visit started with it.
        pinned = authoring.body_for(session, spec)
        parameters = ChallengeParameters(
            skill_id=pinned["skillId"],
            min_value=pinned["minValue"],
            max_value=pinned["maxValue"],
            response_mode=ResponseMode(pinned["responseMode"]),
            choice_count=pinned["choiceCount"],
        )
        challenge = generate_challenge(parameters, child.age_band, seed)
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
            skill_id=parameters.skill_id,
            min_value=parameters.min_value,
            max_value=parameters.max_value,
            response_mode=parameters.response_mode.value,
            choice_count=parameters.choice_count,
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
            attempt = (
                ChallengeAttempt.objects.for_child(child).select_for_update().get(pk=attempt_id)
            )
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
        _, opened = record_world_change(
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


# --- Session lifecycle by id (TR-5) --------------------------------------------------------------


class SessionNotFound(PlayError):
    code = "not_found"


class InvalidTransition(PlayError):
    code = "invalid_transition"


# action -> (statuses it may start from, status it ends in). Asking for the status a session
# already has is a no-op, so a retried request succeeds; anything else is refused.
SESSION_ACTIONS = {
    "pause": ((SessionStatus.ACTIVE,), SessionStatus.PAUSED),
    "resume": ((SessionStatus.PAUSED,), SessionStatus.ACTIVE),
    "complete": (OPEN_STATUSES, SessionStatus.COMPLETED),
    "abandon": (OPEN_STATUSES, SessionStatus.ABANDONED),
}


def get_child_session(child, session_id, *, lock: bool = False) -> AdventureSession:
    """One of this child's sessions, or `SessionNotFound` (also for another child's)."""
    queryset = AdventureSession.objects.for_child(child)
    if lock:
        queryset = queryset.select_for_update()
    try:
        return queryset.get(pk=session_id)
    except (AdventureSession.DoesNotExist, ValueError, ValidationError):
        raise SessionNotFound from None


def change_session_status(child, session_id, action: str) -> AdventureSession:
    if action not in SESSION_ACTIONS:
        raise InvalidTransition
    allowed_from, target = SESSION_ACTIONS[action]
    with transaction.atomic():
        session = get_child_session(child, session_id, lock=True)
        if session.status == target:
            return session
        if session.kind != SessionKind.REGION or session.status not in allowed_from:
            raise InvalidTransition
        if action == "resume" and session.kind == SessionKind.REGION:
            region = WorldRegion.objects.filter(region_id=session.region_id).first()
            if region is None:
                raise ContentUnavailable
            _require_published_region(region)
        session.status = target
        session.last_activity_at = now()
        session.completed_at = (
            session.last_activity_at if target == SessionStatus.COMPLETED else None
        )
        session.save(update_fields=["status", "last_activity_at", "completed_at"])
        return session


# --- 3D Area puzzles (ADR-043 F, LAI-0812) -------------------------------------------------------

PUZZLE_CHANGE_TYPE = "PUZZLE_SOLVED"


class PuzzleNotFound(PlayError):
    code = "not_found"


class PuzzleLocked(PlayError):
    """An earlier stage is not done yet (its change key is missing)."""

    code = "puzzle_locked"


class InvalidSubmission(PlayError):
    code = "invalid_submission"


def puzzle_body(session: AdventureSession | None, puzzle: AreaPuzzle) -> dict:
    """The puzzle as this visit started with it (LAI-0813), or as published."""
    return authoring.body_for(session, puzzle)


def puzzle_is_solved(child, puzzle: AreaPuzzle, body: dict) -> bool:
    return (
        WorldChange.objects.for_child(child)
        .filter(location_slug=puzzle.region.location.slug, change_key=body["worldChangeKey"])
        .exists()
    )


def puzzle_is_locked(child, puzzle: AreaPuzzle, body: dict) -> bool:
    required = set(body.get("requiresChangeKeys", []))
    if not required:
        return False
    have = set(
        WorldChange.objects.for_child(child)
        .filter(location_slug=puzzle.region.location.slug, change_key__in=required)
        .values_list("change_key", flat=True)
    )
    return not required <= have


@dataclass(frozen=True)
class PuzzleOutcome:
    attempt: PuzzleAttempt | None
    correct: bool
    solved_now: bool = False
    """True only on the submission that solved it; a repeat of a solved puzzle is not."""
    already_solved: bool = False
    failed_attempts: int = 0
    reward: RewardGrant | None = None
    quest_updates: tuple[QuestUpdate, ...] = ()


def solve_puzzle(child, session_id, puzzle_id: str, submission: object) -> PuzzleOutcome:
    """Grade one submission and apply everything solving it earns, in one transaction.

    The server is the only judge: the submission is graded with `puzzles.grade` against the
    revision this session pinned. The stage order (`requiresChangeKeys`) is enforced here. A
    puzzle already solved records nothing new and grants nothing again (resume and retry safe).
    Rewards resolve against the reward rule's current published version at grant time.
    """
    with transaction.atomic():
        session = get_child_session(child, session_id, lock=True)
        if not session.is_open or session.kind != SessionKind.REGION:
            raise SessionNotOpen
        region = (
            WorldRegion.objects.select_related("location")
            .filter(region_id=session.region_id)
            .first()
        )
        if region is None:
            raise ContentUnavailable
        _require_published_region(region)
        puzzle = region.puzzles.filter(puzzle_id=puzzle_id).first()
        if puzzle is None or puzzle.status != ContentStatus.PUBLISHED:
            raise PuzzleNotFound
        body = puzzle_body(session, puzzle)
        params = body.get("ageBands", {}).get(child.age_band)
        if params is None:
            raise ContentUnavailable
        if puzzle_is_solved(child, puzzle, body):
            return PuzzleOutcome(attempt=None, correct=True, already_solved=True)
        if puzzle_is_locked(child, puzzle, body):
            raise PuzzleLocked
        try:
            correct = puzzles.grade(puzzle.kind, params, submission)
        except puzzles.InvalidSubmission:
            raise InvalidSubmission from None

        previous = PuzzleAttempt.objects.filter(session=session, puzzle_key=puzzle_id)
        attempts_before = previous.count()
        failed_before = previous.filter(correct=False).count()
        at = now()
        attempt = PuzzleAttempt.objects.create(
            child=child,
            session=session,
            region_id=region.region_id,
            puzzle_key=puzzle_id,
            area_puzzle=puzzle,
            revision=_pinned_revision(session, puzzle),
            age_band=child.age_band,
            submission=submission,
            correct=correct,
            attempt_number=attempts_before + 1,
            submitted_at=at,
        )
        session.last_activity_at = at
        session.save(update_fields=["last_activity_at"])
        if not correct:
            return PuzzleOutcome(
                attempt=attempt,
                correct=False,
                failed_attempts=failed_before + 1,
            )

        _, recorded = record_world_change(
            child,
            location_slug=region.location.slug,
            change_type=PUZZLE_CHANGE_TYPE,
            change_key=body["worldChangeKey"],
            payload={"regionId": region.region_id, "puzzleId": puzzle_id},
            source_session=session,
        )
        rule_id = body.get("rewardRuleId")
        rule = RewardRule.objects.filter(rule_id=rule_id).first() if rule_id else None
        reward = grant_reward_rule(child, rule, source_session=session) if rule else None
        quest_updates = tuple(refresh_active_quests(child, source_session=session))
        return PuzzleOutcome(
            attempt=attempt,
            correct=True,
            solved_now=recorded,
            reward=reward,
            quest_updates=quest_updates,
        )


def _pinned_revision(session: AdventureSession, puzzle: AreaPuzzle):
    pinned = session.pinned_revisions.filter(kind="area-puzzle", object_id=str(puzzle.pk)).first()
    if pinned is not None:
        return pinned
    if puzzle.published_revision is None:
        raise ContentUnavailable
    return puzzle.published_revision
