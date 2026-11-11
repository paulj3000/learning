"""Keeper Quill as NPC Manager content (LAI-NPC-039, Storykeeper's Castle).

Keeper Quill's lines in Storykeeper's Castle used to come only from the client: the catalog
dialogue in `react/src/features/npc/content/islandNpcs.ts` (shown by `NpcConversation.tsx`) and
the tale's own narrative steps (`theStorykeepersTale.ts`). They are authored here as NPC Manager
rows, so staff can edit, validate and publish Quill like Pirate Pip, and `seed_npc_quill` applies
them (create-only, never overwriting a row staff changed). The rows reuse the same character,
variant, behaviour, placement and dialogue models as Pip; nothing here is castle-specific
infrastructure.

What stays where it was:

- Identity is the canonical `catalog.NpcDefinition` `keeper-quill` (ADR-033); this module never
  creates or edits it. The content export is unchanged.
- The castle has no 3D Area in Django (no `regions.WorldRegion`): it is the Place
  `storykeeper-castle`, so Quill's placement is Place-level (`area` null) and the client asks the
  Place route.
- The castle's adventures (The Storykeeper's Tale, the secret door story), their steps, hints,
  world changes and quest progress stay with the Adventure Engine and the Quest Engine. Nothing
  here grants, unlocks or completes anything: the only choice actions used are `NONE`, `END` and
  `OFFER_QUEST` (accepting stays the child's own tap, through the castle's existing quest flow).

Wording: migrated lines keep the client's exact words (marked "legacy" below). Triggers that had
no line before (a return visit) get short new lines. All copy is readable aloud and has no em
dash.
"""

from __future__ import annotations

import math

from .pip_content import Choice, Dialogue, Node
from .vocabulary import BehaviorType, NpcRole

NPC_ID = "keeper-quill"
#: The manifest NPC in the castle (`manifests/storykeeperCastle.ts`); the managed placement
#: stands on its spot and the client hands it over.
LEGACY_ENTITY_ID = "keeper-quill"
PLACEMENT_KEY = "castle-quill"
PLACE_SLUG = "storykeeper-castle"
MODEL_ASSET_ID = "npc-quill"
VARIANT_KEY = "storykeeper"
BEHAVIOR_KEY = "quill-story-hall"
#: Where the castle stands Quill today (`KEEPER_QUILL_SPOT` in `storykeeperCastleRegion.ts`,
#: facing the entry hall: `QUILL_FACING_ENTRY_YAW`).
SPOT = (-4.5, 0.0, -math.pi / 2)
INTERACTION_RADIUS = 2.5
#: The voice the speech seeds give Quill (`seed_speech_voices`), reused when it exists.
VOICE_PROFILE_ID = "keeper-quill"
#: Quill's quest in the catalog; offered (never started) by the mission dialogue.
QUEST_ID = "tell-a-story-together"
QUEST_AGE_BANDS = ["PATHFINDER", "EXPLORER"]

#: Runtime state to clip, limited to clips the model really has (Idle, Talk, Wave, Point,
#: Celebrate, ReactConcerned). `sad` is Quill's concerned look after a wrong order (beat 6).
ANIMATION_MAP = {
    "idle": "Idle",
    "talk": "Talk",
    "wave": "Wave",
    "point": "Point",
    "celebrate": "Celebrate",
    "sad": "ReactConcerned",
}

ROLE = NpcRole.STORYTELLER
PERSONALITY = {
    "traits": ["gentle", "wise", "encouraging"],
    "tone": "calm",
    "catchphrases": ["Every story needs your ideas."],
}

#: Quill stands at his lectern and never follows (the castle's own rule), turns to the child, and
#: reacts to the tale like the legacy room did (beat 8: he celebrates when the story is told).
BEHAVIOR = {
    "display_name": "Quill in the story hall",
    "type": BehaviorType.STATIONARY,
    "parameters": {
        "facePlayer": True,
        "reactions": {
            "adventure.started": "wave",
            "adventure.resumed": "wave",
            "answer.incorrect": "sad",
            "adventure.completed": "celebrate",
        },
    },
}

#: The behaviours Quill must have in a release, and the triggers that carry each one.
REQUIRED_BEHAVIOURS: dict[str, tuple[str, ...]] = {
    "greet": ("on_interact",),
    "story": ("on_interact",),
    "return_visit": ("on_return_visit",),
    "story_told": ("on_adventure_complete",),
    "fallback": ("on_interact",),
}

_LEGACY_GREETING = (
    "Welcome to the castle library. Every story here is missing one thing: your ideas."
)
_LEGACY_STORY_RULES = (
    "Every good story needs three things: a hero, a problem to solve, and a happy ending."
)


def _for_storytellers() -> dict:
    return {"type": "AGE_BAND", "in": list(QUEST_AGE_BANDS)}


def dialogues() -> tuple[Dialogue, ...]:
    """Quill's dialogues."""
    return (
        Dialogue(
            "greeting-story-offer",
            "First meeting, with the story quest",
            "on_interact",
            (
                Node(
                    "welcome",
                    _LEGACY_GREETING,  # legacy quill-greeting
                    animation="wave",
                    choices=(
                        # legacy quill-greeting-bye
                        Choice("ideas", "I have lots of ideas!", next="ask"),
                    ),
                ),
                Node(
                    "ask",
                    # legacy meet-keeper-quill (the tale's first step), its second half
                    "Today's page is empty. Will you help me tell a brand new tale?",
                    emotion="curious",
                    animation="talk",
                    choices=(
                        Choice(
                            "yes",
                            "Yes, I will help!",  # legacy accept button
                            next="thanks",
                            action="OFFER_QUEST",
                            value=QUEST_ID,
                        ),
                        Choice("visiting", "I am just visiting.", action="END"),  # legacy
                    ),
                ),
                Node(
                    "thanks",
                    "Thank you! Walk into the story hall when you are ready to begin.",
                    emotion="excited",
                    animation="point",
                ),
            ),
            priority=30,
            conditions=(_for_storytellers(),),
            once_per_child=True,
            behaviour="greet",
        ),
        Dialogue(
            "greeting",
            "First meeting",
            "on_interact",
            (
                Node(
                    "welcome",
                    _LEGACY_GREETING,  # legacy quill-greeting
                    animation="wave",
                    choices=(Choice("ideas", "I have lots of ideas!", action="END"),),  # legacy
                ),
            ),
            priority=20,
            # Sprouts: the tale's quest is not for their band, so they get the greeting alone.
            conditions=({"type": "AGE_BAND", "in": ["SPROUT"]},),
            once_per_child=True,
            behaviour="greet",
        ),
        Dialogue(
            "story-rules",
            "What every story needs",
            "on_interact",
            (
                Node(
                    "rules",
                    _LEGACY_STORY_RULES,  # legacy keeper-explains-rules, its first sentence
                    emotion="curious",
                    animation="talk",
                ),
            ),
            priority=10,
            conditions=(_for_storytellers(),),
            behaviour="story",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("welcome", _LEGACY_GREETING, animation="wave"),),  # legacy quill-greeting
            priority=0,
            behaviour="fallback",
        ),
        Dialogue(
            "welcome-back",
            "A returning storyteller",
            "on_return_visit",
            (
                Node(
                    "again",
                    "Welcome back to the castle library. Your story is waiting for you.",
                    animation="wave",
                ),
            ),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
        Dialogue(
            "story-told",
            "The tale is told",
            "on_adventure_complete",
            (
                Node(
                    "on-the-shelf",
                    # legacy quill-returning-author, its first sentence
                    "The story you made is on my shelf now.",
                    emotion="proud",
                    animation="celebrate",
                ),
            ),
            behaviour="story_told",
        ),
    )
