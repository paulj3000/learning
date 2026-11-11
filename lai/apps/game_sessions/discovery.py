"""Read models for native selection screens (LAI-ANDROID-API-001): home, regions, adventures.

No writes and no rules of their own. Everything is derived from the canonical rows: published
`regions.WorldRegion` under active catalog `Location` and `World`, active catalog `Adventure`
and `Quest`, and the requesting child's own sessions, world changes, inventory and quest
progress (ADR-033: no second catalog, progress or achievement model).

Hierarchy kept as it is (ADR-041 names: Island > Place > 3D Area): World -> Location ->
WorldRegion (at most one 3D Area per Place; the only thing the game runtime can launch) and
Location -> Adventure (step-based, owned by the Place). A region's adventures are its Place's.

Visibility: a region is visible to a child only when it is PUBLISHED, its location and world
are active, and the world supports the child's age band. Adventures and quests are shown only
when active and for the child's age band (CLAUDE.md section 3: never show content merely
because it exists). Draft and retired content is indistinguishable from absent content.
"""

from dataclasses import dataclass

from apps.assets.models import VersionStatus
from apps.catalog.models import (
    ART_ASSET_KINDS,
    Adventure,
    AdventureStep,
    AssetStatus,
    ContentAsset,
    LearningObjective,
    Quest,
    World,
)
from apps.core.content_status import ContentStatus
from apps.inventory.models import InventoryItem
from apps.progression.models import WorldChange
from apps.quests import engine
from apps.quests.models import QuestProgress, QuestStatus
from apps.quests.services import build_context
from apps.regions.models import ChestPresentation, WorldRegion

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
    if (
        region is None
        or child.age_band not in region.location.world.supported_age_bands
        or not region.supports_band(child.age_band)
    ):
        raise RegionNotVisible
    return region


def visible_regions(child) -> list[WorldRegion]:
    regions = _visible_regions().order_by(
        "location__world__sort_order", "location__sort_order", "region_id"
    )[:MAX_REGIONS]
    return [
        r
        for r in regions
        if child.age_band in r.location.world.supported_age_bands
        and r.supports_band(child.age_band)
    ]


@dataclass(frozen=True)
class RegionEntry:
    region: WorldRegion
    status: str  # NOT_STARTED, IN_PROGRESS (an open session), VISITED
    playable: bool  # at least one chest has a published challenge for the child's age band
    chests_total: int
    chests_opened: int
    open_session: AdventureSession | None
    last_session: AdventureSession | None
    # AP-03: the learning objectives its chests teach this child (published specs, its band).
    objective_codes: tuple[str, ...] = ()


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
        # A puzzle (TR-14) is a challenge on a pedestal, and a replay activity (TR-20) never
        # opens; neither is a chest the child counts.
        chests = list(
            region.chests.exclude(
                presentation__in=[ChestPresentation.PUZZLE, ChestPresentation.REPLAY]
            ).select_related("sprout_challenge", "pathfinder_challenge", "explorer_challenge")
        )
        specs = [
            spec
            for chest in chests
            if (spec := chest.challenge_for(child.age_band)) is not None
            and spec.status == ContentStatus.PUBLISHED
        ]
        playable = bool(specs)
        opened = sum((region.location.slug, chest.world_change_key) in changes for chest in chests)
        open_session = open_by_region.get(region.region_id)
        last = latest.get(region.region_id)
        status = "IN_PROGRESS" if open_session else ("VISITED" if last else "NOT_STARTED")
        codes = tuple(dict.fromkeys(spec.skill_id for spec in specs))
        entries.append(
            RegionEntry(region, status, playable, len(chests), opened, open_session, last, codes)
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


MAX_ISLANDS = 20
MAX_PLACES = 50

# AP-03 Realm Explorer filters. The four subject areas a child can filter by, in display order,
# and the published `LearningObjective.domain` each one stands for. A Place's subject areas are
# the domains of the objectives it actually teaches this child (its Adventures' steps and its 3D
# Area's chest challenges), so nothing here classifies content by hand. Domains with no subject
# area (executive-function, social-emotional) are simply not filterable. An administrator can
# replace the derived list for an Island or Place with an authored `subjectAreas` (ADR-047).
SUBJECT_AREAS = ("MATH", "READING", "SCIENCE", "CREATIVITY")
DOMAIN_SUBJECT_AREA = {
    "numeracy": "MATH",
    "literacy": "READING",
    "science": "SCIENCE",
    "creativity": "CREATIVITY",
}


@dataclass(frozen=True)
class PlaceEntry:
    place: object  # catalog.Location
    area: RegionEntry | None  # its published 3D Area for this child, if any (at most one)
    adventure_count: int
    explored: bool = False  # the child has started an adventure here or entered its 3D Area
    subject_areas: tuple[str, ...] = ()  # AP-03, in `SUBJECT_AREAS` order
    art_asset_id: str | None = None  # AP-03: a published image, or None (draw the fallback)


@dataclass(frozen=True)
class IslandEntry:
    island: object  # catalog.World
    places: list[PlaceEntry]
    unlocked: bool = True
    locked_hint: str | None = None
    subject_areas: tuple[str, ...] = ()
    art_asset_id: str | None = None


def place_unlocked(place, change_keys: set[str]) -> bool:
    """A secret Place (its authored `unlockRequirement`) stays hidden until its world change
    exists for this child, matching the harbor map's rule (AP-03)."""
    requirement = (place.source or {}).get("unlockRequirement")
    if not isinstance(requirement, dict):
        return True
    key = requirement.get("changeKey")
    return not isinstance(key, str) or not key or key in change_keys


def island_unlock(island, change_keys: set[str]) -> tuple[bool, str | None]:
    """Whether the child can sail to this Island yet (AP-03).

    The rule is the Island's own `travelRequirement`, as authored (the exported record, or an
    administrator's published edit, ADR-047): open once any one of its world changes exists.
    The home Island and an Island without a rule are always open. The hint is authored copy.
    """
    requirement = (island.source or {}).get("travelRequirement")
    if island.is_home or not isinstance(requirement, dict):
        return True, None
    keys = requirement.get("anyOfChangeKeys")
    if not isinstance(keys, list) or not keys:
        return True, None
    if any(isinstance(key, str) and key in change_keys for key in keys):
        return True, None
    hint = requirement.get("lockedHint")
    return False, hint if isinstance(hint, str) and hint else None


def ordered_subject_areas(areas) -> tuple[str, ...]:
    found = set(areas)
    return tuple(area for area in SUBJECT_AREAS if area in found)


def authored_subject_areas(row) -> tuple[str, ...] | None:
    """An administrator's `subjectAreas` for this Island or Place, or None to derive them."""
    value = (row.source or {}).get("subjectAreas")
    if not isinstance(value, list):
        return None
    return ordered_subject_areas(area for area in value if area in SUBJECT_AREAS)


def authored_art(row) -> str | None:
    value = (row.source or {}).get("artAssetId")
    return value if isinstance(value, str) and value else None


def published_art(asset_ids) -> set[str]:
    """The ids that name an active image definition whose default version is published, so the
    child-scoped asset resolver will deliver it (ADR-030, LAI-2200). One query; anything else
    (unknown, retired, draft, a model) is left out and the client draws its fallback."""
    ids = {asset_id for asset_id in asset_ids if asset_id}
    if not ids:
        return set()
    return set(
        ContentAsset.objects.filter(
            asset_id__in=ids,
            status=AssetStatus.ACTIVE,
            kind__in=ART_ASSET_KINDS,
            default_version__status=VersionStatus.PUBLISHED,
        ).values_list("asset_id", flat=True)
    )


def child_islands(child) -> list[IslandEntry]:
    """Island > Place > 3D Area for this child (ADR-041). Inactive Islands and Places, other age
    bands, unpublished 3D Areas and secret Places not yet unlocked are left out; a Place without
    a 3D Area is still listed. Each Island says whether it is open to this child, what it teaches
    and its published picture, if it has one (AP-03)."""
    islands = [
        world
        for world in World.objects.filter(active=True).order_by("sort_order", "slug")[:MAX_ISLANDS]
        if child.age_band in world.supported_age_bands
    ]
    regions = {r.location_id: r for r in visible_regions(child)}
    areas = {e.region.location_id: e for e in region_entries(child, list(regions.values()))}
    # Places the child has started something in: a step adventure there, or its 3D Area.
    adventured = set(
        AdventureSession.objects.for_child(child)
        .filter(adventure__isnull=False)
        .values_list("adventure__location_id", flat=True)
    )
    change_keys = set(WorldChange.objects.for_child(child).values_list("change_key", flat=True))
    visible: list[tuple[object, list]] = []
    for island in islands:
        places = [
            place
            for place in island.locations.filter(active=True).order_by("sort_order", "slug")[
                :MAX_PLACES
            ]
            if place_unlocked(place, change_keys)
        ]
        visible.append((island, places))
    place_ids = [place.pk for _island, places in visible for place in places]
    # What each Place teaches this child: its Adventures' step objectives for the child's band,
    # then its 3D Area's chest challenges. Two queries for every Island together.
    codes: dict[object, list[str]] = {pk: [] for pk in place_ids}
    for location_id, objective_ids in AdventureStep.objects.filter(
        adventure__location_id__in=place_ids,
        adventure__active=True,
        adventure__age_bands__contains=[child.age_band],
    ).values_list("adventure__location_id", "objective_ids"):
        codes[location_id].extend(objective_ids or [])
    for location_id, entry in areas.items():
        if location_id in codes:
            codes[location_id].extend(entry.objective_codes)
    domains = dict(
        LearningObjective.objects.filter(
            code__in={code for found in codes.values() for code in found}
        ).values_list("code", "domain")
    )
    art = published_art(
        authored_art(row) for island, places in visible for row in (island, *places)
    )

    def art_of(row) -> str | None:
        asset_id = authored_art(row)
        return asset_id if asset_id in art else None

    result = []
    for island, island_places in visible:
        places = []
        for place in island_places:
            count = Adventure.objects.filter(
                location=place, active=True, age_bands__contains=[child.age_band]
            ).count()
            area = areas.get(place.pk)
            explored = place.pk in adventured or (area is not None and area.status != "NOT_STARTED")
            subject_areas = authored_subject_areas(place)
            if subject_areas is None:
                subject_areas = ordered_subject_areas(
                    DOMAIN_SUBJECT_AREA.get(domains.get(code, "")) for code in codes[place.pk]
                )
            places.append(PlaceEntry(place, area, count, explored, subject_areas, art_of(place)))
        unlocked, hint = island_unlock(island, change_keys)
        island_areas = authored_subject_areas(island)
        if island_areas is None:
            island_areas = ordered_subject_areas(a for p in places for a in p.subject_areas)
        result.append(IslandEntry(island, places, unlocked, hint, island_areas, art_of(island)))
    return result
