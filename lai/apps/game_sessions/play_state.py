"""Read models for the play API (TR-5). No writes and no rules of their own.

Everything returned is published content plus the requesting child's own records. Assets are
ids (ADR-030), never URLs. Nothing here reads an attempt's answer.
"""

from dataclasses import dataclass

from django.db.models import Count, Q

from apps.catalog import authoring
from apps.catalog.models import ContentAsset, Quest
from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence
from apps.inventory.models import InventoryItem
from apps.inventory.services import owned_item_ids
from apps.progression.models import WorldChange
from apps.quests import engine
from apps.quests.models import QuestProgress
from apps.quests.services import build_context
from apps.regions.models import PlacementKind, TreasureChest, WorldRegion
from apps.users.models import AgeBand

from .adventure_launch import launch_points_for
from .models import OPEN_STATUSES, AdventureSession, Correctness, PuzzleAttempt, SessionKind

ALL_BANDS = tuple(AgeBand.values)

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
    # Imported here: `play` imports this module's neighbours, and the lock rule lives there.
    from .play import chest_lock

    changes = world_change_keys_by_location(child)
    items = owned_item_ids(child)
    location = region.location.slug
    placements = region.placements.select_related("npc").order_by("entity_id")
    npcs = [p for p in placements if p.kind == PlacementKind.NPC and p.npc and p.npc.active]
    objects = [
        {
            "placement": p,
            "collected": p.is_pickup and (location, p.pickup_change_key) in changes,
        }
        for p in placements
        if p.kind != PlacementKind.NPC
    ]
    chests = []
    for chest in region.chests.select_related(
        "region__location",
        "required_item",
        "sprout_challenge",
        "pathfinder_challenge",
        "explorer_challenge",
    ).order_by("sort_order", "entity_id"):
        spec = chest.challenge_for(child.age_band)
        is_open = (location, chest.world_change_key) in changes
        chests.append(
            {
                "chest": chest,
                "is_open": is_open,
                "challenge_available": spec is not None and spec.status == ContentStatus.PUBLISHED,
                "lock_reason": (
                    None if is_open else chest_lock(child, chest, keys=changes, items=items)
                ),
            }
        )
    offered = region.offered_quests.filter(active=True).order_by("slug")
    session = open_session(child, region)
    region_content = authoring.body_for(session, region)
    return {
        "region": region,
        "catalog": region_catalog(region),
        "region_content": region_content,
        "puzzles": puzzle_states(
            child, region, session, puzzle_lines(child, session, [p.npc for p in npcs])
        ),
        "npc_dialogue": {
            placement.entity_id: npc_dialogue(child, session, placement.npc) for placement in npcs
        },
        "spawn": region.spawn_points.filter(is_default=True).first(),
        "npcs": npcs,
        "objects": objects,
        "chests": chests,
        "quests": quest_entries(child, offered),
        "session": session,
        "world_changes": WorldChange.objects.filter(child=child, location_slug=location),
        # ADR-041: the objects here that start one of this Place's Adventures, for this child.
        "launch_points": launch_points_for(child, region),
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
    }


# --- ADR-047 content in the bootstrap (LAI-0812, LAI-0813) ---------------------------------------

# NPC dialogue conditions the server can prove today. Nodes needing anything else (memory flags,
# relationships, time of day) are left out rather than guessed (as in `apps.quests.engine`).
_SERVER_CONDITIONS = {"ALWAYS", "WORLD_CHANGE", "QUEST_COMPLETED"}


def _condition_holds(condition: dict, change_keys: set[str], completed_quests: set[str]) -> bool:
    kind = condition.get("type")
    if kind == "ALWAYS":
        return True
    if kind == "WORLD_CHANGE":
        return condition.get("changeKey") in change_keys
    if kind == "QUEST_COMPLETED":
        return condition.get("questId") in completed_quests
    return False


def npc_dialogue(child, session, npc) -> list[dict]:
    """The NPC's dialogue nodes whose conditions hold for this child now, in authored order,
    from the version this visit started with. Text is authored content, never generated."""
    body = authoring.body_for(session, npc)
    context = build_context(child)
    change_keys = set(context.world_change_keys)
    completed = set(context.completed_quest_ids)
    band = child.age_band
    audible = {
        node["id"] for node in body.get("dialogue", []) if band in node.get("ageBands", ALL_BANDS)
    }
    for_other_bands = {node["id"] for node in body.get("dialogue", [])} - audible
    nodes = []
    for node in body.get("dialogue", []):
        if node["id"] not in audible:  # LAI-0817: this line is for other age bands
            continue
        if "puzzleLine" in node:  # said in a puzzle panel, never in conversation (FP-D9)
            continue
        conditions = node.get("conditions", [])
        if any(condition.get("type") not in _SERVER_CONDITIONS for condition in conditions):
            continue
        if not all(_condition_holds(c, change_keys, completed) for c in conditions):
            continue
        nodes.append(
            {
                "nodeId": node["id"],
                "text": node["text"],
                "followUpOnly": bool(node.get("followUpOnly", False)),
                "choices": [
                    {
                        "choiceId": choice["id"],
                        "label": choice["label"],
                        "nextNodeId": choice.get("nextNodeId"),
                    }
                    for choice in node.get("choices", [])
                    if choice.get("nextNodeId") not in for_other_bands
                    and all(
                        _condition_holds(c, change_keys, completed)
                        for c in choice.get("conditions", [])
                    )
                ],
            }
        )
    return nodes


# LAI-0817 (FP-D9): what an NPC says about a puzzle, served inside the puzzle's parameters.
PUZZLE_LINE_PARTS = ("intro", "completeMessage", "scienceNote")


def puzzle_lines(child, session, npcs) -> dict[str, dict[str, str]]:
    """`{puzzleId: {part: text}}` from the dialogue of the NPCs placed in this 3D Area.

    Only nodes with a `puzzleLine` that the child's age band hears, from the NPC version the open
    visit pinned (or the published one before a visit starts). The first line in authored order
    wins; publishing refuses two for the same puzzle, part and band.
    """
    band = child.age_band
    lines: dict[str, dict[str, str]] = {}
    for npc in npcs:
        for node in authoring.body_for(session, npc).get("dialogue", []):
            line = node.get("puzzleLine")
            if not isinstance(line, dict) or band not in node.get("ageBands", ALL_BANDS):
                continue
            if line.get("part") in PUZZLE_LINE_PARTS and isinstance(node.get("text"), str):
                lines.setdefault(line.get("puzzleId"), {}).setdefault(line["part"], node["text"])
    return lines


def _with_lines(params: dict, title: str, lines: dict[str, str]) -> dict:
    """The band parameters with the NPC's lines added. A revision pinned before the move keeps
    its own copies when no line replaces them, so an open visit plays as it started. A puzzle
    with no intro anywhere opens with its authored title (the safe fallback), never silence.
    """
    served = {**params, **lines}
    if not isinstance(served.get("intro"), str) or not served["intro"].strip():
        served["intro"] = title
    return served


def puzzle_states(
    child, region: WorldRegion, session, lines: dict[str, dict[str, str]] | None = None
) -> list[dict]:
    """Published puzzles that have parameters for the child's age band, with this child's state.

    Parameters come from the version the open visit pinned (or the published one before a visit
    starts), with the puzzle's NPC lines from `lines` (`puzzle_lines`). Every kind is fully
    described by its parameters, so nothing secret is sent.
    """
    lines = lines or {}
    from .play import puzzle_is_locked, puzzle_is_solved

    states = []
    published = region.puzzles.filter(status=ContentStatus.PUBLISHED).order_by(
        "sort_order", "puzzle_id"
    )
    for puzzle in published:
        body = authoring.body_for(session, puzzle)
        params = body.get("ageBands", {}).get(child.age_band)
        if params is None:
            continue
        params = _with_lines(params, body.get("title", ""), lines.get(puzzle.puzzle_id, {}))
        solved = puzzle_is_solved(child, puzzle, body)
        failed = (
            PuzzleAttempt.objects.filter(
                session=session, puzzle_key=puzzle.puzzle_id, correct=False
            ).count()
            if session is not None
            else 0
        )
        states.append(
            {
                "puzzle": puzzle,
                "body": body,
                "parameters": params,
                "solved": solved,
                "locked": not solved and puzzle_is_locked(child, puzzle, body),
                "failed_attempts": failed,
            }
        )
    return states


def region_catalog(region: WorldRegion) -> dict:
    """What the client validates a served 3D Area against (ADR-047 A: Django is authoritative).

    The Island, and every asset the layout names, with its kind, clips, and whether a model can
    be delivered now (a published version, or a bundled file). An asset that cannot be delivered
    is drawn as a stand-in until an administrator publishes one (FP-3).
    """
    scene = region.scene if isinstance(region.scene, dict) else {}
    effects = scene.get("effects", {}) if isinstance(scene.get("effects"), dict) else {}
    ids = set(region.placements.exclude(asset_id="").values_list("asset_id", flat=True))
    ids.update(region.chests.exclude(asset_id="").values_list("asset_id", flat=True))
    for value in (scene.get("groundAssetId"), (effects.get("backdrop") or {}).get("assetId")):
        if isinstance(value, str) and value:
            ids.add(value)
    assets = ContentAsset.objects.filter(asset_id__in=ids).order_by("asset_id")
    return {
        "worldSlug": region.location.world.slug,
        "assets": [
            {
                "assetId": asset.asset_id,
                "kind": asset.kind,
                "clips": list(asset.clips),
                "deliverable": bool(asset.default_version_id or asset.bundled_path),
            }
            for asset in assets
        ],
    }
