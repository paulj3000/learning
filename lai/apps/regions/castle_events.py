"""Ambient return-visit events for Storykeeper Castle (SC-R08-01, SC-R09-01, ADR-065).

**An event is atmosphere, never progress.** It is authored words and an ambient cue; showing one
grants nothing and writes nothing but a display counter (`CastleEventShown`), so the same moment
is not shown on every visit. There is no reward, quest, world change or session write here.

**Repetition is counted in visits, never in time.** `CastleVisitState` counts the child's
separate castle visits (one per new client `visitId`). There is no clock, streak, countdown or
"come back" pressure anywhere: waiting never changes what is eligible and being away is never
penalised.

**Django is the one catalog (ADR-065, ADR-047).** The events are `CastleEvent` rows, edited in
Django Admin as revisions (draft, submitted, published, superseded; a retired event is never
eligible). `castle_events.json` is only the first-import seed: `import_seed` creates the rows
that do not exist, never touches an event an administrator has edited or retired, and
`catalog()` serves the seed itself only while no event is published (a fresh database, or
before the first import), so the castle works before and after the import. The client keeps no
catalog: only one quiet default line per room (`castleDefaultLines.ts`) for when the API fails.

`eligible_events` and `default_event` take and return plain JSON-shaped dicts, with the state in
camelCase. Conditions are the NPC Manager's (`apps.npcs.conditions.holds`), limited to the types
the contract allows; an unknown type never holds (fail closed).
"""

import copy
import json
import re
import uuid
from pathlib import Path

from django.db import transaction
from django.db.models import F

from apps.npcs import conditions as npc_conditions
from apps.progression.models import NpcRelationship
from apps.progression.services import world_change_pairs
from apps.quests.models import QuestProgress

from . import castle_rooms
from .models import CastleEvent, CastleEventShown, CastleVisitState

_DATA = json.loads((Path(__file__).parent / "castle_events.json").read_text(encoding="utf-8"))

#: The import seed, in the event shape. Served only while no event is published.
SEED_CATALOG: tuple[dict, ...] = tuple(_DATA["events"])

#: The condition types an event may use. Anything else never holds.
SUPPORTED_CONDITIONS = frozenset(
    {"ALWAYS", "WORLD_CHANGE", "QUEST_STATUS", "RELATIONSHIP_AT_LEAST"}
)

#: Each cue's one-word mood, the only thing besides an id the model is told about an event.
CUE_TAGS: dict[str, str] = {
    "dust-motes": "calm",
    "candle-flicker": "calm",
    "lantern-glow": "calm",
    "page-rustle": "curious",
    "paint-shimmer": "curious",
    "quill-scratch": "warm",
    "ember-flyby": "playful",
}


#: The authored shape of an event's content (a revision body): the seed's keys without the
#: row-level `status`, `version` and `secret`, which the server sets.
BODY_KEYS = frozenset(
    {"id", "room", "bands", "requires", "repeat", "weight", "npcId", "lines", "visual", "fallback"}
)
BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")
NPC_IDS = frozenset({"keeper-quill", "ember-dragon"})
RELATIONSHIP_LEVELS = frozenset({"STRANGER", "ACQUAINTANCE", "FRIEND", "TRUSTED_FRIEND"})
QUEST_STATUSES = frozenset({"NOT_STARTED", "ACTIVE", "COMPLETED"})
#: Copy that would pressure or reward a child. Ambient events are atmosphere only.
_PRESSURE = re.compile(
    r"tomorrow|come back|streak|countdown|hurry|miss(ed)? you|reward|unlock", re.IGNORECASE
)


def _condition_problems(index: int, condition: object, npc_id: object) -> list[str]:
    where = f"$.requires[{index}]"
    if not isinstance(condition, dict):
        return [f"{where}: must be an object"]
    kind = condition.get("type")
    if kind not in SUPPORTED_CONDITIONS:
        return [
            f"{where}.type: {kind!r} is not allowed; use {', '.join(sorted(SUPPORTED_CONDITIONS))}"
        ]
    problems = []
    if kind == "WORLD_CHANGE" and not (
        isinstance(condition.get("key"), str) and condition["key"].strip()
    ):
        problems.append(f"{where}.key: a world change needs a key")
    if kind == "QUEST_STATUS":
        if not (isinstance(condition.get("quest"), str) and condition["quest"].strip()):
            problems.append(f"{where}.quest: a quest condition needs a quest id")
        if condition.get("status") not in QUEST_STATUSES:
            problems.append(f"{where}.status: must be one of {', '.join(sorted(QUEST_STATUSES))}")
    if kind == "RELATIONSHIP_AT_LEAST":
        if condition.get("level") not in RELATIONSHIP_LEVELS:
            problems.append(f"{where}.level: must be a relationship level")
        if npc_id is None:
            problems.append(f"{where}: a relationship condition needs an npcId")
    return problems


def body_problems(body: object) -> list[str]:
    """Every reason `body` cannot be a published castle event (empty when it can).

    The id check is the authoring service's (`authoring.validate`). Called on every save and again on publish. Length limits are the
    spoken-length limits of each age band, so a line is never too long for the child who gets it.
    """
    from apps.ai.limits import MAX_SPOKEN_LENGTH_BY_AGE_BAND

    if not isinstance(body, dict):
        return ["$: must be a JSON object"]
    problems: list[str] = []
    unknown = set(body) - BODY_KEYS
    missing = BODY_KEYS - set(body)
    if unknown:
        problems.append(f"$: unknown keys {', '.join(sorted(unknown))}")
    if missing:
        problems.append(f"$: missing keys {', '.join(sorted(missing))}")
    if missing:
        return problems
    room = body["room"]
    if room != "ANY" and room not in castle_rooms.ROOM_IDS:
        problems.append(f"$.room: must be ANY or one of the castle rooms, not {room!r}")
    bands = body["bands"]
    if not (
        isinstance(bands, list)
        and bands
        and len(set(bands)) == len(bands)
        and all(b in BANDS for b in bands)
    ):
        problems.append("$.bands: must list one or more of SPROUT, PATHFINDER, EXPLORER")
        bands = []
    requires = body["requires"]
    if not isinstance(requires, list):
        problems.append("$.requires: must be a list")
    else:
        for index, condition in enumerate(requires):
            problems.extend(_condition_problems(index, condition, body["npcId"]))
    repeat = body["repeat"]
    if not (isinstance(repeat, dict) and set(repeat) == {"maxShows", "minVisitGap"}):
        problems.append("$.repeat: must have exactly maxShows and minVisitGap")
    else:
        shows, gap = repeat["maxShows"], repeat["minVisitGap"]
        if shows is not None and not (type(shows) is int and shows >= 1):
            problems.append("$.repeat.maxShows: must be empty or a whole number from 1")
        if not (type(gap) is int and gap >= 0):
            problems.append("$.repeat.minVisitGap: must be a whole number of visits from 0")
    if not (type(body["weight"]) is int and 1 <= body["weight"] <= 5):
        problems.append("$.weight: must be a whole number from 1 to 5")
    if body["npcId"] is not None and body["npcId"] not in NPC_IDS:
        problems.append(f"$.npcId: must be empty or one of {', '.join(sorted(NPC_IDS))}")
    visual = body["visual"]
    if not (isinstance(visual, dict) and set(visual) == {"kind"} and visual["kind"] in CUE_TAGS):
        problems.append(f"$.visual.kind: must be one of {', '.join(sorted(CUE_TAGS))}")
    if not isinstance(body["fallback"], bool):
        problems.append("$.fallback: must be true or false")
    elif body["fallback"] and (room == "ANY" or set(bands) != set(BANDS)):
        problems.append("$.fallback: a quiet default needs one room and all three age bands")
    lines = body["lines"]
    if not (isinstance(lines, dict) and set(lines) == set(bands)):
        problems.append("$.lines: must have authored lines for exactly the listed age bands")
    else:
        for band, items in lines.items():
            if not (isinstance(items, list) and items):
                problems.append(f"$.lines.{band}: needs at least one line")
                continue
            for index, line in enumerate(items):
                where = f"$.lines.{band}[{index}]"
                if not (isinstance(line, str) and line.strip()):
                    problems.append(f"{where}: must be text")
                elif len(line) > MAX_SPOKEN_LENGTH_BY_AGE_BAND[band]:
                    problems.append(
                        f"{where}: longer than {MAX_SPOKEN_LENGTH_BY_AGE_BAND[band]} characters"
                    )
                elif _PRESSURE.search(line):
                    problems.append(f"{where}: ambient lines never pressure or reward a child")
    return problems


def body_of(event: dict) -> dict:
    """An event dict (the seed's shape) as a revision body."""
    return {key: copy.deepcopy(event[key]) for key in BODY_KEYS}


def event_from_row(row: CastleEvent) -> dict:
    """A published row as the event dict the pure functions and the view use."""
    return {
        **copy.deepcopy(row.source),
        "status": "PUBLISHED",
        "version": row.published_revision.number if row.published_revision_id else 1,
        "secret": True,
    }


def catalog() -> tuple[dict, ...]:
    """The events the Director may choose from now.

    Published, active rows. Retired events are excluded. Only while no row has ever been
    published (a fresh database, before the first `import_castle_events`) is the seed served, so
    the castle never has an empty catalog by accident; once Django holds published events,
    retiring every one of them really does retire them (the room then shows the client's quiet
    default line).
    """
    published = CastleEvent.objects.filter(published_revision__isnull=False)
    if not published.exists():
        return SEED_CATALOG
    rows = published.filter(active=True).select_related("published_revision")
    return tuple(event_from_row(row) for row in rows.order_by("event_id"))


class SeedInvalid(ValueError):
    def __init__(self, event_id: str, problems: list[str]):
        super().__init__(f"{event_id}: {'; '.join(problems)}")
        self.problems = problems


def import_seed() -> dict[str, int]:
    """Import `castle_events.json` into Django, idempotently (ADR-047, ADR-065).

    - A new event becomes a row with the seed body as its first published version.
    - An event nobody has edited (export-owned) follows a changed seed with a new version.
    - An event an administrator edited (Django-owned) is never changed: a changed seed is kept
      as a draft for review, once. A retired event stays retired; a draft-only event is skipped.
    Safe to run any number of times.
    """
    from apps.catalog import authoring
    from apps.catalog.models import ContentAuthority, RevisionOrigin

    counts = {"created": 0, "updated": 0, "unchanged": 0, "drafted": 0, "skipped": 0}
    with transaction.atomic():
        for event in SEED_CATALOG:
            if event["status"] != "PUBLISHED":
                continue
            body = body_of(event)
            row = CastleEvent.objects.select_for_update().filter(event_id=event["id"]).first()
            if row is None:
                row = CastleEvent(event_id=event["id"], room=body["room"], source=body)
                problems = authoring.validate(row, body)
                if problems:
                    raise SeedInvalid(event["id"], problems)
                row.save()
                authoring.record_published(row, body, origin=RevisionOrigin.IMPORT)
                counts["created"] += 1
            elif row.published_revision_id is None:
                counts["skipped"] += 1  # an administrator's own draft-only event
            elif row.source == body:
                counts["unchanged"] += 1
            elif row.authority == ContentAuthority.DJANGO:
                if authoring.record_import_draft(row, body, None):
                    counts["drafted"] += 1
                else:
                    counts["unchanged"] += 1
            else:
                problems = authoring.validate(row, body)
                if problems:
                    raise SeedInvalid(event["id"], problems)
                authoring.kind_for(row).apply(row, body, problems)()
                authoring.record_published(row, body, origin=RevisionOrigin.IMPORT)
                counts["updated"] += 1
    return counts


def tag_for(event: dict) -> str:
    return CUE_TAGS[event["visual"]["kind"]]


def _holds(event: dict, state: dict) -> bool:
    conditions = state["conditions"]
    requires = event["requires"]
    if any(c.get("type") not in SUPPORTED_CONDITIONS for c in requires):
        return False
    context = npc_conditions.ConditionContext(
        age_band=state["ageBand"],
        world_changes=frozenset((c["place"], c["key"]) for c in conditions["worldChanges"]),
        quest_statuses=dict(conditions["questStatuses"]),
        relationship_level=(
            conditions["relationshipLevels"].get(event["npcId"]) if event["npcId"] else None
        ),
    )
    return npc_conditions.holds(requires, context)


def _by_weight_then_id(event: dict) -> tuple[int, str]:
    return (-event["weight"], event["id"])


def eligible_events(catalog, state: dict) -> list[dict]:
    """The events that may be shown now, best first (port of `eligibleEvents`).

    Filter order: published, band, room (or ANY), every condition, `maxShows`, `minVisitGap`.
    Sorted by weight descending then id ascending.
    """
    result = []
    for event in catalog:
        if event["status"] != "PUBLISHED":
            continue
        if state["ageBand"] not in event["bands"]:
            continue
        if event["room"] not in ("ANY", state["roomId"]):
            continue
        if not _holds(event, state):
            continue
        max_shows = event["repeat"]["maxShows"]
        if max_shows is not None and state["shownCounts"].get(event["id"], 0) >= max_shows:
            continue
        last = state["lastShownVisit"].get(event["id"])
        if last is not None and state["currentVisitIndex"] - last < event["repeat"]["minVisitGap"]:
            continue
        result.append(event)
    return sorted(result, key=_by_weight_then_id)


def default_event(catalog, state: dict) -> dict | None:
    """The best eligible event, else the room's fallback event, ignoring the repeat rules."""
    eligible = eligible_events(catalog, state)
    if eligible:
        return eligible[0]
    fallbacks = [
        event
        for event in catalog
        if event["fallback"]
        and event["status"] == "PUBLISHED"
        and event["room"] == state["roomId"]
        and state["ageBand"] in event["bands"]
    ]
    return min(fallbacks, key=_by_weight_then_id) if fallbacks else None


def lines_for(event: dict, band: str) -> list[str]:
    return list(event["lines"][band])


def turn_for(event: dict, band: str) -> dict:
    """The pipeline turn behind an event: authored lines, joined for the output-policy check."""
    return {
        "eventId": event["id"],
        "spokenText": " ".join(lines_for(event, band)),
        "safetyDisposition": "ALLOW",
    }


def public_event(event: dict, band: str) -> dict:
    """What a client may be told about an event: authored lines, NPC and ambient cue only."""
    return {
        "eventId": event["id"],
        "lines": lines_for(event, band),
        "npcId": event["npcId"],
        "visual": dict(event["visual"]),
    }


class UnknownRoom(ValueError):
    """The room is unknown or a secret not yet found. Deliberately says nothing about which."""


def check_room(child, room_id: str) -> None:
    """The same refusal as `castle_rooms.discover_room`: a secret stays secret."""
    if not castle_rooms.may_record(child, room_id):
        raise UnknownRoom(room_id)


@transaction.atomic
def register_visit(child, visit_id: uuid.UUID) -> int:
    """Count a new visit (a `visit_id` not seen last) and return the child's visit index."""
    state, _ = CastleVisitState.objects.select_for_update().get_or_create(child=child)
    if state.last_visit_id != visit_id:
        state.visit_count += 1
        state.last_visit_id = visit_id
        state.save(update_fields=["visit_count", "last_visit_id"])
    return state.visit_count


def build_state(child, room_id: str, visit_index: int) -> dict:
    """The eligibility state, read from this child's own rows. No identifiers, no text."""
    shown = list(
        CastleEventShown.objects.for_child(child).values_list(
            "event_id", "shown_count", "last_shown_visit"
        )
    )
    return {
        "ageBand": child.age_band,
        "roomId": room_id,
        "conditions": {
            "worldChanges": [
                {"place": place, "key": key} for place, key in sorted(world_change_pairs(child))
            ],
            "questStatuses": dict(
                QuestProgress.objects.for_child(child).values_list("quest__slug", "status")
            ),
            "relationshipLevels": dict(
                NpcRelationship.objects.for_child(child).values_list("npc_id", "relationship_level")
            ),
        },
        "shownCounts": {event_id: count for event_id, count, _ in shown},
        "lastShownVisit": {event_id: visit for event_id, _, visit in shown},
        "currentVisitIndex": visit_index,
    }


@transaction.atomic
def record_shown(child, event_id: str, visit_index: int) -> None:
    """The only write the Director makes: a display counter for the event that was shown."""
    CastleEventShown.objects.get_or_create(child=child, event_id=event_id)
    CastleEventShown.objects.for_child(child).filter(event_id=event_id).update(
        shown_count=F("shown_count") + 1, last_shown_visit=visit_index
    )
