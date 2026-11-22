"""Ember visits Storykeeper's Castle (SC-R05-02) as NPC Manager content.

Ember is one character everywhere. Her identity stays the canonical `catalog.NpcDefinition`
`ember-dragon` (ADR-033): this module never creates or edits it, and there is no second Ember.
Her sanctuary lines stay where they are (the client catalog in
`react/src/features/npc/content/islandNpcs.ts`, the legacy conversation), word for word.

What this adds is a castle visit:

- **One placement, Place-level, gated.** `castle-ember` stands her beside the Story Hall hearth
  (the castle has no 3D Area in Django, so `region` is null). Her `spawn_conditions` read only
  authoritative progress: the Ember Mountain story is finished
(`DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`),
  the Great Storybook is whole (`GREAT_STORYBOOK_RESTORED`, written by every band's Storybook
  quest), and the child has met her before (`RETURN_VISIT`: an `NpcRelationship` with Ember, which
  her sanctuary conversation records). A child who has not done all three never sees her here.
- **Castle-only lines.** The dialogues below are new and castle-themed ("I smelled a story").
  Django serves them only where it places her, and the castle is the only place it does. A future
  sanctuary placement would need its own dialogues chosen by place, which this module does not
  author.
- **The same body.** Her variant uses `npc-pip`, the stand-in the sanctuary manifest already
  gives her (ADR-028), so she looks the same in both places until her dragon rig replaces it.
- **No new state.** Talking uses only the NPC Manager's conversation state; no new flag, table or
  quest. Nothing here grants, unlocks or completes anything: the only choice action is `END`.

All copy is readable aloud and has no em dash.
"""

from __future__ import annotations

import math

from .pip_content import Choice, Dialogue, Node
from .vocabulary import BehaviorType, NpcRole

NPC_ID = "ember-dragon"
PLACEMENT_KEY = "castle-ember"
PLACE_SLUG = "storykeeper-castle"
MODEL_ASSET_ID = "npc-pip"
VARIANT_KEY = "sanctuary-stand-in"
VARIANT_NAME = "Ember (sanctuary stand-in)"
BEHAVIOR_KEY = "ember-castle-hearth"
#: Beside the Story Hall hearth, facing the hall (`EMBER_CASTLE_SPOT` and
#: `EMBER_FACING_HALL_YAW` in `storykeeperCastleRegion.ts`; the mirror test checks the spot).
SPOT = (2.1, -4.9, math.atan2(-3 - 2.1, 0 + 4.9))
INTERACTION_RADIUS = 2.5
#: Quill's placement keeps sort order 0, so a play line with no NPC near still goes to Quill.
SORT_ORDER = 20

#: The world change the Ember Mountain story writes, and the one the Storybook quests write.
EMBER_STORY_KEY = "DRAGON_OF_EMBER_MOUNTAIN_COMPLETE"
STORYBOOK_RESTORED_KEY = "GREAT_STORYBOOK_RESTORED"

SPAWN_CONDITIONS = [
    {"type": "WORLD_CHANGE", "key": EMBER_STORY_KEY, "present": True},
    {"type": "WORLD_CHANGE", "key": STORYBOOK_RESTORED_KEY, "place": PLACE_SLUG, "present": True},
    {"type": "RETURN_VISIT"},
]

#: Limited to clips the stand-in has (Idle, Talk, Wave); the rest fall back.
ANIMATION_MAP = {"idle": "Idle", "talk": "Talk", "wave": "Wave"}

ROLE = NpcRole.INTERACTIVE
PERSONALITY = {
    "traits": ["warm", "grateful", "curious"],
    "tone": "gentle",
    "catchphrases": ["I remember you."],
}

#: She stays curled by the fire (no WANDER until SC-R08's flybys), turns to the child, and reacts
#: to a story like Quill does. `celebrate` falls back to her Wave clip.
BEHAVIOR = {
    "display_name": "Ember by the castle hearth",
    "type": BehaviorType.STATIONARY,
    "parameters": {
        "facePlayer": True,
        "reactions": {
            "adventure.started": "wave",
            "adventure.resumed": "wave",
            "adventure.completed": "celebrate",
        },
    },
}

REQUIRED_BEHAVIOURS: dict[str, tuple[str, ...]] = {
    "greet": ("on_interact",),
    "fallback": ("on_interact",),
}

#: The castle visit line (the prep's wording), and its Sprout and Explorer versions.
CASTLE_VISIT_LINE = "I smelled a story. May I curl up by your fire?"
CASTLE_VISIT_LINES: dict[str, str] = {
    "SPROUT": "I smelled a story! May I stay by the fire?",
    "PATHFINDER": CASTLE_VISIT_LINE,
    "EXPLORER": (
        "I smelled a story from all the way across the island. "
        "May I curl up by your fire and listen while Quill reads?"
    ),
}


def _visit(band: str) -> Dialogue:
    return Dialogue(
        f"castle-visit-{band.lower()}",
        f"A visit to the castle ({band.title()})",
        "on_interact",
        (
            Node(
                "visit",
                CASTLE_VISIT_LINES[band],
                emotion="happy",
                animation="wave",
                choices=(
                    Choice("stay", "Yes, stay warm!", action="END"),
                    Choice("hello", "Hello, Ember!", action="END"),
                ),
            ),
        ),
        priority=10,
        conditions=({"type": "AGE_BAND", "in": [band]},),
        behaviour="greet",
    )


def dialogues() -> tuple[Dialogue, ...]:
    """Ember's castle dialogues: one per age band, and a condition-free fallback."""
    return (
        *(_visit(band) for band in ("SPROUT", "PATHFINDER", "EXPLORER")),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("visit", CASTLE_VISIT_LINE, emotion="happy", animation="talk"),),
            priority=0,
            behaviour="fallback",
        ),
    )
