"""Persistence transitions for quest progress (LAI-0305).

Server-side only; LAI-0605 calls these with the result of the Python port of `advanceQuest`
(golden vectors, LAI-0303). This module only refuses states the quest cannot be in:

- stage and objective ids must be the quest's own (read from the catalog row's `source`);
- completed stage and objective lists only grow, as `advanceQuest` only adds;
- a COMPLETED quest never changes again ("a completed quest never changes" vector).
"""

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Quest
from apps.game_sessions.services import InvalidTransition, ProgressNotFound
from apps.quests.models import QuestProgress, QuestStatus


def _stage_and_objective_ids(quest: Quest) -> tuple[set[str], set[str]]:
    stages = quest.source.get("stages", [])
    return (
        {stage["id"] for stage in stages},
        {objective["id"] for stage in stages for objective in stage.get("objectives", [])},
    )


@transaction.atomic
def start_quest(child, quest: Quest, *, now=None) -> tuple[QuestProgress, bool]:
    """The child's progress row for this quest, created at the entry stage if there is none."""
    existing = QuestProgress.objects.for_child(child).filter(quest=quest).first()
    if existing:
        return existing, False
    at = now or timezone.now()
    try:
        with transaction.atomic():
            progress = QuestProgress.objects.create(
                child=child, quest=quest, status=QuestStatus.ACTIVE,
                current_stage_id=quest.source["entryStageId"], started_at=at, last_updated_at=at,
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
            QuestProgress.objects.for_child(child).select_for_update().select_related("quest")
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
