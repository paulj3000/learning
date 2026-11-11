"""The NPC Manager's closed vocabularies (ADR-054, contract version 1).

Every name here is part of the frozen shared contract (`docs/NPC_MANAGER_CONTRACTS.md`). The
TypeScript mirror is `react/src/features/npc-manager/contracts/vocabulary.ts`, and
`apps/npcs/tests/test_contract_mirror.py` fails when the two drift. Add a value only by a
contract change recorded in that document; never rename one.
"""

from django.db import models

#: Bumped only by a breaking change to the published release format or the runtime API.
CONTRACT_VERSION = 1
#: The `schemaVersion` of a published release snapshot.
SNAPSHOT_SCHEMA_VERSION = 1


class NpcRole(models.TextChoices):
    GUIDE = "GUIDE", "Guide"
    COMPANION = "COMPANION", "Companion"
    QUEST_GIVER = "QUEST_GIVER", "Quest giver"
    STORYTELLER = "STORYTELLER", "Storyteller"
    TEACHER = "TEACHER", "Teacher"
    MERCHANT = "MERCHANT", "Merchant"
    INTERACTIVE = "INTERACTIVE", "Interactive"
    AMBIENT = "AMBIENT", "Ambient"


class CharacterStatus(models.TextChoices):
    """Authoring status. Only READY characters go into a release; children never see DRAFT."""

    DRAFT = "DRAFT", "Draft"
    READY = "READY", "Ready to publish"
    RETIRED = "RETIRED", "Retired"


class DialogueMode(models.TextChoices):
    """ADR-054 item 7. AUTHORED never calls a model; HYBRID adds AI hints and lines around
    authored nodes; AI lets a persona voice a line. None of them changes gameplay state."""

    AUTHORED = "AUTHORED", "Authored only"
    HYBRID = "HYBRID", "Authored with AI hints"
    AI = "AI", "AI persona lines"


#: Runtime animation states. A model variant maps each to one of its real clip names.
ANIMATION_STATES = (
    "idle",
    "walk",
    "run",
    "talk",
    "wave",
    "point",
    "celebrate",
    "think",
    "sad",
    "laugh",
    "jump",
)
#: Which states loop; the rest are one-shot and return to the behaviour's base state.
LOOPING_ANIMATION_STATES = frozenset({"idle", "walk", "run", "talk", "think"})
#: When a variant has no clip for a state, the runtime tries these in order, then "idle".
ANIMATION_FALLBACKS: dict[str, tuple[str, ...]] = {
    "idle": (),
    "walk": ("idle",),
    "run": ("walk", "idle"),
    "talk": ("idle",),
    "wave": ("talk", "idle"),
    "point": ("wave", "talk", "idle"),
    "celebrate": ("laugh", "wave", "jump", "idle"),
    "think": ("idle",),
    "sad": ("idle",),
    "laugh": ("celebrate", "talk", "idle"),
    "jump": ("celebrate", "idle"),
}

#: Interaction triggers (LAI-NPC-013). Each maps to an existing gameplay signal (contracts doc).
TRIGGERS = (
    "on_spawn",
    "on_player_near",
    "on_interact",
    "on_adventure_start",
    "on_challenge_start",
    "on_correct_answer",
    "on_incorrect_answer",
    "on_treasure_found",
    "on_quest_complete",
    "on_adventure_complete",
    "on_return_visit",
)


class Trigger(models.TextChoices):
    ON_SPAWN = "on_spawn", "Spawned"
    ON_PLAYER_NEAR = "on_player_near", "Player comes near"
    ON_INTERACT = "on_interact", "Child taps or talks"
    ON_ADVENTURE_START = "on_adventure_start", "Adventure starts"
    ON_CHALLENGE_START = "on_challenge_start", "Challenge starts"
    ON_CORRECT_ANSWER = "on_correct_answer", "Correct answer"
    ON_INCORRECT_ANSWER = "on_incorrect_answer", "Answer not right yet"
    ON_TREASURE_FOUND = "on_treasure_found", "Treasure found"
    ON_QUEST_COMPLETE = "on_quest_complete", "Quest complete"
    ON_ADVENTURE_COMPLETE = "on_adventure_complete", "Adventure complete"
    ON_RETURN_VISIT = "on_return_visit", "Returning visit"


#: Adventure events the runtime reacts to (behaviour reactions, LAI-NPC-023). They are emitted by
#: the client from *server outcomes* it already received; they never cause a server write.
ADVENTURE_EVENTS = (
    "adventure.started",
    "adventure.resumed",
    "challenge.started",
    "answer.correct",
    "answer.incorrect",
    "treasure.found",
    "quest.completed",
    "adventure.completed",
)

#: Dialogue lifecycle events the runtime emits (React and engine both listen).
DIALOGUE_EVENTS = (
    "dialogue.started",
    "dialogue.node_entered",
    "dialogue.choice_made",
    "dialogue.ended",
    "dialogue.interrupted",
)


class Emotion(models.TextChoices):
    NEUTRAL = "neutral", "Neutral"
    HAPPY = "happy", "Happy"
    EXCITED = "excited", "Excited"
    CURIOUS = "curious", "Curious"
    THINKING = "thinking", "Thinking"
    SAD = "sad", "Sad"
    SURPRISED = "surprised", "Surprised"
    PROUD = "proud", "Proud"


class ChoiceAction(models.TextChoices):
    """The only things a dialogue choice may do (LAI-NPC-012). None of them awards, unlocks or
    completes anything: quests are accepted through the quests API by the child's own tap, and
    flags set here are NPC-local (`NpcConversationState.local_flags`), never quest memory flags.
    """

    NONE = "NONE", "Continue"
    END = "END", "End the conversation"
    SET_LOCAL_FLAG = "SET_LOCAL_FLAG", "Remember something (NPC only)"
    OFFER_QUEST = "OFFER_QUEST", "Show a quest offer"
    REQUEST_HINT = "REQUEST_HINT", "Ask for a hint"


class BehaviorType(models.TextChoices):
    STATIONARY = "stationary", "Stationary"
    WANDER = "wander", "Wander"
    PATROL = "patrol", "Patrol"
    FOLLOW = "follow", "Follow the player"
    GUIDE = "guide", "Guide the player"
    REACTIVE = "reactive", "Reactive"
    SCRIPTED = "scripted", "Scripted"


class ReleaseStatus(models.TextChoices):
    """ACTIVE: served to children (at most one). SUPERSEDED: was active, can be rolled back to.
    RETIRED: withdrawn for good; never served again."""

    ACTIVE = "ACTIVE", "Active"
    SUPERSEDED = "SUPERSEDED", "Superseded"
    RETIRED = "RETIRED", "Retired"


class VariantAssetRole(models.TextChoices):
    TEXTURE = "TEXTURE", "Texture"
    ACCESSORY = "ACCESSORY", "Accessory"
    PORTRAIT = "PORTRAIT", "Alternate portrait"
    AUDIO = "AUDIO", "Audio"


#: Condition types shared by placement spawn conditions, variant availability, dialogue and
#: choices (`apps.npcs.conditions`).
CONDITION_TYPES = (
    "ALWAYS",
    "AGE_BAND",
    "WORLD_CHANGE",
    "QUEST_STATUS",
    "FIRST_VISIT",
    "RETURN_VISIT",
    "LOCAL_FLAG",
    "RELATIONSHIP_AT_LEAST",
)

#: Stable API error codes (`{"error": {"code", "message"}}`, the project's error shape).
ERROR_CODES = (
    "npc_not_found",
    "no_active_release",
    "place_not_found",
    "area_not_found",
    "dialogue_unavailable",
    "conversation_not_found",
    "conversation_ended",
    "invalid_choice",
    "invalid_trigger",
    "ai_unavailable",
    "rate_limited",
)
