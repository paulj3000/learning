"""The Great Storybook on the server (SC-R04-02): which pages a child has back.

**A page is derived, never stored.** Each page names a record the castle's existing,
server-validated content already writes: a world change a finished adventure or story records,
or the nook discovery (`progression.discoveries`). So there is no page table: a page is back
exactly when its record exists, it cannot be recovered twice, a different challenge cannot
restore it, and nothing here grants or records anything. Asking is read-only.

The pages are in `great_storybook_pages.json`, which mirrors the client's `STORYBOOK_PAGES`
(`react/src/features/great-storybook/pages.ts`); a Vitest test fails if the two differ.

Age is the child's own band on their profile, read here and never taken from the request.
Each band's book is whole when *its required pages* are back. The hidden nook page is a bonus in
every band and is **listed only once it is restored**: a slot for a secret the child has not found
would be a signpost.
"""

import json
from pathlib import Path

from apps.progression.models import WorldState
from apps.progression.services import world_change_keys
from apps.quests.models import QuestProgress

_DATA = json.loads((Path(__file__).parent / "great_storybook_pages.json").read_text("utf-8"))

PAGES: tuple[dict, ...] = tuple(_DATA["pages"])
#: age band -> the slug of that band's Great Storybook quest.
QUEST_SLUGS: dict[str, str] = dict(_DATA["quests"])

NOT_STARTED = "NOT_STARTED"


def pages_for_band(band: str) -> list[dict]:
    return [page for page in PAGES if band in page["bands"]]


def _restored(page: dict, *, changes: set[str], found: set[str]) -> bool:
    source = page["source"]
    if source["kind"] == "WORLD_CHANGE":
        return source["changeKey"] in changes
    return source["discoveryId"] in found


def progress(child) -> dict:
    """This child's Storybook, from the server's own records. Read-only."""
    band = child.age_band
    state = WorldState.objects.for_child(child).first()
    found = set(state.discovered_objects) if state else set()
    changes = set(world_change_keys(child))
    entries = [
        (page, _restored(page, changes=changes, found=found)) for page in pages_for_band(band)
    ]
    required = [(page, restored) for page, restored in entries if page["required"]]
    restored_required = sum(1 for _, restored in required if restored)
    quest_slug = QUEST_SLUGS.get(band)
    quest = (
        QuestProgress.objects.for_child(child).filter(quest__slug=quest_slug).first()
        if quest_slug
        else None
    )
    return {
        "band": band,
        # A bonus page is shown only once found, never as an empty slot.
        "pages": [
            {
                "id": page["id"],
                "title": page["title"],
                "required": page["required"],
                "restored": restored,
                "roomId": page["roomId"],
                "text": page["restoredText"] if restored else page["hint"],
            }
            for page, restored in entries
            if page["required"] or restored
        ],
        "restoredRequired": restored_required,
        "totalRequired": len(required),
        "restoredBonus": sum(1 for page, restored in entries if restored and not page["required"]),
        "complete": bool(required) and restored_required == len(required),
        "quest": {"questId": quest_slug, "status": quest.status if quest else NOT_STARTED},
    }
