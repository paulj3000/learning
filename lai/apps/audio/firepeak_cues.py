"""The sound cues The Heart of Firepeak plays (design section 9), as data.

Same contract as `treasure_rush_cues.py`: this lists WHAT the game asks for and holds no file,
url or storage key. The React side is `react/src/features/region-play/audio/regionAudio.ts`.
`seed_firepeak_sound` creates the cues whose audio already exists in the Asset Library.

`wired` is True only for a cue the client plays today. The unwired ones (machinery, npc greeting)
are flipped to True by whoever raises a matching moment (see `docs/firepeak/FIREPEAK_AUDIO_INVENTORY.md`).
"""

from apps.audio.treasure_rush_cues import CueSpec
from apps.audio.vocabulary import CUE_ID

FIREPEAK_REGION_ID = "firepeak-heart"

#: Audio zone id (design section 4) -> the ambience cue that zone plays.
FIREPEAK_ZONE_AMBIENCE: dict[str, str] = {
    "explorers-landing": "ambient.firepeak.landing",
    "emberwood-forest": "ambient.firepeak.forest",
    "lava-crossing": "ambient.firepeak.lava",
    "crystal-caverns": "ambient.firepeak.cave",
    "ancient-forge": "ambient.firepeak.forge",
    "firepeak-summit": "ambient.firepeak.summit_wind",
    "heart-chamber": "ambient.firepeak.heart",
}


def _ambient(name: str, description: str) -> CueSpec:
    return CueSpec(
        f"ambient.firepeak.{name}",
        f"Firepeak ambience: {name}",
        description,
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1500,
        fade_out_ms=1500,
    )


def _sfx(name: str, title: str, description: str, *, wired: bool, **fields) -> CueSpec:
    fields.setdefault("max_concurrent", 4)
    return CueSpec(f"sfx.firepeak.{name}", title, description, wired=wired, **fields)


FIREPEAK_CUES: tuple[CueSpec, ...] = (
    CueSpec(
        "music.firepeak.realm",
        "Firepeak music: realm",
        "Warm, adventurous looping theme for the whole volcano. Calm, never tense.",
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1200,
        fade_out_ms=1200,
    ),
    CueSpec(
        "music.firepeak.finale",
        "Firepeak music: finale",
        "Short triumphant theme played once when the Heart is restored.",
        loop=False,
        stream=True,
        volume=0.5,
        fade_in_ms=600,
        fade_out_ms=1200,
    ),
    _ambient("landing", "Soft wind and distant rumble. Explorer's Landing."),
    _ambient("forest", "Crackling wood, small birds, a trickle of stream. Emberwood Forest."),
    _ambient("lava", "Slow bubbling lava and warm air. Lava Crossing."),
    _ambient("cave", "Echoing drips and a faint crystal hum. Crystal Caverns."),
    _ambient("forge", "Low machinery hum and steam. Ancient Forge."),
    _ambient("summit_wind", "Open, high wind. Firepeak Summit."),
    _ambient("heart", "A slow, warm pulse. Heart Chamber."),
    _sfx(
        "machinery",
        "Forge machinery",
        "Optional. Gears turning when the forge powers up.",
        wired=False,
    ),
    _sfx(
        "crystal_collect",
        "Crystal collected",
        "A bright shimmer when an ember shard is picked up.",
        wired=True,
    ),
    _sfx(
        "switch", "Switch flipped", "Optional. A solid click and hum.", wired=True, cooldown_ms=100
    ),
    _sfx(
        "puzzle_complete",
        "Puzzle complete",
        "Warm and short. Only after the server confirms a puzzle.",
        wired=True,
    ),
    _sfx(
        "checkpoint",
        "Checkpoint reached",
        "A cheerful chime when the child reaches a checkpoint.",
        wired=True,
        cooldown_ms=400,
    ),
    _sfx(
        "lava_respawn",
        "Lava respawn",
        "A gentle whoosh back to the checkpoint. Never harsh; nothing is lost.",
        wired=True,
        cooldown_ms=400,
    ),
    _sfx(
        "rock_rumble",
        "Falling rocks warning",
        "A low rumble and small pebbles at the start of the falling-rock warning on the optional"
        " summit hops, heard only on the Summit. Soft, never alarming; the warning lasts at least 1.5 s.",
        wired=True,
        cooldown_ms=1000,
        max_concurrent=1,
    ),
    _sfx(
        "restore",
        "Heart restored",
        "The Heart relights: a swelling glow.",
        wired=True,
        max_concurrent=1,
    ),
    _sfx(
        "complete",
        "Adventure complete",
        "Short fanfare once the adventure is finished.",
        wired=True,
        max_concurrent=1,
    ),
    CueSpec(
        "voice.firepeak.npc_greet",
        "Firepeak NPC greeting",
        "Optional. A short friendly voice sting when a character greets the child.",
        max_concurrent=2,
        wired=False,
    ),
)

FIREPEAK_CUE_IDS: frozenset[str] = frozenset(spec.cue_id for spec in FIREPEAK_CUES)

assert all(CUE_ID.match(spec.cue_id) for spec in FIREPEAK_CUES)
