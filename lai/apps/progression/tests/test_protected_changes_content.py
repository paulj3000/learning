"""The protected-key registry against the real content (no database).

Every page has a producer, and a protected key is written by one place only, so the same key can
never be written at two locations or by an unregistered producer."""

import json
from collections import defaultdict
from pathlib import Path

from apps.catalog.importer import read_export
from apps.progression import protected_changes as protected

ROOT = Path(__file__).resolve().parents[4]


def _pages() -> list[dict]:
    return json.loads((ROOT / "lai/apps/regions/great_storybook_pages.json").read_text())["pages"]


def test_every_world_change_page_source_has_a_client_writable_producer():
    for page in _pages():
        source = page["source"]
        if source["kind"] != "WORLD_CHANGE":
            continue
        entry = protected.lookup(source["changeKey"])
        assert entry is not None, page["id"]
        assert entry.location_slug == source["locationSlug"], page["id"]
        assert entry.client_writable, f"{page['id']} has no adventure or story producer"


def test_the_great_storybook_restored_keys_are_protected_and_server_only():
    quests = read_export().collections["quests"]
    keys = {
        c["changeKey"]
        for q in quests
        for c in (q.get("completion") or {}).get("worldChanges", []) or []
        if c["changeKey"].startswith("GREAT_STORYBOOK_RESTORED")
    }
    assert keys
    for key in keys:
        assert protected.lookup(key) is not None and not protected.lookup(key).client_writable
    assert protected.is_protected("GREAT_STORYBOOK_RESTORED_V2")


def test_a_protected_key_has_one_location_and_one_type_across_all_producers():
    seen: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for (location, key), (change_type, _) in protected._export_producers().items():
        if protected.is_protected(key):
            seen[key].add((location, change_type))
    clashes = {key: places for key, places in seen.items() if len(places) > 1}
    assert not clashes, f"a protected key is produced at two places: {clashes}"


def test_protected_keys_are_unique_across_page_producers():
    keys = [p["source"]["changeKey"] for p in _pages() if p["source"]["kind"] == "WORLD_CHANGE"]
    assert len(keys) == len(set(keys))  # one page per key
    producers = {key: {(p.kind, p.slug) for p in protected.lookup(key).producers} for key in keys}
    for key, mine in producers.items():
        for other, theirs in producers.items():
            if other != key:
                assert not mine & theirs, (key, other)


def test_adventure_producers_name_a_real_world_change_step():
    adventures = {a["slug"]: a for a in read_export().collections["adventures"]}
    for entry in protected.registry().values():
        for producer in entry.producers:
            if producer.kind != protected.ADVENTURE:
                continue
            steps = adventures[producer.slug]["steps"]
            step = next(s for s in steps if s["id"] == producer.step_id)
            assert step["presentation"]["payload"]["changeKey"] == entry.key
