"""The sound cues Storykeeper Castle plays (SC-R06-01), as data.

This table is the contract between the castle's React half
(`react/src/features/island-map/three/extensions/castleTale/castleSounds.ts`, `CASTLE_OWNED_CUES`)
and the Django sound library; a Vitest test fails if the two lists differ. It lists WHAT the castle
asks for and holds no file, url or storage key. `seed_castle_sound` reads it to create missing cues
for audio that already exists in the Asset Library, and to report the audio that does not.

Only the castle's own cues are here. The shared ones it also plays (`sfx.learning.correct`,
`sfx.learning.retry`, `sfx.quest.complete`, `sfx.treasure.reveal`, `sfx.reward.collect`, and the
movement and platform cues) are rows of `treasure_rush_cues.py`, reused and never duplicated.
"""

from apps.audio.treasure_rush_cues import CueSpec

#: The castle's room beds: (name, rooms it plays in).
_BEDS = (
    (
        "hall",
        "The Entry Hall, the Story Hall and the East Corridor: a warm stone hall, a soft fire.",
    ),
    ("gallery", "The Character Gallery: a quiet gallery, a faint hum of portraits."),
    ("costume", "The Costume Room: soft fabric rustles."),
    ("tower", "The Setting Tower and observatory: high wind, a gentle shimmer."),
    ("studio", "The Illustration Studio: brushes, a quiet tap of paint."),
    ("library", "The Great Library: pages turning, a hushed room."),
    ("trophy", "The Trophy Room: a calm room with a faint chime."),
    ("secret", "The Secret Chamber: a low crystal hum."),
)


def _ambient(name: str, description: str) -> CueSpec:
    return CueSpec(
        f"ambient.castle.{name}",
        f"Castle ambience: {name}",
        description,
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1500,
        fade_out_ms=1500,
    )


def _music(name: str, description: str) -> CueSpec:
    return CueSpec(
        f"music.castle.{name}",
        f"Castle music: {name}",
        description,
        loop=True,
        stream=True,
        volume=0.5,
        fade_in_ms=1200,
        fade_out_ms=1200,
    )


def _sfx(cue_id: str, name: str, description: str, **fields) -> CueSpec:
    return CueSpec(cue_id, name, description, max_concurrent=4, **fields)


CASTLE_CUES: tuple[CueSpec, ...] = (
    *(_ambient(name, description) for name, description in _BEDS),
    _music("explore", "Calm looping castle theme while the child explores."),
    _music("story", "A softer story theme while the Great Storybook is open."),
    _sfx("sfx.castle.book_open", "Storybook opens", "A heavy cover opening, 1 second."),
    _sfx("sfx.castle.book_close", "Storybook closes", "A soft thump of a closing book."),
    _sfx(
        "sfx.castle.page_restore",
        "Page restored",
        "A page flutters back into the book. Falls back to sfx.treasure.reveal.",
    ),
    _sfx("sfx.castle.quest_start", "Quest starts", "A short bright call to adventure."),
    _sfx(
        "sfx.castle.npc_greet",
        "Castle NPC greets",
        "A friendly chime when the child walks up to a castle character.",
        cooldown_ms=400,
    ),
    _sfx(
        "sfx.castle.hint_chime",
        "Hint chime",
        "A soft, warm chime when a hint is given. Never a buzzer.",
        cooldown_ms=400,
    ),
    _sfx(
        "sfx.castle.artifact_found",
        "Artifact found",
        "A sparkle when a story object is found. Falls back to sfx.reward.collect.",
    ),
    CueSpec(
        "ui.castle.door",
        "Castle door",
        "A soft wooden door sound as the child walks into another room.",
        max_concurrent=2,
        cooldown_ms=400,
    ),
)
