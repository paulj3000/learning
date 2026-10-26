"""Read models for the play API (TR-5). No writes and no rules of their own.

Everything returned is published content plus the requesting child's own records. Assets are
ids (ADR-030), never URLs. Nothing here reads an attempt's answer.
"""

from dataclasses import dataclass

from django.db.models import Count, Q

from apps.catalog.models import Quest
from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence
from apps.education.reads import mastery_summaries
from apps.inventory.models import InventoryItem
from apps.progression.models import WorldChange
from apps.quests import engine
from apps.quests.models import QuestProgress
from apps.quests.services import build_context
from apps.regions.models import PlacementKind, TreasureChest, WorldRegion

from .models import OPEN_STATUSES, AdventureSession, Correctness, SessionKind

RECENT_SESSIONS = 20


class RegionNotFound(LookupError):
    """Unknown, draft, or retired: indistinguishable on purpose."""


def published_region(region_id: str) -> WorldRegion:
    try:
        return WorldRegion.objects.select_related("location").get(
            region_id=region_id,
            status=ContentStatus.PUBLISHED,
            location__active=True,
        )
    except WorldRegion.DoesNotExist:
        raise RegionNotFound from None


def published_quest(quest_id: str) -> Quest:
    """An active catalog quest (the catalog's `active` is Treasure Rush's "published")."""
    try:
        return Quest.objects.get(slug=quest_id, active=True)
    except Quest.DoesNotExist:
        raise LookupError from None


@dataclass(frozen=True)
class QuestEntry:
    quest: Quest
    status: str  # AVAILABLE, ACTIVE, or COMPLETED
    progress: QuestProgress | None


def quest_entries(child, quests) -> list[QuestEntry]:
    """Quests the child has started, plus published ones they could accept now."""
    context = build_context(child)
    progress = {row.quest_id: row for row in QuestProgress.objects.for_child(child)}
    entries = []
    for quest in quests:
        row = progress.get(quest.pk)
        if row is not None:
            entries.append(QuestEntry(quest, row.status, row))
        elif (
            quest.active
            and child.age_band in quest.age_bands
            and engine.conditions_hold(quest.source.get("prerequisites", []), context)
        ):
            entries.append(QuestEntry(quest, "AVAILABLE", None))
    return entries


def open_session(child, region: WorldRegion) -> AdventureSession | None:
    return AdventureSession.objects.filter(
        child=child,
        kind=SessionKind.REGION,
        region_id=region.region_id,
        status__in=OPEN_STATUSES,
    ).first()


def world_change_keys_by_location(child) -> set[tuple[str, str]]:
    return set(WorldChange.objects.filter(child=child).values_list("location_slug", "change_key"))


def region_bootstrap(child, region: WorldRegion) -> dict:
    changes = world_change_keys_by_location(child)
    location = region.location.slug
    placements = region.placements.select_related("npc").order_by("entity_id")
    npcs = [p for p in placements if p.kind == PlacementKind.NPC and p.npc and p.npc.active]
    objects = [p for p in placements if p.kind != PlacementKind.NPC]
    chests = []
    for chest in region.chests.select_related(
        "sprout_challenge", "pathfinder_challenge", "explorer_challenge"
    ).order_by("entity_id"):
        spec = chest.challenge_for(child.age_band)
        chests.append(
            {
                "chest": chest,
                "is_open": (location, chest.world_change_key) in changes,
                "challenge_available": spec is not None and spec.status == ContentStatus.PUBLISHED,
            }
        )
    offered = region.offered_quests.filter(active=True).order_by("slug")
    return {
        "region": region,
        "spawn": region.spawn_points.filter(is_default=True).first(),
        "npcs": npcs,
        "objects": objects,
        "chests": chests,
        "quests": quest_entries(child, offered),
        "session": open_session(child, region),
        "world_changes": WorldChange.objects.filter(child=child, location_slug=location),
    }


def opened_chests(child) -> list[TreasureChest]:
    keys = world_change_keys_by_location(child)
    chests = TreasureChest.objects.select_related("region__location").filter(
        world_change_key__in={key for _, key in keys}
    )
    return [c for c in chests if (c.region.location.slug, c.world_change_key) in keys]


def practice_summary(child) -> list[dict]:
    """How often each objective was practised and answered right. Counts, never a label."""
    rows = (
        SkillEvidence.objects.for_child(child)
        .values("learning_objective_code")
        .annotate(
            attempts=Count("id"),
            correct=Count("id", filter=Q(result=Correctness.CORRECT)),
        )
        .order_by("learning_objective_code")
    )
    return [
        {
            "objective_code": row["learning_objective_code"],
            "attempts": row["attempts"],
            "correct": row["correct"],
        }
        for row in rows
    ]


def child_progress(child) -> dict:
    started = Quest.objects.filter(progress__child=child).order_by("slug")
    return {
        "sessions": AdventureSession.objects.filter(child=child).order_by("-started_at")[
            :RECENT_SESSIONS
        ],
        "world_changes": WorldChange.objects.filter(child=child),
        "opened_chests": opened_chests(child),
        "inventory": InventoryItem.objects.filter(child=child).select_related("item"),
        "quests": quest_entries(child, started),
        "practice": practice_summary(child),
        "mastery": mastery_summaries(child),
    }
