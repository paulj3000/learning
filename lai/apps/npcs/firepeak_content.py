"""The Heart of Firepeak NPCs as NPC Manager content (FPV, `docs/firepeak/FIREPEAK_NPCS.md`).

Five characters: Flint, Kindle, Professor Basalt, Cinder and Ignis. Their identity is the
canonical `catalog.NpcDefinition` (ADR-033, ADR-054 item 1) that the content export creates;
this module never creates or edits it. `seed_npc_firepeak` applies the rows below create-only,
so staff edits in Django Admin survive a rerun.

Nothing here grants, unlocks or completes anything. Choice actions used are `NONE`, `END` and
`REQUEST_HINT` (Kindle only, hybrid mode). Puzzle intros, answers and rewards stay with the
puzzle engine; these lines are the friendly baseline around them.

Copy rules: readable aloud, no em dash, no question about the child's name, address, school or
other private details, no secrets, never claims to be human. Anything magical is called island
magic; Professor Basalt starts science from real facts ("Real volcanoes ...").
"""

from __future__ import annotations

from dataclasses import dataclass

from .pip_content import Choice, Dialogue, Node
from .vocabulary import BehaviorType, NpcRole

REGION_ID = "firepeak-heart"
PLACE_SLUG = "firepeak-heart"
AGE_BANDS = ["PATHFINDER", "EXPLORER"]
VARIANT_KEY = "classic"
INTERACTION_RADIUS = 2.5

#: The clips the stand-in declares until a real GLB is uploaded (then the version's clips rule).
CLIPS = ("Idle", "Walk", "Talk", "Wave", "Point", "Celebrate", "ReactHappy", "ReactConcerned")
#: Runtime state to clip. `laugh` is the happy reaction and `sad` the concerned one. Other states
#: (run, think, jump ...) fall back through `ANIMATION_FALLBACKS`.
ANIMATION_MAP = {
    "idle": "Idle",
    "walk": "Walk",
    "talk": "Talk",
    "wave": "Wave",
    "point": "Point",
    "celebrate": "Celebrate",
    "laugh": "ReactHappy",
    "sad": "ReactConcerned",
}

_REACTIONS = {
    "adventure.started": "wave",
    "adventure.resumed": "wave",
    "answer.correct": "laugh",
    "answer.incorrect": "sad",
    "quest.completed": "celebrate",
    "adventure.completed": "celebrate",
}

KINDLE_TOPIC = "patterns and counting in Emberwood Forest"


@dataclass(frozen=True)
class Spot:
    key: str
    behavior: str
    x: float
    z: float
    yaw: float  # radians; the route runs +z to -z so facing +z (0) looks back at the child


@dataclass(frozen=True)
class FirepeakNpc:
    npc_id: str
    name: str
    role: str
    zone: str
    asset_id: str
    behaviors: dict  # key -> {display_name, type, parameters}
    spots: tuple[Spot, ...]
    personality: dict
    ai_mode: str  # "AUTHORED" or "HYBRID"
    voice: tuple[str, str, int]  # Polly voice, engine, speaking rate percent
    persona_prompt: str
    persona_topics: tuple[str, ...]
    fallback_lines: tuple[str, ...]
    greeting_explorer: str
    greeting_pathfinder: str
    return_line: str
    fallback_line: str
    farewell: str
    max_response_chars: int = 140


def _stationary(key: str, name: str, **extra) -> dict:
    return {
        key: {
            "display_name": name,
            "type": BehaviorType.STATIONARY,
            "parameters": {"facePlayer": True, "reactions": dict(_REACTIONS), **extra},
        }
    }


_PERSONA_RULES = (
    " You are an AI-powered island character, never a person. Never ask for private "
    "information such as names, addresses, schools or photos. Never ask for secrets. Never "
    "give the puzzle answer. Use simple, warm, calm words and one or two short sentences."
)

NPCS: tuple[FirepeakNpc, ...] = (
    FirepeakNpc(
        npc_id="flint",
        name="Flint",
        role=NpcRole.GUIDE,
        zone="Explorer's Landing",
        asset_id="firepeak-npc-flint",
        # A guide needs authored waypoints, which belong to the area layout; until staff add them
        # Flint waits at the landing and turns to the child.
        behaviors=_stationary("flint-landing", "Flint at Explorer's Landing"),
        spots=(Spot("fh-flint", "flint-landing", 3.0, 84.0, 0.0),),
        personality={
            "traits": ["friendly", "brave", "encouraging"],
            "tone": "warm",
            "catchphrases": ["Let us explore!"],
        },
        ai_mode="AUTHORED",
        voice=("Matthew", "neural", 100),
        persona_prompt=(
            "Flint is a friendly explorer who welcomes children to the Firepeak mountain and "
            "teaches them how to move and look at the map." + _PERSONA_RULES
        ),
        persona_topics=("exploring the mountain", "reading the map", "moving and jumping"),
        fallback_lines=("Use the map and take your time.", "Walk, look and jump over small logs."),
        greeting_explorer=(
            "Welcome to Firepeak! I am Flint, an explorer. The Heart of the mountain has gone "
            "dim, and we need to help it glow again. Read the map sign first, then follow the path."
        ),
        greeting_pathfinder=(
            "Hello, explorer! I am Flint. Let us help the mountain Heart glow again. "
            "Look at the map sign first."
        ),
        return_line="Welcome back! The path is waiting for you.",
        fallback_line="Hello! Let us explore Firepeak together.",
        farewell="Great! Follow the path when you are ready.",
    ),
    FirepeakNpc(
        npc_id="kindle",
        name="Kindle",
        role=NpcRole.COMPANION,
        zone="Emberwood Forest and the Heart Chamber",
        asset_id="firepeak-npc-kindle",
        behaviors={
            **{
                "kindle-follow": {
                    "display_name": "Kindle follows in the forest",
                    "type": BehaviorType.FOLLOW,
                    "parameters": {
                        "stopDistance": 2.5,
                        "speed": 2.2,
                        "giveUpDistance": 25,
                        "boundsRadius": 14,
                        "reactions": dict(_REACTIONS),
                    },
                }
            },
            **_stationary("kindle-heart", "Kindle at the Heart"),
        },
        spots=(
            Spot("fh-kindle", "kindle-follow", -3.0, 58.0, 0.0),
            Spot("fh-kindle-heart", "kindle-heart", -4.0, -84.0, 0.0),
        ),
        personality={
            "traits": ["playful", "curious", "kind"],
            "tone": "cheerful",
            "catchphrases": ["Spark!"],
        },
        ai_mode="HYBRID",
        voice=("Ivy", "neural", 108),
        persona_prompt=(
            "Kindle is a small, friendly fire spirit made of island magic. Kindle gives one "
            "short, gentle hint about patterns and counting in Emberwood Forest." + _PERSONA_RULES
        ),
        persona_topics=(KINDLE_TOPIC, "being a fire spirit of island magic"),
        fallback_lines=(
            "Look for what repeats. What comes next?",
            "Touch each one and count out loud.",
        ),
        greeting_explorer=(
            "Spark! I am Kindle, a little fire spirit made of island magic. I can give you a "
            "hint whenever a puzzle feels tricky. Just ask."
        ),
        greeting_pathfinder="Spark! I am Kindle, a little fire spirit. Ask me for a hint any time!",
        return_line="Spark! You are back. Shall we look for more crystals?",
        fallback_line="Spark! I am Kindle. I am here to help.",
        farewell="Hooray! Let us keep going.",
        max_response_chars=120,
    ),
    FirepeakNpc(
        npc_id="professor-basalt",
        name="Professor Basalt",
        role=NpcRole.TEACHER,
        zone="Crystal Caverns and Firepeak Summit",
        asset_id="firepeak-npc-basalt",
        behaviors=_stationary("basalt-stands", "Professor Basalt at work"),
        spots=(
            Spot("fh-basalt", "basalt-stands", 4.0, -8.0, 0.0),
            Spot("fh-basalt-summit", "basalt-stands", 4.0, -62.0, 0.0),
        ),
        personality={
            "traits": ["thoughtful", "patient", "curious"],
            "tone": "calm",
            "catchphrases": ["Real volcanoes are amazing."],
        },
        ai_mode="AUTHORED",
        voice=("Kevin", "neural", 96),
        persona_prompt=(
            "Professor Basalt is a calm volcano scientist. Facts start with 'Real volcanoes'. "
            "Anything magical is called island magic." + _PERSONA_RULES
        ),
        persona_topics=("real volcano science", "rocks and crystals", "how islands form"),
        fallback_lines=(
            "Real volcanoes make new rock when hot lava cools.",
            "Look closely at the rocks and shapes.",
        ),
        greeting_explorer=(
            "Hello! I am Professor Basalt. Real volcanoes push hot melted rock, called lava, "
            "up from deep inside the Earth. When it cools it becomes new rock. Let us look at "
            "the crystals together."
        ),
        greeting_pathfinder=(
            "Hello! I am Professor Basalt. Real volcanoes make new rock when lava cools. "
            "Let us look at the shapes here."
        ),
        return_line="Welcome back! There is more to discover about rocks.",
        fallback_line="Hello! I love to study rocks and volcanoes.",
        farewell="Wonderful looking! Keep exploring.",
    ),
    FirepeakNpc(
        npc_id="cinder",
        name="Cinder",
        role=NpcRole.QUEST_GIVER,
        zone="Ancient Forge",
        asset_id="firepeak-npc-cinder",
        behaviors=_stationary("cinder-forge", "Cinder at the Ancient Forge"),
        spots=(Spot("fh-cinder", "cinder-forge", -4.0, -34.0, 0.0),),
        personality={
            "traits": ["wise", "patient", "hardworking"],
            "tone": "warm",
            "catchphrases": ["One step at a time."],
        },
        ai_mode="AUTHORED",
        voice=("Stephen", "neural", 92),
        persona_prompt=(
            "Cinder is the old keeper of the Ancient Forge, patient and kind, who likes "
            "order and steps." + _PERSONA_RULES
        ),
        persona_topics=("the Ancient Forge", "putting steps in order", "switches and paths"),
        fallback_lines=("Try one step at a time.", "Follow the path, switch by switch."),
        greeting_explorer=(
            "Welcome to the Ancient Forge. I am Cinder, the keeper. The old machines have "
            "stopped. Flip the switches in the right order and the forge will wake up."
        ),
        greeting_pathfinder=(
            "Welcome! I am Cinder. The old forge needs help. Try the switches one step at a time."
        ),
        return_line="Welcome back to the forge. Shall we try again?",
        fallback_line="Hello! I look after the Ancient Forge.",
        farewell="Good work. The forge thanks you.",
    ),
    FirepeakNpc(
        npc_id="ignis",
        name="Ignis",
        role=NpcRole.GUIDE,
        zone="Heart Chamber",
        asset_id="firepeak-npc-ignis",
        behaviors=_stationary("ignis-heart", "Ignis at the Heart"),
        spots=(Spot("fh-ignis", "ignis-heart", 0.0, -90.0, 0.0),),
        personality={
            "traits": ["gentle", "calm", "grateful"],
            "tone": "soft",
            "catchphrases": ["The Heart remembers."],
        },
        ai_mode="AUTHORED",
        voice=("Ruth", "neural", 92),
        persona_prompt=(
            "Ignis is the gentle guardian of the Heart of Firepeak, an island magic crystal. "
            "Ignis is calm and thankful." + _PERSONA_RULES
        ),
        persona_topics=("the Heart of Firepeak", "the crystals and their journey"),
        fallback_lines=("Think about the journey you took.", "Take your time. The Heart is patient."),
        greeting_explorer=(
            "You came a long way. I am Ignis, guardian of the Heart. Set the crystals in the "
            "order of your journey, and the Heart will glow again."
        ),
        greeting_pathfinder=(
            "You made it! I am Ignis. Put the crystals in the order of your journey. "
            "Then the Heart will glow."
        ),
        return_line="Welcome back. The Heart is glad to see you.",
        fallback_line="Hello. I guard the Heart of Firepeak.",
        farewell="Thank you. The mountain is calm now.",
    ),
)

NPC_IDS = tuple(npc.npc_id for npc in NPCS)

#: Behaviours every character must have in a release, and the triggers that carry each one.
REQUIRED_BEHAVIOURS: dict[str, tuple[str, ...]] = {
    "greet": ("on_interact",),
    "return_visit": ("on_return_visit",),
    "fallback": ("on_interact",),
}


def _age(band: str) -> tuple[dict, ...]:
    return ({"type": "AGE_BAND", "in": [band]},)


def dialogues(npc: FirepeakNpc) -> tuple[Dialogue, ...]:
    """One character's dialogues: age-banded greetings, a return visit, an authored fallback."""
    kindle = npc.npc_id == "kindle"

    def greeting(band: str, text: str) -> Dialogue:
        if kindle:
            nodes = (
                Node(
                    "welcome",
                    text,
                    emotion="excited",
                    animation="wave",
                    choices=(
                        Choice("hint", "Can I have a hint?", next="hint", action="REQUEST_HINT"),
                        Choice("thanks", "Thanks, Kindle", action="END"),
                    ),
                ),
                _kindle_hint_node(),
            )
        else:
            nodes = (
                Node(
                    "welcome",
                    text,
                    emotion="happy",
                    animation="wave",
                    choices=(Choice("ok", "Okay!", next="bye"),),
                ),
                Node("bye", npc.farewell, emotion="happy", animation="point"),
            )
        return Dialogue(
            f"greeting-{band.lower()}",
            f"Greeting for {band.title()}s",
            "on_interact",
            nodes,
            priority=20,
            conditions=_age(band),
            behaviour="greet",
        )

    result = [
        greeting("EXPLORER", npc.greeting_explorer),
        greeting("PATHFINDER", npc.greeting_pathfinder),
        Dialogue(
            "welcome-back",
            "A returning explorer",
            "on_return_visit",
            (Node("again", npc.return_line, animation="wave"),),
            priority=10,
            conditions=({"type": "RETURN_VISIT"},),
            behaviour="return_visit",
        ),
        Dialogue(
            "fallback",
            "Anything else",
            "on_interact",
            (Node("hello", npc.fallback_line, animation="wave"),),
            priority=0,
            behaviour="fallback",
        ),
    ]
    if kindle:
        result.append(
            Dialogue(
                "hint-wrong-answer",
                "Hint after a wrong answer",
                "on_incorrect_answer",
                (
                    Node(
                        "try-again",
                        "Not quite yet. Let us try again!",
                        emotion="thinking",
                        animation="think",
                        choices=(
                            Choice("help-me", "Help me", next="hint", action="REQUEST_HINT"),
                            Choice("thanks", "Thanks, Kindle", action="END"),
                        ),
                    ),
                    _kindle_hint_node(),
                ),
                behaviour="hint",
            )
        )
    return tuple(result)


def _kindle_hint_node() -> Node:
    """The only node that may ask the AI for a hint. The authored text is the fallback."""
    return Node(
        "hint",
        "Look for what repeats. What comes next?",
        emotion="thinking",
        animation="talk",
        allow_ai_hint=True,
        allowed_topic=KINDLE_TOPIC,
    )
