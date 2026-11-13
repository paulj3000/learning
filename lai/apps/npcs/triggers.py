"""The interaction trigger registry (LAI-NPC-013, contract v1 section 4).

Every trigger names an *existing* gameplay signal. The client reports the trigger after it has
seen that signal (an engine event or a play API outcome it already received); the server only
selects dialogue for it. A trigger never causes a progress write: rewards, quest completion,
world changes and relationship points stay with `game_sessions.play`, `quests`, `progression`
and `inventory`.

The React side of the same mapping is `react/src/features/npc-manager/dialogue/triggers.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass

from .vocabulary import TRIGGERS


@dataclass(frozen=True)
class TriggerSource:
    """Where a trigger comes from. `kind` is "engine" (an NPC engine event) or "play" (a play API
    outcome the client already has)."""

    kind: str
    signal: str
    note: str


TRIGGER_SOURCES: dict[str, TriggerSource] = {
    "on_spawn": TriggerSource("engine", "npc.loaded", "The NPC's model (or placeholder) loaded."),
    "on_player_near": TriggerSource(
        "engine",
        "npc.approached",
        "The player entered the interaction radius (also WorldEngineEventBus NpcApproached).",
    ),
    "on_interact": TriggerSource(
        "engine",
        "npc.interact_requested",
        "The child tapped, clicked, pressed Enter or Space, or touched the NPC.",
    ),
    "on_adventure_start": TriggerSource(
        "play", "POST regions/<id>/session/ -> 201", "A new region session was created."
    ),
    "on_return_visit": TriggerSource(
        "play",
        "POST regions/<id>/session/ -> 200",
        "An existing session was resumed, or the child already has a relationship with the NPC.",
    ),
    "on_challenge_start": TriggerSource(
        "play",
        "POST sessions/<id>/chests/<entity>/challenge/",
        "A chest challenge was issued (new or the outstanding one).",
    ),
    "on_correct_answer": TriggerSource(
        "play", "POST attempts/<id>/answer/ correct=true", "The server graded the answer correct."
    ),
    "on_incorrect_answer": TriggerSource(
        "play",
        "POST attempts/<id>/answer/ correct=false",
        "The server graded the answer not right yet.",
    ),
    "on_treasure_found": TriggerSource(
        "play",
        "answer outcome chestOpened or newItems; pickups/ newItems",
        "A chest opened or new items arrived, as the server reported.",
    ),
    "on_quest_complete": TriggerSource(
        "play",
        "any outcome questUpdates[].justCompleted",
        "The server reported a quest completed by this outcome.",
    ),
    "on_adventure_complete": TriggerSource(
        "play",
        "world change TREASURE_COVE_QUEST_COMPLETE / session complete",
        "The adventure's completion world change exists, or the session was completed.",
    ),
}


class InvalidTrigger(ValueError):
    code = "invalid_trigger"


def validate_trigger(value: object) -> str:
    """The trigger, if it is one of `TRIGGERS`; otherwise `InvalidTrigger`."""
    if isinstance(value, str) and value in TRIGGER_SOURCES:
        return value
    raise InvalidTrigger(value)


if set(TRIGGER_SOURCES) != set(TRIGGERS):  # the registry must document every frozen trigger
    raise ImportError("apps.npcs.triggers.TRIGGER_SOURCES does not match vocabulary.TRIGGERS")
