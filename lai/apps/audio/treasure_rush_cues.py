"""The sound cues Treasure Rush plays (SM-P3-05, SM-P3-10), as data.

This table is the contract between the React game (`react/src/features/region-play/audio/`) and
the Django sound library. It lists WHAT the game asks for; it holds no file, url or storage key.
`seed_treasure_rush_sound` reads it to create missing cues for audio that already exists in the
Asset Library, and to report the audio that does not.

Cue ids that already exist in the library are never changed here: the command only adds.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CueSpec:
    cue_id: str
    name: str
    description: str
    loop: bool = False
    stream: bool = False
    volume: float = 1.0
    max_concurrent: int | None = None
    cooldown_ms: int = 0
    fade_in_ms: int = 0
    fade_out_ms: int = 0
    #: False for a cue the game can use but no current mechanic raises.
    wired: bool = True

    @property
    def channel(self) -> str:
        return self.cue_id.split(".", 1)[0]

    @property
    def asset_id(self) -> str:
        """The Asset Library id staff give the audio file: the cue id with dashes."""
        return self.cue_id.replace(".", "-").replace("_", "-")


def _ambient(name: str, description: str, *, wired: bool = True) -> CueSpec:
    return CueSpec(
        f"ambient.treasure_rush.{name}",
        f"Treasure Rush ambience: {name}",
        description,
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1500,
        fade_out_ms=1500,
        wired=wired,
    )


def _music(name: str, description: str, *, loop: bool) -> CueSpec:
    return CueSpec(
        f"music.treasure_rush.{name}",
        f"Treasure Rush music: {name}",
        description,
        loop=loop,
        stream=True,
        volume=0.5,
        fade_in_ms=1200,
        fade_out_ms=1200,
    )


def _sfx(cue_id: str, name: str, description: str, *, wired: bool = True, **fields) -> CueSpec:
    return CueSpec(cue_id, name, description, max_concurrent=4, wired=wired, **fields)


TREASURE_RUSH_CUES: tuple[CueSpec, ...] = (
    _ambient("ocean", "Waves and gulls. Pirate Landing and Shipwreck Beach."),
    _ambient("jungle", "Birds and rustling palms. Palm Tree Grove."),
    _ambient("cave", "Low echoing air. The Ancient Treasure Ruins."),
    _ambient("wind", "Open sky wind. Lookout Point (no zone raises it yet).", wired=False),
    _music("explore", "Calm looping exploration theme.", loop=True),
    _music("puzzle", "Gentle focused theme while a rune puzzle is out.", loop=True),
    _music("victory", "Short happy finale, played once after a quest is finished.", loop=False),
    _sfx("sfx.chest.open", "Chest opens", "Lid creak and sparkle. Server confirmed open."),
    _sfx("sfx.treasure.reveal", "Treasure revealed", "Soft shimmer as the reward appears."),
    _sfx("sfx.key.discover", "Key found", "A key is picked up through the play API."),
    _sfx("sfx.reward.collect", "Reward collected", "A reward that does not open a chest."),
    _sfx("sfx.world.bridge_open", "Bridge opens", "The gate opens and the bridge is laid."),
    _sfx(
        "sfx.learning.correct",
        "Correct answer",
        "Warm and short. Only after a confirmed answer.",
    ),
    _sfx("sfx.learning.retry", "Try again", "Gentle and soft, never a buzzer. Ages 5 to 8."),
    _sfx("sfx.learning.complete", "Challenge complete", "A solved rune puzzle."),
    _sfx("sfx.quest.complete", "Quest complete", "Rewards are committed and a quest is finished."),
    _sfx("sfx.coin.collect", "Coin collected", "No coin pickup mechanic yet.", wired=False),
    _sfx("sfx.gem.collect", "Gem collected", "No gem pickup mechanic yet.", wired=False),
    _sfx("sfx.item.pickup", "Item picked up", "Only keys are picked up today.", wired=False),
)
