"""The controlled vocabulary for sound cues and assignments (SM-P2-02, SM-P2-04).

Nothing here is free text from a client or an administrator: channels, events and target types are
closed sets, and which events a target type can raise is a table. Adding one is a code change with
a migration check, never a data entry, and never an expression that is evaluated.

The channel names are the React Sound Manager's `AudioChannel` (`react/src/audio/AudioTypes.ts`).
"""

import re

from django.db import models


class Channel(models.TextChoices):
    MUSIC = "music", "Music"
    AMBIENT = "ambient", "Ambient"
    SFX = "sfx", "Sound effect"
    VOICE = "voice", "Voice"
    UI = "ui", "Interface"


class SoundEvent(models.TextChoices):
    ON_ENTER = "on_enter", "Enter"
    ON_EXIT = "on_exit", "Exit"
    ON_APPROACH = "on_approach", "Approach"
    ON_INTERACT = "on_interact", "Interact"
    ON_OPEN = "on_open", "Open"
    ON_CLOSE = "on_close", "Close"
    ON_COLLECT = "on_collect", "Collect"
    ON_SUCCESS = "on_success", "Success"
    ON_RETRY = "on_retry", "Retry"
    ON_COMPLETE = "on_complete", "Complete"
    ON_DIALOGUE_START = "on_dialogue_start", "Dialogue starts"


class TargetType(models.TextChoices):
    """What a sound is attached to. The id is that thing's existing stable content id."""

    SCOPE = "scope", "The Island, Place or 3D Area itself"
    ADVENTURE = "adventure", "Adventure"
    QUEST = "quest", "Quest"
    NPC = "npc", "NPC"
    OBJECT = "object", "Object in a 3D Area (prop, NPC placement, collectible, scenery)"
    CHEST = "chest", "Treasure chest in a 3D Area"
    REWARD = "reward", "Reward rule"


E = SoundEvent
EVENTS_BY_TARGET: dict[str, frozenset[str]] = {
    TargetType.SCOPE: frozenset({E.ON_ENTER, E.ON_EXIT}),
    TargetType.ADVENTURE: frozenset({E.ON_ENTER, E.ON_SUCCESS, E.ON_RETRY, E.ON_COMPLETE}),
    TargetType.QUEST: frozenset({E.ON_ENTER, E.ON_COMPLETE}),
    TargetType.NPC: frozenset({E.ON_APPROACH, E.ON_INTERACT, E.ON_DIALOGUE_START, E.ON_EXIT}),
    TargetType.OBJECT: frozenset({E.ON_APPROACH, E.ON_INTERACT, E.ON_COLLECT}),
    TargetType.CHEST: frozenset(
        {E.ON_APPROACH, E.ON_INTERACT, E.ON_OPEN, E.ON_CLOSE, E.ON_SUCCESS, E.ON_RETRY}
    ),
    TargetType.REWARD: frozenset({E.ON_COLLECT}),
}

# Object and chest ids are only unique inside one 3D Area, so these need an Area scope.
AREA_ONLY_TARGETS = frozenset({TargetType.OBJECT, TargetType.CHEST})


class Scope(models.TextChoices):
    GLOBAL = "global", "Everywhere"
    ISLAND = "island", "Island"
    PLACE = "place", "Place"
    AREA = "area", "3D Area"


# Specific beats general: for the same target and event, the deepest scope wins (see
# `docs/audio/PHASE_2_ASSET_INTEGRATION.md`, "Assignment resolution").
SCOPE_DEPTH = {Scope.GLOBAL: 0, Scope.ISLAND: 1, Scope.PLACE: 2, Scope.AREA: 3}

# `sfx.chest.open`: the channel, then one to four lower-case words, digits or underscores.
CUE_ID_PATTERN = r"^(music|ambient|sfx|voice|ui)(\.[a-z0-9_]{1,30}){1,4}$"
CUE_ID = re.compile(CUE_ID_PATTERN)

# The asset library's browsing categories that suit each channel (`catalog.AssetCategory`).
CHANNEL_CATEGORIES: dict[str, frozenset[str]] = {
    Channel.MUSIC: frozenset({"music", "other"}),
    Channel.VOICE: frozenset({"music", "other"}),
    Channel.AMBIENT: frozenset({"sound", "music", "other"}),
    Channel.SFX: frozenset({"sound", "other"}),
    Channel.UI: frozenset({"sound", "other"}),
}

AUDIO_KIND = "audio"
SCHEMA_VERSION = 1
