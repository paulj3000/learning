"""Pirate Pip as NPC Manager content (LAI-NPC-018, LAI-NPC-010).

The lines Pip says in Treasure Cove used to be hard-coded in the React client (`PLAY_COPY` in
`react/src/features/region-play/regionPlayUi.ts` and `PipDialog.tsx`). They are authored here as
NPC Manager rows instead, so staff can edit, validate and publish them like any other character,
and `seed_npc_pip` applies them (create-only, never overwriting a row staff changed).

What stays where it was:

- Identity is the canonical `catalog.NpcDefinition` `pirate-pip` (ADR-033); this module never
  creates or edits it. The content export is unchanged.
- Chest clues stay chest content (`TreasureChest.clue`), shown by the chest panel and the Hint
  button. Quest steps stay the quest's; rewards, quest completion and world changes stay with the
  play services. Nothing here grants, unlocks or completes anything: the only choice actions used
  are `NONE`, `END`, `OFFER_QUEST` (accepting is the child's own tap through the quests API) and,
  in hybrid mode only, `REQUEST_HINT`.

Wording: migrated lines keep the client's exact words (marked "legacy" below). Triggers that had
no line before (a first greeting, a return visit, a find, a hint) get short new lines. All copy is
readable aloud and has no em dash.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from apps.regions.pips_treasure_seed import PIPS_QUEST_ID, QUEST_COMPLETE_KEY
from apps.regions.treasure_rush_seed import REGION_ID

from .vocabulary import BehaviorType, NpcRole

NPC_ID = "pirate-pip"
#: The legacy manifest NPC in Treasure Cove; the managed placement stands on its spot.
LEGACY_ENTITY_ID = "cove-pip"
PLACEMENT_KEY = "cove-pip"
AREA_ID = REGION_ID
PLACE_SLUG = "pirate-builder-bay"
MODEL_ASSET_ID = "npc-pip"
VARIANT_KEY = "classic"
BEHAVIOR_KEY = "pip-landing"
#: Where the legacy seed put Pip (`treasure_rush_seed`), used only if that placement is missing.
DEFAULT_SPOT = (3.0, 6.0, 0.0)
INTERACTION_RADIUS = 2.5

#: Runtime state to clip. Limited to the clips the model really has (Idle, Talk, Wave); every
#: other state falls back through `ANIMATION_FALLBACKS` (celebrate -> wave, think -> idle).
ANIMATION_MAP = {"idle": "Idle", "talk": "Talk", "wave": "Wave"}

#: The owner's rigged pirate (2026-11-07): a second Pip variant on its own Django-authored asset,
#: so the shared `npc-pip` placeholder other worlds use is unchanged. One Mixamo character with
#: four actions renamed from the clip vocabulary (re-export of the QA report's section 4).
#: `add_pip_pirate_variant` uploads `PIRATE_MODEL_FILE` through the Asset Library services.
PIRATE_ASSET_ID = "npc-pip-pirate"
PIRATE_VARIANT_KEY = "pirate"
PIRATE_MODEL_FILE = "content/models/npc-pip-pirate.glb"
PIRATE_CLIPS = ("Idle", "Walk", "Wave", "Point")
#: No Talk clip yet: talk falls back through `ANIMATION_FALLBACKS` (talk -> idle).
PIRATE_ANIMATION_MAP = {"idle": "Idle", "walk": "Walk", "wave": "Wave", "point": "Point"}
#: The model stands 0.94 m; the classic Pip is about 1.2 m with his hat.
PIRATE_SCALE = 1.25

ROLE = NpcRole.QUEST_GIVER
PERSONALITY = {
    "traits": ["cheerful", "kind", "curious"],
    "tone": "warm",
    "catchphrases": ["Ahoy!"],
}

#: Pip stands at his camp, turns to the child, and reacts to play like the legacy cove did
#: (TR-18: a wave for a find; here also a celebration, which falls back to his Wave clip).
BEHAVIOR = {
    "display_name": "Pip at Pirate Landing",
    "type": BehaviorType.STATIONARY,
    "parameters": {
        "facePlayer": True,
        "reactions": {
            "adventure.started": "wave",
            "adventure.resumed": "wave",
            "answer.correct": "wave",
            "answer.incorrect": "think",
            "treasure.found": "celebrate",
            "quest.completed": "celebrate",
            "adventure.completed": "celebrate",
        },
    },
}

#: Hybrid hints (optional, `seed_npc_pip --hybrid-hints`): an approved persona whose fallback
#: lines are used whenever AI is off, refused, slow or rate limited. The pipeline still checks
#: the parent's AI setting, the kill switch and every output.
HINT_TOPIC = "counting coins"
PERSONA = {
    "version": 1,
    "personality_prompt": (
        "Pirate Pip is a cheerful, kind pirate character in Treasure Cove on Learning Adventure "
        "Island. Pip helps young learners count coins to open treasure chests. Give one short, "
        "gentle counting hint in simple words. Never give the answer. Keep it warm and calm."
    ),
    "permitted_topics": [HINT_TOPIC, "finding treasure in the cove"],
    "max_response_chars": 120,
    "fallback_lines": [
        "Count slowly. Say one number for each coin.",
        "Touch each coin and count out loud.",
    ],
}


@dataclass(frozen=True)
class Choice:
    key: str
    label: str
    next: str | None = None
    action: str = "NONE"
    value: str = ""


@dataclass(frozen=True)
class Node:
    key: str
    text: str
    emotion: str = "happy"
    animation: str = ""
    next: str | None = None
    choices: tuple[Choice, ...] = ()
    allow_ai_hint: bool = False
    allowed_topic: str = ""


@dataclass(frozen=True)
class Dialogue:
    key: str
    title: str
    trigger: str
    nodes: tuple[Node, ...]
    priority: int = 0
    conditions: tuple[dict, ...] = ()
    once_per_child: bool = False
    #: The required behaviour this dialogue covers (the gate test reads it).
    behaviour: str = field(default="", compare=False)


def _quest(status: str) -> dict:
    return {"type": "QUEST_STATUS", "quest": PIPS_QUEST_ID, "status": status}


#: The six behaviours Pip must have in a release, and the triggers that carry each one.
REQUIRED_BEHAVIOURS: dict[str, tuple[str, ...]] = {
    "greet": ("on_spawn", "on_interact"),
    "mission": ("on_interact",),
    "hint": ("on_incorrect_answer", "on_challenge_start"),
    "treasure_found": ("on_treasure_found",),
    "complete": ("on_quest_complete", "on_adventure_complete"),
    "return_visit": ("on_return_visit",),
}


def _wrong_answer(hybrid: bool) -> Dialogue:
    if hybrid:
        nodes = (
            Node(
                "try-again",
                "Not quite. Let us try another one!",  # legacy PLAY_COPY.wrong, without the lock
                emotion="thinking",
                animation="think",
                choices=(
                    Choice("help-me", "Help me", next="hint", action="REQUEST_HINT"),
                    Choice("thanks", "Thanks, Pip", action="END"),
                ),
            ),
            Node(
                "hint",
                "Count slowly. Say one number for each coin.",  # legacy HINTS.COUNT[1]
                emotion="thinking",
                animation="talk",
                allow_ai_hint=True,
                allowed_topic=HINT_TOPIC,
            ),
        )
    else:
        nodes = (
            Node(
                "try-again",
                "Not quite. Let us try another one!",
                emotion="thinking",
                animation="think",
                next="hint",
            ),
            Node(
                "hint",
                "Count slowly. Say one number for each coin.",
                emotion="thinking",
                animation="talk",
            ),
        )
    return Dialogue(
        "hint-wrong-answer",
        "Hint after a wrong answer",
        "on_incorrect_answer",
        nodes,
        behaviour="hint",
    )


def dialogues(*, hybrid: bool = False) -> tuple[Dialogue, ...]:
    """Pip's dialogues. `hybrid` adds a REQUEST_HINT choice and an `allowAiHint` node."""
    return (
        Dialogue(
            "greet-first-visit",
            "First greeting at Pirate Landing",
            "on_spawn",
            (
                Node(
                    "hello",
                    "Ahoy, friend! Welcome to Pirate Landing. I am Pirate Pip.",
                    animation="wave",
                    next="come-talk",
                ),
                Node("come-talk", "Walk up to me and talk when you are ready.", animation="talk"),
            ),
            priority=10,
            conditions=({"type": "FIRST_VISIT"},),
            once_per_child=True,
            behaviour="greet",
        ),
        Dialogue(
            "treasure-complete",
            "After the treasure is found",
            "on_interact",
            (
                Node(
                    "thanks",
                    "You found the treasure! Thank you, friend.",  # legacy pipCompleted
                    emotion="proud",
                    animation="wave",
                ),
            ),
            priority=30,
            conditions=(_quest("COMPLETED"),),
            behaviour="complete",
        ),
        Dialogue(
            "treasure-active",
            "While the treasure hunt is on",
            "on_interact",
            (
                Node(
                    "waiting",
                    "The treasure is waiting for you.",  # legacy pipActive
                    animation="talk",
                    next="where",
                ),
                Node(
                    "where",
                    # legacy nextStepHint ('progress')
                    "Look for a treasure chest with a gold star over it. Walk close and use Open.",
                    emotion="curious",
                    animation="point",
                ),
            ),
            priority=20,
            conditions=(_quest("ACTIVE"),),
            behaviour="mission",
        ),
        Dialogue(
            "mission-offer",
            "Pip asks for help",
            "on_interact",
            (
                Node(
                    "ask",
                    # legacy: the quest summary, then PLAY_COPY.pipAsk
                    "Pip lost four treasures around the cove. Find them all and bring them back "
                    "to Pip! Will you help me?",
                    emotion="curious",
                    animation="talk",
                    choices=(
                        Choice(
                            "yes",
                            "Yes, I will help!",  # legacy pipAccept
                            next="thanks",
                            action="OFFER_QUEST",
                            value=PIPS_QUEST_ID,
                        ),
                        Choice("later", "Maybe later", action="END"),  # legacy pipLater
                    ),
                ),
                Node(
                    "thanks",
                    "Thank you, friend! The treasure is waiting for you.",
                    emotion="excited",
                    animation="wave",
                ),
            ),
            priority=10,
            conditions=(_quest("NOT_STARTED"),),
            behaviour="mission",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("ahoy", "Ahoy! Enjoy the cove.", animation="wave"),),  # legacy pipNoQuest
            priority=0,
            behaviour="greet",
        ),
        Dialogue(
            "welcome-back",
            "A returning player",
            "on_return_visit",
            (Node("again", "Ahoy again, friend! Welcome back to the cove.", animation="wave"),),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
        Dialogue(
            "hint-challenge",
            "A chest challenge begins",
            "on_challenge_start",
            (
                Node(
                    "take-your-time",
                    "Take your time. Touch each coin and count out loud.",  # legacy HINTS.COUNT[0]
                    emotion="thinking",
                    animation="think",
                ),
            ),
            behaviour="hint",
        ),
        _wrong_answer(hybrid),
        Dialogue(
            "great-counting",
            "A right answer",
            "on_correct_answer",
            (Node("great", "Great counting!", emotion="excited", animation="wave"),),  # legacy
            behaviour="hint",
        ),
        Dialogue(
            "treasure-found",
            "A treasure is found",
            "on_treasure_found",
            (
                Node(
                    "found",
                    "Arr, you found treasure! Keep going, friend.",
                    emotion="excited",
                    animation="celebrate",
                ),
            ),
            behaviour="treasure_found",
        ),
        Dialogue(
            "quest-complete",
            "Pip's Missing Treasure is complete",
            "on_quest_complete",
            (
                Node(
                    "all-found",
                    "You found all my treasure!",  # legacy finaleTitle
                    emotion="proud",
                    animation="celebrate",
                    next="thanks",
                ),
                Node(
                    "thanks",
                    "Thank you, friend! You are a true treasure hunter.",  # legacy finaleThanks
                    emotion="proud",
                    animation="wave",
                ),
            ),
            behaviour="complete",
        ),
        Dialogue(
            "bridge-open",
            "The way to Lookout Point opens",
            "on_adventure_complete",
            (
                Node(
                    "bridge",
                    # legacy PLAY_COPY.bridgeOpened
                    "The gate is open and the bridge is mended! Walk across to Lookout Point.",
                    emotion="excited",
                    animation="point",
                ),
            ),
            conditions=({"type": "WORLD_CHANGE", "key": QUEST_COMPLETE_KEY, "present": True},),
            behaviour="complete",
        ),
    )
