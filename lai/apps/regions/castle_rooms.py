"""Which rooms of Storykeeper Castle a child has discovered (SC-R03-06).

The castle's layout is still a TypeScript manifest (ADR-033: spatial layout is not
Django-administered until LAI-0805), so this module owns only what the server must *decide*:
which room ids it will record, and when a secret room may be recorded. The ids live in
`castle_rooms.json`, shared with the client's `CASTLE_ROOM_IDS`; a Vitest test fails if the two
differ.

A discovery is an ordinary `WorldChange` (`ROOM_DISCOVERED`, key `castle-room:<id>`), written
through the existing idempotent `record_world_change`. No new model: the canonical progression
backbone already stores a durable, child-scoped, append-only fact, and ADR-033 forbids a second
one for a single feature.

**A secret stays secret.** A secret room is recorded only once the discovery it names is on the
child's `WorldState`. Asking to record a secret room too early gives exactly the answer asking to
record a room that does not exist gives (`UnknownRoom`, which the view turns into the same 404),
so the endpoint can never be used to find out that a secret exists.
"""

import json
from pathlib import Path

from apps.progression.models import WorldChange, WorldState
from apps.progression.services import record_world_change

_DATA = json.loads((Path(__file__).parent / "castle_rooms.json").read_text(encoding="utf-8"))

LOCATION_SLUG: str = _DATA["locationSlug"]
CHANGE_TYPE: str = _DATA["changeType"]
ROOM_IDS: tuple[str, ...] = tuple(_DATA["rooms"])
#: room id -> the discovery id a child must have before the room may be recorded.
SECRET_ROOMS: dict[str, str] = dict(_DATA["secretRooms"])

KEY_PREFIX = "castle-room:"
SOURCE = "exploration:castle-room"


class UnknownRoom(ValueError):
    """The room is not one the server will record for this child. Deliberately says nothing
    about *why* (unknown, or a secret not yet found), so the two cannot be told apart."""


def change_key(room_id: str) -> str:
    return f"{KEY_PREFIX}{room_id}"


def _found(child) -> set[str]:
    state = WorldState.objects.for_child(child).first()
    return set(state.discovered_objects) if state else set()


def _may_record(child, room_id: str) -> bool:
    if room_id not in ROOM_IDS:
        return False
    needed = SECRET_ROOMS.get(room_id)
    return needed is None or needed in _found(child)


def discovered_rooms(child) -> list[str]:
    """The room ids this child has discovered, in the castle's own order.

    Reads only this child's rows. A secret room that somehow has a row but whose discovery is
    not on the child's world state is left out: the list never names a secret the child cannot
    know about.
    """
    keys = set(
        WorldChange.objects.for_child(child)
        .filter(location_slug=LOCATION_SLUG, change_type=CHANGE_TYPE)
        .values_list("change_key", flat=True)
    )
    return [
        room_id
        for room_id in ROOM_IDS
        if change_key(room_id) in keys and _may_record(child, room_id)
    ]


def discover_room(child, room_id: str, *, now=None) -> bool:
    """Record that this child has been in `room_id`. True if this was the first time.

    Idempotent and safe under concurrency (the unique constraint decides). Raises `UnknownRoom`
    for an unknown room and for a secret room whose discovery the child has not made.
    """
    if not _may_record(child, room_id):
        raise UnknownRoom(room_id)
    _, created = record_world_change(
        child,
        location_slug=LOCATION_SLUG,
        change_type=CHANGE_TYPE,
        change_key=change_key(room_id),
        source_session_id=SOURCE,
        now=now,
    )
    return created
