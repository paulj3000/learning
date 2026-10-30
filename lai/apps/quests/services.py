"""Quest progress (LAI-0305, with Treasure Rush's server-side refresh, POST-MERGE-03).

`start_quest` accepts a quest explicitly (quests never start themselves, TR-D11) when it is
active in the catalog, for the child's age band, and its prerequisites hold. `refresh_quest`
walks it forward with `apps.quests.engine` against server-side state only. `save_quest_state`
writes a state decided elsewhere, refusing states the quest cannot be in:

- stage and objective ids must be the quest's own (read from the catalog row's `source`);
- completed stage and objective lists only grow, as `advanceQuest` only adds;
- a COMPLETED quest never changes again ("a completed quest never changes" vector).
"""

from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Quest
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.game_sessions.services import InvalidTransition, ProgressNotFound
from apps.inventory.services import owned_item_ids
from apps.progression.services import record_world_change, world_change_keys
from apps.quests import engine
from apps.quests.models import QuestProgress, QuestStatus


class QuestUnavailable(Exception):
    """Inactive, not for this child's age band, or its prerequisites do not hold."""

    code = "quest_unavailable"


def build_context(child) -> engine.QuestContext:
    completed_quests = QuestProgress.objects.for_child(child).filter(status=QuestStatus.COMPLETED)
    completed_adventures = AdventureSession.objects.for_child(child).filter(
        kind=SessionKind.ADVENTURE, status=SessionStatus.COMPLETED
    )
    return engine.QuestContext(
        world_change_keys=frozenset(world_change_keys(child)),
        owned_item_ids=frozenset(owned_item_ids(child)),
        completed_adventure_slugs=frozenset(
            completed_adventures.values_list("adventure__slug", flat=True)
        ),
        completed_quest_ids=frozenset(completed_quests.values_list("quest__slug", flat=True)),
    )


def _stage_and_objective_ids(quest: Quest) -> tuple[set[str], set[str]]:
    stages = quest.source.get("stages", [])
    return (
        {stage["id"] for stage in stages},
        {objective["id"] for stage in stages for objective in stage.get("objectives", [])},
    )


@transaction.atomic
def start_quest(child, quest: Quest, *, now=None) -> tuple[QuestProgress, bool]:
    """Accept a quest. Idempotent: a quest already started (or finished) is returned as is."""
    existing = QuestProgress.objects.for_child(child).filter(quest=quest).first()
    if existing:
        return existing, False
    if not quest.active or child.age_band not in quest.age_bands:
        raise QuestUnavailable
    if not engine.conditions_hold(quest.source.get("prerequisites", []), build_context(child)):
        raise QuestUnavailable
    at = now or timezone.now()
    try:
        with transaction.atomic():
            progress = QuestProgress.objects.create(
                child=child,
                quest=quest,
                status=QuestStatus.ACTIVE,
                current_stage_id=quest.source["entryStageId"],
                started_at=at,
                last_updated_at=at,
            )
    except IntegrityError:
        return QuestProgress.objects.for_child(child).get(quest=quest), False
    return progress, True


@transaction.atomic
def save_quest_state(
    child,
    progress_id,
    *,
    status: QuestStatus,
    current_stage_id: str,
    completed_stage_ids: list[str],
    completed_objective_ids: list[str],
    now=None,
) -> QuestProgress:
    try:
        progress = (
            QuestProgress.objects.for_child(child)
            .select_for_update()
            .select_related("quest")
            .get(pk=progress_id)
        )
    except QuestProgress.DoesNotExist:
        raise ProgressNotFound from None
    if progress.status == QuestStatus.COMPLETED:
        raise InvalidTransition
    stages, objectives = _stage_and_objective_ids(progress.quest)
    if current_stage_id not in stages or not set(completed_stage_ids) <= stages:
        raise InvalidTransition
    if not set(completed_objective_ids) <= objectives:
        raise InvalidTransition
    if not set(progress.completed_stage_ids) <= set(completed_stage_ids):
        raise InvalidTransition
    if not set(progress.completed_objective_ids) <= set(completed_objective_ids):
        raise InvalidTransition
    at = now or timezone.now()
    progress.status = status
    progress.current_stage_id = current_stage_id
    progress.completed_stage_ids = completed_stage_ids
    progress.completed_objective_ids = completed_objective_ids
    progress.last_updated_at = at
    progress.completed_at = at if status == QuestStatus.COMPLETED else None
    progress.save()
    return progress


@dataclass(frozen=True)
class QuestUpdate:
    progress: QuestProgress
    result: engine.AdvanceResult


def refresh_quest(progress: QuestProgress, *, source_session=None) -> QuestUpdate:
    """Walk a started quest forward against the child's real state and save it (TR-4).

    Locks the progress row, so two concurrent refreshes serialise; the world changes a stage or
    the quest owes are recorded once each. Call inside the caller's transaction when combined
    with the writes that made progress possible.
    """
    with transaction.atomic():
        progress = (
            QuestProgress.objects.select_for_update(of=("self",))
            .select_related("quest")
            .get(pk=progress.pk)
        )
        state = engine.QuestState(
            status=progress.status,
            current_stage_id=progress.current_stage_id,
            completed_stage_ids=tuple(progress.completed_stage_ids),
            completed_objective_ids=tuple(progress.completed_objective_ids),
        )
        source = progress.quest.source
        result = engine.advance_quest(
            source.get("stages", []),
            source.get("completion", {}),
            state,
            build_context(progress.child),
        )
        if result.changed:
            at = timezone.now()
            progress.status = result.state.status
            progress.current_stage_id = result.state.current_stage_id
            progress.completed_stage_ids = list(result.state.completed_stage_ids)
            progress.completed_objective_ids = list(result.state.completed_objective_ids)
            progress.last_updated_at = at
            if result.just_completed:
                progress.completed_at = at
            progress.save()
        for change in result.world_changes:
            record_world_change(
                progress.child,
                location_slug=change["locationSlug"],
                change_type=change["changeType"],
                change_key=change["changeKey"],
                source_session=source_session,
            )
        return QuestUpdate(progress=progress, result=result)


def refresh_active_quests(child, *, source_session=None) -> list[QuestUpdate]:
    active = QuestProgress.objects.for_child(child).filter(status=QuestStatus.ACTIVE).order_by("pk")
    return [refresh_quest(progress, source_session=source_session) for progress in active]
