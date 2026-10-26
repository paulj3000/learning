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
from apps.education.models import SkillProgress
from apps.inventory import services as inventory
from apps.inventory.services import owned_item_ids
from apps.progression import npc
from apps.progression.models import NpcRelationship, WorldChange, WorldState
from apps.progression.services import (
    record_world_change,
    set_npc_memory_flags_for_quest,
    world_change_keys,
)
from apps.quests import engine
from apps.quests.models import QuestProgress, QuestStatus


class QuestUnavailable(Exception):
    """Inactive, not for this child's age band, or its prerequisites do not hold."""

    code = "quest_unavailable"


def build_context(child) -> engine.QuestContext:
    """The Quest Engine's view of the child, from server records only (`buildQuestContext`).

    Same derivations as the client: a location counts as visited when the island recorded a
    change there (no footsteps are stored); relationship levels come from points, not the stored
    level column; skill statuses are the stored mastery level (LAI-0603), without review decay;
    discoveries are the child's found discovery ids.
    """
    completed_quests = QuestProgress.objects.for_child(child).filter(status=QuestStatus.COMPLETED)
    completed_adventures = AdventureSession.objects.for_child(child).filter(
        kind=SessionKind.ADVENTURE, status=SessionStatus.COMPLETED
    )
    changes = WorldChange.objects.for_child(child).values_list("change_key", "location_slug")
    relationships = list(NpcRelationship.objects.for_child(child))
    statuses = SkillProgress.objects.for_child(child).exclude(recent_level="")
    world_state = WorldState.objects.for_child(child).first()
    return engine.QuestContext(
        world_change_keys=frozenset(key for key, _ in changes),
        owned_item_ids=frozenset(owned_item_ids(child)),
        completed_adventure_slugs=frozenset(
            completed_adventures.values_list("adventure__slug", flat=True)
        ),
        completed_quest_ids=frozenset(completed_quests.values_list("quest__slug", flat=True)),
        visited_location_slugs=frozenset(location for _, location in changes),
        npc_memory_flags={r.npc_id: npc.parse_memory_flags(r.memory_flags) for r in relationships},
        relationship_levels={
            r.npc_id: npc.relationship_level_for_points(r.relationship_points)
            for r in relationships
        },
        skill_statuses=dict(statuses.values_list("learning_objective_code", "recent_level")),
        discovery_keys=frozenset(world_state.discovered_objects if world_state else ()),
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
    rewards: tuple = ()
    """`inventory.services.RewardGrant`s its completion fired (QUEST_COMPLETED, LAI-0605)."""


def refresh_quest(progress: QuestProgress, *, source_session=None, source_action=None) -> QuestUpdate:
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
        # A finished quest's effects, in the client's order (`syncQuestProgress`): world changes,
        # then NPC memory flags, then QUEST_COMPLETED rewards. Unlike the client, they share this
        # transaction, so a failure leaves the quest unfinished rather than half-applied.
        for change in result.world_changes:
            record_world_change(
                progress.child,
                location_slug=change["locationSlug"],
                change_type=change["changeType"],
                change_key=change["changeKey"],
                source_session=source_session,
                source_session_id="" if source_session else f"quest:{progress.quest.slug}",
            )
        rewards = ()
        if result.just_completed:
            for entry in source.get("completion", {}).get("setsNpcMemoryFlags") or []:
                set_npc_memory_flags_for_quest(progress.child, entry.get("npcId"), entry.get("flags"))
            rewards = tuple(
                inventory.grant_for_trigger(
                    progress.child,
                    {"type": "QUEST_COMPLETED", "questId": progress.quest.slug},
                    source_session=source_session,
                    source_action=source_action,
                )
            )
        return QuestUpdate(progress=progress, result=result, rewards=rewards)


def refresh_active_quests(child, *, source_session=None, source_action=None) -> list[QuestUpdate]:
    active = QuestProgress.objects.for_child(child).filter(status=QuestStatus.ACTIVE).order_by("pk")
    return [
        refresh_quest(progress, source_session=source_session, source_action=source_action)
        for progress in active
    ]
