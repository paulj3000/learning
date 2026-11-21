"""The sound cues North Pole: The Missing Christmas Star plays (design section 8), as data.

Same contract as `firepeak_cues.py`: this lists WHAT the game asks for and holds no file, url or
storage key. The React side is `react/src/features/region-play/audio/regionAudio.ts`.
`seed_north_pole_sound` creates the cues whose audio already exists in the Asset Library.

`wired` is True only for a cue the client plays today (a zone ambience, a music state, a moment
the play layer already raises, the engine checkpoint and recovery events). The rest are flipped
to True by whoever raises the matching `playCue(...)` moment (see
`docs/north-pole/NORTH_POLE_AUDIO_INVENTORY.md`). Jump and landing reuse `sfx.player.jump` and
`sfx.player.land`.
"""

from apps.audio.treasure_rush_cues import CueSpec
from apps.audio.vocabulary import CUE_ID

NORTH_POLE_REGION_ID = "north-pole-village"

#: Audio zone id (design section 4, also the narration zone id) -> the ambience cue it plays.
NORTH_POLE_ZONE_AMBIENCE: dict[str, str] = {
    "santas-landing": "ambient.north_pole.landing",
    "christmas-village": "ambient.north_pole.landing",
    "santas-workshop": "ambient.north_pole.workshop",
    "candy-cane-forest": "ambient.north_pole.forest",
    "frozen-lake": "ambient.north_pole.lake",
    "reindeer-stables": "ambient.north_pole.stables",
    "gingerbread-village": "ambient.north_pole.gingerbread",
    "north-road": "ambient.north_pole.wind",
    "snowflake-mountain": "ambient.north_pole.mountain_wind",
    "north-pole-observatory": "ambient.north_pole.observatory",
}


def _ambient(name: str, description: str) -> CueSpec:
    return CueSpec(
        f"ambient.north_pole.{name}",
        f"North Pole ambience: {name}",
        description,
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1500,
        fade_out_ms=1500,
    )


def _sfx(name: str, title: str, description: str, *, wired: bool, **fields) -> CueSpec:
    fields.setdefault("max_concurrent", 4)
    return CueSpec(f"sfx.north_pole.{name}", title, description, wired=wired, **fields)


NORTH_POLE_CUES: tuple[CueSpec, ...] = (
    CueSpec(
        "music.north_pole.village",
        "North Pole music: village",
        "Gentle, warm looping winter theme for exploring and puzzling. Calm, never tense. "
        "Original, public domain or licensed seasonal music only.",
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1200,
        fade_out_ms=1200,
    ),
    CueSpec(
        "music.north_pole.forest",
        "North Pole music: forest",
        "Optional lighter, playful loop for the Candy Cane Forest. Reserved for a zone music "
        "assignment in Django; the client uses the village theme for exploring today.",
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1200,
        fade_out_ms=1200,
        wired=False,
    ),
    CueSpec(
        "music.north_pole.celebration",
        "North Pole music: celebration",
        "Short joyful theme played once when the Christmas Star is restored and the sleigh "
        "lifts off.",
        loop=False,
        stream=True,
        volume=0.5,
        fade_in_ms=600,
        fade_out_ms=1200,
    ),
    _ambient(
        "landing", "Soft snowy wind and distant sleigh bells. Santa's Landing and the village."
    ),
    _ambient(
        "workshop", "Quiet machinery hum, tinkling toys and a ticking clock. Santa's Workshop."
    ),
    _ambient(
        "forest",
        "Soft wind through frosty trees and a faint crystalline tinkle. Candy Cane Forest.",
    ),
    _ambient("lake", "Wide, calm ice creaks and a light breeze. Frozen Lake."),
    _ambient(
        "stables", "Gentle breathing, soft hooves in straw and a distant bell. Reindeer Stables."
    ),
    _ambient("gingerbread", "Warm, cosy village murmur and a crackling oven. Gingerbread Village."),
    _ambient("mountain_wind", "Open, high wind over snow. Snowflake Mountain."),
    _ambient("observatory", "Hushed night air and a faint, slow star shimmer. Observatory."),
    _ambient("wind", "Light winter breeze and creaking lanterns. North Road."),
    _sfx(
        "snow_step",
        "Snow footstep",
        "Optional. A soft crunch of a footstep in snow. Decorative.",
        wired=False,
        cooldown_ms=120,
    ),
    _sfx(
        "ice_step",
        "Ice footstep",
        "Optional. A light tick of a footstep on ice. Decorative.",
        wired=False,
        cooldown_ms=120,
    ),
    _sfx(
        "collect", "Item collected", "A bright, short chime when a pickup is collected.", wired=True
    ),
    _sfx(
        "fragment",
        "Star fragment collected",
        "A brighter, magical shimmer when a piece of the Christmas Star is picked up.",
        wired=False,
    ),
    _sfx(
        "answer_right",
        "Answer right",
        "Warm and short. Only after the server confirms a right answer.",
        wired=True,
    ),
    _sfx(
        "answer_retry",
        "Answer, try again",
        "Gentle and soft. Never a buzzer, never a scold.",
        wired=True,
    ),
    _sfx(
        "quest_complete",
        "Quest complete",
        "Short happy fanfare when a quest is complete.",
        wired=True,
        max_concurrent=1,
    ),
    _sfx(
        "checkpoint",
        "Checkpoint reached",
        "A cheerful bell when the child reaches a checkpoint.",
        wired=True,
        cooldown_ms=400,
    ),
    _sfx(
        "respawn",
        "Respawn",
        "A gentle puff of snow back to the checkpoint. Never harsh; nothing is lost.",
        wired=True,
        cooldown_ms=400,
    ),
    _sfx(
        "reindeer",
        "Reindeer",
        "Optional. A soft snort and snuffle for Snowball and the stables.",
        wired=False,
        max_concurrent=2,
    ),
    _sfx(
        "sleigh_bells",
        "Sleigh bells",
        "Optional. Jingling sleigh bells for the departure and the bell puzzle.",
        wired=False,
        max_concurrent=2,
    ),
    _sfx(
        "star_restored",
        "Christmas Star restored",
        "The Star relights: a swelling, sparkling glow.",
        wired=False,
        max_concurrent=1,
    ),
    CueSpec(
        "voice.north_pole.npc_greet",
        "North Pole NPC greeting",
        "Optional. A short friendly voice sting when a character greets the child.",
        max_concurrent=2,
        wired=False,
    ),
)

NORTH_POLE_CUE_IDS: frozenset[str] = frozenset(spec.cue_id for spec in NORTH_POLE_CUES)

if not all(CUE_ID.match(spec.cue_id) for spec in NORTH_POLE_CUES):
    raise AssertionError("a North Pole cue id does not match CUE_ID")
