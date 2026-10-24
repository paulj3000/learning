"""Quest progress writes (TR-4). Completion is decided here, from server-side state only."""

from dataclasses import dataclass

from django.db import transaction
from django.utils.timezone import now

from apps.core.catalog import ContentStatus
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.inventory.services import owned_item_ids
from apps.progression.services import record_world_change_once, world_change_keys

from . import engine
from .models import QuestDefinition, QuestProgress, QuestStatus


class QuestUnavailable(Exception):
    """Not published, not for this child's age band, or its prerequisites do not hold."""

    code = "quest_unavailable"


def build_context(child) -> engine.QuestContext:
    completed_quests = QuestProgress.objects.filter(child=child, status=QuestStatus.COMPLETED)
    completed_adventures = AdventureSession.objects.filter(
        child=child, kind=SessionKind.ADVENTURE, status=SessionStatus.COMPLETED
    )
    return engine.QuestContext(
        world_change_keys=frozenset(world_change_keys(child)),
        owned_item_ids=frozenset(owned_item_ids(child)),
        completed_adventure_slugs=frozenset(
            completed_adventures.values_list("template_slug", flat=True)
        ),
        completed_quest_ids=frozenset(completed_quests.values_list("quest__quest_id", flat=True)),
    )


def start_quest(child, quest: QuestDefinition) -> tuple[QuestProgress, bool]:
    """Accept a quest. Idempotent: a quest already started (or finished) is returned as is."""
    existing = QuestProgress.objects.filter(child=child, quest=quest).first()
    if existing is not None:
        return existing, False
    if quest.status != ContentStatus.PUBLISHED or child.age_band not in quest.age_bands:
        raise QuestUnavailable
    if not engine.conditions_hold(quest.prerequisites, build_context(child)):
        raise QuestUnavailable
    with transaction.atomic():
        return QuestProgress.objects.get_or_create(
            child=child, quest=quest, defaults={"current_stage_id": quest.entry_stage_id}
        )


@dataclass(frozen=True)
class QuestUpdate:
    progress: QuestProgress
    result: engine.AdvanceResult


def refresh_quest(progress: QuestProgress, *, source_session=None) -> QuestUpdate:
    """Walk a started quest forward against the child's real state and save it.

    Locks the progress row, so two concurrent refreshes serialise; the world changes a stage or
    the quest owes are recorded once each. Call inside the caller's transaction when combined
    with the writes that made progress possible.
    """
    with transaction.atomic():
        progress = QuestProgress.objects.select_for_update().get(pk=progress.pk)
        state = engine.QuestState(
            status=progress.status,
            current_stage_id=progress.current_stage_id,
            completed_stage_ids=tuple(progress.completed_stage_ids),
            completed_objective_ids=tuple(progress.completed_objective_ids),
        )
        quest = progress.quest
        result = engine.advance_quest(
            quest.stages, quest.completion, state, build_context(progress.child)
        )
        if result.changed:
            progress.status = result.state.status
            progress.current_stage_id = result.state.current_stage_id
            progress.completed_stage_ids = list(result.state.completed_stage_ids)
            progress.completed_objective_ids = list(result.state.completed_objective_ids)
            if result.just_completed:
                progress.completed_at = now()
            progress.save()
        for change in result.world_changes:
            record_world_change_once(
                progress.child,
                location_slug=change["locationSlug"],
                change_type=change["changeType"],
                change_key=change["changeKey"],
                source_session=source_session,
            )
        return QuestUpdate(progress=progress, result=result)


def refresh_active_quests(child, *, source_session=None) -> list[QuestUpdate]:
    active = QuestProgress.objects.filter(child=child, status=QuestStatus.ACTIVE).order_by("pk")
    return [refresh_quest(progress, source_session=source_session) for progress in active]
