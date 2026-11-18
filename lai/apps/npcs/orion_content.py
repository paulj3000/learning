"""Professor Orion as NPC Manager content (SC-R05-03, owner approved), Storykeeper's Castle.

Orion is the Setting Tower's star-watcher: a supporting character with no quest, who talks about
the stars, the chart and the child's story. He mirrors Keeper Quill's module (`quill_content.py`)
and reuses the same character, variant, behaviour, placement and dialogue models; nothing here is
castle-specific infrastructure.

- Identity is the canonical `catalog.NpcDefinition` `professor-orion` from the content export
  (`ISLAND_NPCS` in `react/src/features/npc/content/islandNpcs.ts`); this module never creates or
  edits it.
- The placement is Place-level (`region` null) on the spot the castle manifest stands him
  (`PROFESSOR_ORION_SPOT` in `storykeeperCastleRegion.ts`; the mirror test checks it). The prep's
  spot (9.1, 5.9) is where SC-JMP's second star stone now stands, so the stone moved 0.25 m west
  and Orion stands in the corner behind it.
- The model is the `npc-professor-ticktock` stand-in (Idle, Walk, Wave) until a commissioned
  `npc-professor-orion` replaces it (owner TODO).
- Age bands: the client catalog has no age-band condition, so its lines are the Pathfinder ones.
  Here each first meeting and each look through the telescope comes in three versions (Sprouts:
  one short sentence; Pathfinders: the client's words exactly; Explorers: planets and
  constellations).
- He never marks an answer wrong. He asks the child to count the chart's gold stars, and the only
  reply is "I counted them!", which he praises. Nothing here grants, unlocks or completes
  anything: the only choice action is `END`.

Copy is readable aloud and has no em dash.
"""

from __future__ import annotations

import math

from .pip_content import Choice, Dialogue, Node
from .vocabulary import BehaviorType, NpcRole

NPC_ID = "professor-orion"
LEGACY_ENTITY_ID = "professor-orion"
PLACEMENT_KEY = "castle-orion"
PLACE_SLUG = "storykeeper-castle"
MODEL_ASSET_ID = "npc-professor-ticktock"
VARIANT_KEY = "stand-in"
VARIANT_NAME = "Professor Orion (stand-in)"
BEHAVIOR_KEY = "orion-setting-tower"
#: (x, z, yaw): facing the middle of the tower (its safe spot at 7.5, 7.5).
SPOT = (9.5, 5.8, math.atan2(7.5 - 9.5, 7.5 - 5.8))
INTERACTION_RADIUS = 2.5
#: Quill's placement keeps sort order 0, so a play line with no NPC near still goes to Quill.
SORT_ORDER = 10
SPAWN_CONDITIONS: list[dict] = []

#: Limited to the stand-in's clips (Idle, Walk, Wave); talk and the rest fall back to idle.
ANIMATION_MAP = {"idle": "Idle", "wave": "Wave"}

ROLE = NpcRole.TEACHER
PERSONALITY = {
    "traits": ["curious", "patient", "kind"],
    "tone": "calm",
    "catchphrases": ["Every star has a story."],
}

BEHAVIOR = {
    "display_name": "Orion in the Setting Tower",
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
    "return_visit": ("on_return_visit",),
    "fallback": ("on_interact",),
}

#: SC-R04-01 and the Tale's world changes Orion reads (Quill's memory flags are Quill's own).
STORYBOOK_RESTORED_KEY = "GREAT_STORYBOOK_RESTORED"
FIRST_STORY_TOLD_KEY = "FIRST_STORY_TOLD"

#: The client catalog lines these dialogues carry word for word, by client node id
#: (`test_castle_npc_mirror.py` reads the client file).
LEGACY_LINES: dict[str, str] = {
    "orion-storybook-restored": (
        "The Great Storybook is whole again! Even the stars look brighter tonight. "
        "Thank you for bringing its pages home."
    ),
    "orion-story-told": "Your story has its own star now. Shall we find the one that fits it?",
    "orion-returning": (
        "Welcome back, star friend. Can you count the gold stars on my chart? Take your time."
    ),
    "orion-greeting": (
        "Hello there! I am Professor Orion. I watch the stars from this tower, "
        "and every star has a story."
    ),
    "orion-telescope": (
        "Through my telescope I see tiny lights, far, far away. "
        "People join the stars with lines to make pictures in the sky."
    ),
    "orion-counting-praise": (
        "Wonderful counting! Stars are easier to count when friends look together."
    ),
}

BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")

GREETING_LINES: dict[str, str] = {
    "SPROUT": "Hello! I am Professor Orion, and I love the stars.",
    "PATHFINDER": LEGACY_LINES["orion-greeting"],
    "EXPLORER": (
        "Hello there! I am Professor Orion. Tonight I can see the planet Jupiter, "
        "and the seven stars of the Great Bear. Every star has a story."
    ),
}

TELESCOPE_LINES: dict[str, str] = {
    "SPROUT": "I see tiny lights, far, far away.",
    "PATHFINDER": LEGACY_LINES["orion-telescope"],
    "EXPLORER": (
        "Through my telescope I can see the rings of Saturn. People join the stars with lines "
        "to make pictures called constellations, like Orion the Hunter. I was named after him."
    ),
}


def _band(band: str) -> dict:
    return {"type": "AGE_BAND", "in": [band]}


def _world_change(key: str) -> dict:
    return {"type": "WORLD_CHANGE", "key": key, "place": PLACE_SLUG, "present": True}


def _telescope(band: str) -> Node:
    return Node(
        "telescope",
        TELESCOPE_LINES[band],
        emotion="curious",
        animation="talk",
        choices=(Choice("look", "I will look for pictures!", action="END"),),  # legacy
    )


def _greeting(band: str) -> Dialogue:
    return Dialogue(
        f"greeting-{band.lower()}",
        f"First meeting ({band.title()})",
        "on_interact",
        (
            Node(
                "hello",
                GREETING_LINES[band],
                emotion="happy",
                animation="wave",
                choices=(
                    Choice("ask", "What do you see?", next="telescope"),  # legacy
                    Choice("hello", "Hello, Professor!", action="END"),  # legacy
                ),
            ),
            _telescope(band),
        ),
        priority=35,
        conditions=(_band(band),),
        once_per_child=True,
        behaviour="greet",
    )


def dialogues() -> tuple[Dialogue, ...]:
    """Orion's dialogues, most specific first."""
    return (
        Dialogue(
            "storybook-restored",
            "The Great Storybook is whole",
            "on_interact",
            (
                Node(
                    "brighter",
                    LEGACY_LINES["orion-storybook-restored"],
                    emotion="proud",
                    animation="wave",
                    choices=(Choice("welcome", "You are welcome!", action="END"),),  # legacy
                ),
            ),
            priority=40,
            conditions=(_world_change(STORYBOOK_RESTORED_KEY),),
            once_per_child=True,
            behaviour="greet",
        ),
        *(_greeting(band) for band in BANDS),
        Dialogue(
            "story-told",
            "Your story has a star",
            "on_interact",
            (
                Node(
                    "its-own-star",
                    LEGACY_LINES["orion-story-told"],
                    emotion="excited",
                    animation="talk",
                    choices=(
                        Choice("look", "Yes, let us look!", next="telescope"),  # legacy
                        Choice("later", "Maybe next time.", action="END"),  # legacy
                    ),
                ),
                _telescope("PATHFINDER"),
            ),
            priority=20,
            conditions=(_world_change(FIRST_STORY_TOLD_KEY),),
            once_per_child=True,
            behaviour="greet",
        ),
        Dialogue(
            "count-the-stars",
            "Counting the chart's stars",
            "on_interact",
            (
                Node(
                    "count",
                    LEGACY_LINES["orion-returning"],
                    emotion="curious",
                    animation="talk",
                    choices=(
                        # There is nothing to get wrong: every count is praised.
                        Choice("counted", "I counted them!", next="praise"),  # legacy
                        Choice("later", "Not right now.", action="END"),  # legacy
                    ),
                ),
                Node(
                    "praise",
                    LEGACY_LINES["orion-counting-praise"],
                    emotion="proud",
                    animation="wave",
                    choices=(Choice("thanks", "Thank you, Professor!", action="END"),),  # legacy
                ),
            ),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="greet",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (
                Node(
                    "hello",
                    LEGACY_LINES["orion-greeting"],
                    emotion="happy",
                    animation="wave",
                ),
            ),
            priority=0,
            behaviour="fallback",
        ),
        Dialogue(
            "welcome-back",
            "A returning stargazer",
            "on_return_visit",
            (
                Node(
                    "again",
                    "Welcome back to the tower. The stars waited for you.",
                    emotion="happy",
                    animation="wave",
                ),
            ),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
    )
