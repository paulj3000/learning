"""Ambient return-visit events for Storykeeper Castle (SC-R08-01, SC-R09-01).

**An event is atmosphere, never progress.** It is authored words and an ambient cue; showing one
grants nothing and writes nothing but a display counter (`CastleEventShown`), so the same moment
is not shown on every visit. There is no reward, quest, world change or session write here.

**Repetition is counted in visits, never in time.** `CastleVisitState` counts the child's
separate castle visits (one per new client `visitId`). There is no clock, streak, countdown or
"come back" pressure anywhere: waiting never changes what is eligible and being away is never
penalised.

The catalog is `castle_events.json`, which mirrors the client's `CASTLE_EVENTS`
(`react/src/features/great-storybook/castleEvents.ts`); a Vitest test fails if they differ.
`eligible_events` and `default_event` are pure ports of the TypeScript functions of the same
names, held together by the shared golden vectors (`tests/golden/castle-events.json`). They take
and return plain JSON-shaped dicts, with the state in the client's camelCase, so a vector is one
object on both sides. Conditions are the NPC Manager's (`apps.npcs.conditions.holds`), limited to
the types the contract allows; an unknown type never holds (fail closed).
"""

import json
import uuid
from pathlib import Path

from django.db import transaction
from django.db.models import F

from apps.npcs import conditions as npc_conditions
from apps.progression.models import NpcRelationship
from apps.progression.services import world_change_pairs
from apps.quests.models import QuestProgress

from . import castle_rooms
from .models import CastleEventShown, CastleVisitState

_DATA = json.loads((Path(__file__).parent / "castle_events.json").read_text(encoding="utf-8"))

CATALOG: tuple[dict, ...] = tuple(_DATA["events"])

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
