"""Read models for native selection screens (LAI-ANDROID-API-001): home, regions, adventures.

No writes and no rules of their own. Everything is derived from the canonical rows: published
`regions.WorldRegion` under active catalog `Location` and `World`, active catalog `Adventure`
and `Quest`, and the requesting child's own sessions, world changes, inventory and quest
progress (ADR-033: no second catalog, progress or achievement model).

Hierarchy kept as it is: World -> Location -> WorldRegion (an explorable 3D region; the only
thing the game runtime can launch) and Location -> Adventure (step-based). A region's
adventures are its location's adventures.

Visibility: a region is visible to a child only when it is PUBLISHED, its location and world
are active, and the world supports the child's age band. Adventures and quests are shown only
when active and for the child's age band (CLAUDE.md section 3: never show content merely
because it exists). Draft and retired content is indistinguishable from absent content.
"""

from dataclasses import dataclass

from apps.catalog.models import Adventure, Quest
from apps.core.content_status import ContentStatus
from apps.inventory.models import InventoryItem
from apps.progression.models import WorldChange
from apps.quests import engine
from apps.quests.models import QuestProgress, QuestStatus
from apps.quests.services import build_context
from apps.regions.models import WorldRegion

from .models import OPEN_STATUSES, AdventureSession, SessionKind, SessionStatus

MAX_REGIONS = 50
MAX_ADVENTURES = 50
MAX_QUESTS = 50
HOME_RECENT = 5
HOME_NEXT = 5


class RegionNotVisible(LookupError):
    """Unknown, unpublished, retired, inactive, or not for this child's age band."""


def _visible_regions():
    return WorldRegion.objects.select_related("location__world").filter(
        status=ContentStatus.PUBLISHED, location__active=True, location__world__active=True
    )


def visible_region(child, region_id: str) -> WorldRegion:
    """The region if this child may see and launch it; otherwise `RegionNotVisible`."""
    region = _visible_regions().filter(region_id=region_id).first()
    if region is None or child.age_band not in region.location.world.supported_age_bands:
        raise RegionNotVisible
    return region


def visible_regions(child) -> list[WorldRegion]:
    regions = _visible_regions().order_by(
        "location__world__sort_order", "location__sort_order", "region_id"
    )[:MAX_REGIONS]
    return [r for r in regions if child.age_band in r.location.world.supported_age_bands]


@dataclass(frozen=True)
class RegionEntry:
    region: WorldRegion
    status: str  # NOT_STARTED, IN_PROGRESS (an open session), VISITED
    playable: bool  # at least one chest has a published challenge for the child's age band
    chests_total: int
    chests_opened: int
    open_session: AdventureSession | None
    last_session: AdventureSession | None


def region_entries(child, regions) -> list[RegionEntry]:
    region_ids = [r.region_id for r in regions]
    sessions = AdventureSession.objects.for_child(child).filter(
        kind=SessionKind.REGION, region_id__in=region_ids
    )
    latest: dict[str, AdventureSession] = {}
    open_by_region: dict[str, AdventureSession] = {}
    for session in sessions.order_by("-last_activity_at"):
        latest.setdefault(session.region_id, session)
        if session.status in OPEN_STATUSES:
            open_by_region.setdefault(session.region_id, session)
    changes = set(WorldChange.objects.for_child(child).values_list("location_slug", "change_key"))
    entries = []
    for region in regions:
        chests = list(
            region.chests.select_related(
                "sprout_challenge", "pathfinder_challenge", "explorer_challenge"
            )
        )
        playable = any(
            (spec := chest.challenge_for(child.age_band)) is not None
            and spec.status == ContentStatus.PUBLISHED
            for chest in chests
        )
        opened = sum((region.location.slug, chest.world_change_key) in changes for chest in chests)
        open_session = open_by_region.get(region.region_id)
        last = latest.get(region.region_id)
        status = "IN_PROGRESS" if open_session else ("VISITED" if last else "NOT_STARTED")
        entries.append(
            RegionEntry(region, status, playable, len(chests), opened, open_session, last)
        )
    return entries


@dataclass(frozen=True)
class AdventureEntry:
    adventure: Adventure
    status: str  # AVAILABLE, IN_PROGRESS, COMPLETED
    active_session: AdventureSession | None


def adventure_entries(child, location) -> list[AdventureEntry]:
    adventures = list(
        Adventure.objects.filter(
            location=location, active=True, age_bands__contains=[child.age_band]
        ).order_by("sort_order", "slug")[:MAX_ADVENTURES]
    )
    sessions = AdventureSession.objects.for_child(child).filter(
        kind=SessionKind.ADVENTURE, adventure__in=adventures
    )
    completed = set(
        sessions.filter(status=SessionStatus.COMPLETED).values_list("adventure_id", flat=True)
    )
    active = {s.adventure_id: s for s in sessions.filter(status=SessionStatus.ACTIVE)}
    entries = []
    for adventure in adventures:
        if adventure.pk in active:
            status = "IN_PROGRESS"
        elif adventure.pk in completed:
            status = "COMPLETED"
        else:
            status = "AVAILABLE"
        entries.append(AdventureEntry(adventure, status, active.get(adventure.pk)))
    return entries


@dataclass(frozen=True)
class QuestStatusEntry:
    quest: Quest
    status: str  # LOCKED, AVAILABLE, ACTIVE, COMPLETED
    progress: QuestProgress | None


def quest_status_entries(child, quests) -> list[QuestStatusEntry]:
    """Like `play_state.quest_entries`, but keeps quests whose prerequisites do not hold yet."""
    context = build_context(child)
    progress = {row.quest_id: row for row in QuestProgress.objects.for_child(child)}
    entries = []
    for quest in quests:
        if not quest.active or child.age_band not in quest.age_bands:
            continue
        row = progress.get(quest.pk)
        if row is not None:
            entries.append(QuestStatusEntry(quest, row.status, row))
        elif engine.conditions_hold(quest.source.get("prerequisites", []), context):
            entries.append(QuestStatusEntry(quest, "AVAILABLE", None))
        else:
            entries.append(QuestStatusEntry(quest, "LOCKED", None))
    return entries


def region_quests(child, region: WorldRegion) -> list[QuestStatusEntry]:
    offered = region.offered_quests.filter(active=True).order_by("slug")[:MAX_QUESTS]
    return quest_status_entries(child, offered)


def child_home(child) -> dict:
    """The home screen summary. Bounded lists; nothing here is a new progress measure."""
    regions = region_entries(child, visible_regions(child))
    sessions = AdventureSession.objects.for_child(child).select_related("adventure")
    last_session = sessions.order_by("-last_activity_at").first()
    last_region = None
    if last_session is not None and last_session.kind == SessionKind.REGION:
        last_region = next(
            (e for e in regions if e.region.region_id == last_session.region_id), None
        )
    completed = sessions.filter(status=SessionStatus.COMPLETED)
    quests = QuestProgress.objects.for_child(child)
    inventory = InventoryItem.objects.for_child(child).select_related("item")
    next_regions = [
        e
        for e in regions
        if e.open_session is None and e.playable and e.chests_opened < e.chests_total
    ][:HOME_NEXT]
    return {
        "child": child,
        "last_region": last_region,
        "resume": [e for e in regions if e.open_session is not None][:HOME_NEXT],
        "next_regions": next_regions,
        "summary": {
            "completed_sessions": completed.count(),
            "world_changes": WorldChange.objects.for_child(child).count(),
            "items": inventory.count(),
            "quests_completed": quests.filter(status=QuestStatus.COMPLETED).count(),
            "quests_active": quests.filter(status=QuestStatus.ACTIVE).count(),
        },
        "recent_items": list(inventory.order_by("-acquired_at")[:HOME_RECENT]),
        "recent_completed": list(completed.order_by("-completed_at")[:HOME_RECENT]),
        "recent_world_changes": list(
            WorldChange.objects.for_child(child).order_by("-created_at")[:HOME_RECENT]
        ),
    }
