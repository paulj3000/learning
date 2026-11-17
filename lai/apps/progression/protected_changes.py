"""Protected world-change keys: facts only the server may record (storybook integrity, section B).

A page of the Great Storybook, a quest's BUILD objective and many branches match a world change on
its key. If the generic `POST world-changes/` accepted any key, a client could write
`FIRST_STORY_TOLD` and restore a page without playing. So a key that *proves* progress is
**protected**: the generic write refuses it unless it is backed by a finished producer the child
really played (`record_client_world_change`), and a protected row at the wrong place never counts
(`world_change_keys`).

The registry is derived, never hand-listed, from data the server already trusts:

- every world-change key a Great Storybook page names (`great_storybook_pages.json`);
- every key the quests, stories and discoveries of the digest-verified content export record
  (those are written by Django when it accepts a quest state, a chapter or a discovery, and no
  client flow posts them), which includes `GREAT_STORYBOOK_RESTORED*`;
- the castle's room discoveries (`castle-room:<id>`, `castle_rooms.json`).

A key an *adventure* records that is not a page key (for example `BRIDGE_REPAIRED`) is **not**
protected, because the island's own runtime legitimately posts those (a placed plank, a repaired
lighthouse). Adventures stay the only producers of protected adventure keys: the producer is the
adventure template slug and the step that writes the change.

This module imports no model, so the progression service can use it without an import cycle.
"""

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from apps.catalog.importer import read_export

_REGIONS = Path(__file__).resolve().parent.parent / "regions"

ADVENTURE = "adventure"
STORY = "story"
#: Written only by a server path that has no client-submittable proof (a quest completion, a
#: discovery, a castle room). The generic POST always refuses these.
SERVER_ONLY = "server"

#: Keys that are protected by name even if the export did not list them.
PROTECTED_PREFIXES = ("GREAT_STORYBOOK_RESTORED", "castle-room:")


@dataclass(frozen=True)
class Producer:
    kind: str  # ADVENTURE | STORY | SERVER_ONLY
    slug: str  # adventure template slug, story slug, or the server path's label
    step_id: str = ""  # ADVENTURE: the step that records the change


@dataclass(frozen=True)
class ProtectedKey:
    key: str
    location_slug: str
    change_type: str
    producers: tuple[Producer, ...]

    @property
    def client_writable(self) -> bool:
        return any(p.kind in (ADVENTURE, STORY) for p in self.producers)


def _json(name: str) -> dict:
    return json.loads((_REGIONS / name).read_text(encoding="utf-8"))


def page_sources() -> list[dict]:
    """The WORLD_CHANGE sources of every Great Storybook page."""
    return [
        page["source"]
        for page in _json("great_storybook_pages.json")["pages"]
        if page["source"]["kind"] == "WORLD_CHANGE"
    ]


def _export_producers() -> dict[tuple[str, str], tuple[str, list[Producer]]]:
    """(location, key) -> (change type, producers), from the content export."""
    found: dict[tuple[str, str], tuple[str, list[Producer]]] = {}

    def add(change: dict, producer: Producer) -> None:
        entry = found.setdefault(
            (change["locationSlug"], change["changeKey"]), (change["changeType"], [])
        )
        if producer not in entry[1]:
            entry[1].append(producer)

    collections = read_export().collections
    for adventure in collections.get("adventures", []):
        for step in adventure.get("steps", []):
            presentation = step.get("presentation") or {}
            if presentation.get("kind") == "world-change" and isinstance(
                presentation.get("payload"), dict
            ):
                add(presentation["payload"], Producer(ADVENTURE, adventure["slug"], step["id"]))
    for story in collections.get("stories", []):
        if isinstance(story.get("completionWorldChange"), dict):
            add(story["completionWorldChange"], Producer(STORY, story["slug"]))
    for quest in collections.get("quests", []):
        changes = [c for stage in quest.get("stages", []) for c in stage.get("worldChanges", [])]
        changes += (quest.get("completion") or {}).get("worldChanges", []) or []
        for change in changes:
            add(change, Producer(SERVER_ONLY, f"quest:{quest['id']}"))
    for discovery in collections.get("discoveries", []):
        if isinstance(discovery.get("worldChange"), dict):
            add(discovery["worldChange"], Producer(SERVER_ONLY, f"discovery:{discovery['id']}"))
    return found


@lru_cache(maxsize=1)
def registry() -> dict[str, ProtectedKey]:
    """Protected change key -> its definition."""
    produced = _export_producers()
    by_key: dict[str, list[tuple[str, str, list[Producer]]]] = {}
    for (location, key), (change_type, producers) in produced.items():
        by_key.setdefault(key, []).append((location, change_type, producers))

    protected: dict[str, ProtectedKey] = {}

    def protect(key: str, location: str, change_type: str, producers: list[Producer]) -> None:
        protected[key] = ProtectedKey(key, location, change_type, tuple(producers))

    # Page keys: protected whatever produces them.
    for source in page_sources():
        key, location = source["changeKey"], source["locationSlug"]
        match = next((m for m in by_key.get(key, []) if m[0] == location), None)
        protect(key, location, match[1] if match else "CREATE", match[2] if match else [])
    # Keys only the server records (quest, discovery, story completions); never an adventure's.
    for key, entries in by_key.items():
        if key in protected:
            continue
        for location, change_type, producers in entries:
            if not any(p.kind == ADVENTURE for p in producers) or key.startswith(
                PROTECTED_PREFIXES
            ):
                protect(key, location, change_type, producers)
    # Castle rooms.
    rooms = _json("castle_rooms.json")
    for room_id in rooms["rooms"]:
        key = f"castle-room:{room_id}"
        protect(
            key,
            rooms["locationSlug"],
            rooms["changeType"],
            [Producer(SERVER_ONLY, "castle-rooms")],
        )
    return protected


def is_protected(key: str) -> bool:
    return key in registry() or key.startswith(PROTECTED_PREFIXES)


def lookup(key: str) -> ProtectedKey | None:
    return registry().get(key)


def is_misplaced(location_slug: str, key: str) -> bool:
    """True for a protected key recorded at a location other than the one it belongs to. A blank
    location (a legacy import) is accepted, never rejected."""
    entry = registry().get(key)
    return entry is not None and location_slug not in ("", entry.location_slug)
