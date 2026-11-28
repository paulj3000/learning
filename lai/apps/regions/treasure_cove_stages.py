"""Pip's Missing Treasure, redesigned (#102): five stages of learning through play.

The owner's playtest (2026-11-26) found the cove boring: every chest stopped the game to ask how
many coins it needed. Here each chest is the reward at the end of a stage the child plays with
their feet and eyes, built from the shared 3D Area puzzle kinds (`apps.regions.puzzles`, ADR-047
F): versioned, age-banded, hinted, graded on the server, and practised again once solved.

1. **The missing map** (Pirate Landing): three torn pieces to find (`COLLECT_OBJECT`), then the
   waymarker sign the map points to (`CHOOSE_ANSWER`, `PATHS`). Opens Pip's landing chest.
2. **Crocodile Creek** (the grove path): cross on the stepping stones in order, counting,
   ordering numbers or following a pattern (`ORDER_SEQUENCE`, `PATH`). Opens the grove chest.
3. **The supply dock** (Shipwreck Beach): with the brass key from the X in the sand, load Pip's
   boat by walking to the right cargo crate: sharing equally, adding a load, finding what is
   missing, sorting (`CHOOSE_ANSWER`, `CARDS`). Opens the locked chest.
4. **The forgotten cave** (the ruins): three carvings hidden in the corners (`COLLECT_OBJECT`),
   each a shape with dots to remember, then the rune stones pressed in the order a riddle gives
   (`ORDER_SEQUENCE`, `SWITCHES`). Solves the pedestal.
5. **Pip's lost treasure** (the dais): light the four torches in the order of the adventure
   (`ORDER_SEQUENCE`, `SWITCHES`). Opens the golden chest. Then the child returns to Pip.

**Progress stays compatible.** A stage that ends at a chest records that chest's existing world
change key and grants its existing reward rule, so the quest objectives, rewards, the TR-17
bridge and every child's history are unchanged: a child who opened a chest the old way finds its
stage already solved. A chest whose key a published puzzle records is "opened by a puzzle"
(`game_sessions.play.chest_lock`): it never asks its old question.

Content rules: every prompt reads aloud in one breath, every option carries a symbol so nothing
depends on colour, and every explanation says why, kindly. A visit's first variant is chosen per
visit (`firstVariantIndex`), so where the story needs one answer every variant keeps it (the map
always points to the grove); elsewhere the answer, and the crate or stone it is on, changes from
variant to variant, and "Try a different one" or a replay brings the next. Parameters only; what Pip
says about a puzzle is NPC dialogue (none yet: the puzzle's title is the fallback intro).
"""

from __future__ import annotations

import json
from pathlib import Path

from .treasure_cove_layout import STAGE_SPOTS

LANDING_CHEST_KEY = "TREASURE_RUSH_COVE_CHEST_OPENED"
GROVE_CHEST_KEY = "TREASURE_COVE_GROVE_CHEST_OPENED"
BEACH_CHEST_KEY = "TREASURE_COVE_BEACH_CHEST_OPENED"
PUZZLE_SOLVED_KEY = "TREASURE_COVE_RUINS_PUZZLE_SOLVED"
FINAL_CHEST_KEY = "TREASURE_COVE_FINAL_CHEST_OPENED"
KEY_FOUND_KEY = "TREASURE_COVE_KEY_FOUND"

MAP_PIECE_KEYS = [f"TREASURE_COVE_MAP_PIECE_{n}" for n in (1, 2, 3)]
CARVING_KEYS = [f"TREASURE_COVE_CARVING_{n}" for n in (1, 2, 3)]

SPROUT, PATHFINDER, EXPLORER = "SPROUT", "PATHFINDER", "EXPLORER"

RUNE_STONE_IDS = ["cove-rune-stone-1", "cove-rune-stone-2", "cove-rune-stone-3"]

# --- placements: (entity id, label, spot, placeholder w/h/d, rotation, stand-in shape, colour) ---

PLACEMENTS = [
    *[
        (
            f"cove-map-piece-{n}",
            f"Torn map piece {n}",
            f"map-piece-{n}",
            (0.6, 0.15, 0.45),
            0.4 * n,
            "MARKER",
            0xE8D5A3,
        )
        for n in (1, 2, 3)
    ],
    (
        "cove-way-grove",
        "Sign to Palm Tree Grove",
        "way-grove",
        (0.6, 1.6, 0.2),
        1.57,
        "SIGN",
        0x9C6B3C,
    ),
    (
        "cove-way-beach",
        "Sign to Shipwreck Beach",
        "way-beach",
        (0.6, 1.6, 0.2),
        -1.57,
        "SIGN",
        0x9C6B3C,
    ),
    ("cove-way-ruins", "Sign to the ruins", "way-ruins", (0.6, 1.6, 0.2), 0.0, "SIGN", 0x9C6B3C),
    *[
        (
            f"cove-creek-stone-{letter}",
            f"Stepping stone {index + 1}",
            f"creek-stone-{letter}",
            (0.9, 0.25, 0.9),
            0.0,
            "STONE",
            0x8E8A80,
        )
        for index, letter in enumerate("abcde")
    ],
    (
        "cove-creek-crocodile",
        "Snappy the crocodile",
        "creek-crocodile",
        (1.8, 0.5, 0.6),
        2.6,
        "ANIMAL",
        0x5E8C3A,
    ),
    *[
        (
            f"cove-dock-crate-{letter}",
            f"Cargo crate {letter.upper()}",
            f"dock-crate-{letter}",
            (0.9, 0.9, 0.9),
            0.3 * index,
            "BOX",
            0xB5824A,
        )
        for index, letter in enumerate("abc")
    ],
    *[
        (
            f"cove-cave-carving-{n}",
            f"Old carving {n}",
            f"cave-glyph-{n}",
            (0.8, 1.0, 0.25),
            0.0,
            "MARKER",
            0xA39B8B,
        )
        for n in (1, 2, 3)
    ],
    *[
        (
            f"cove-finale-torch-{n}",
            f"Torch {n}",
            f"finale-torch-{n}",
            (0.4, 1.6, 0.4),
            0.0,
            "LANTERN",
            0xF2A541,
        )
        for n in (1, 2, 3, 4)
    ],
]

# Bundled, project-original models that already exist (LAI 07, 2026-11-26): drawn in place of
# the stand-in wherever the region catalog can deliver them. The rest keep their stand-ins.
ASSETS = {
    "cove-way-grove": "signpost",
    "cove-way-beach": "signpost",
    "cove-way-ruins": "signpost",
    "cove-dock-crate-a": "crate",
    "cove-dock-crate-b": "crate",
    "cove-dock-crate-c": "crate",
}
# The bundled crate is a kit-piece, which only a SCENERY placement may use (the cove's other
# crates are scenery too). The kind changes nothing in play: puzzles bind by entity id.
KIT_PIECE_ASSETS = {"crate"}

# The non-interactive friend at the creek: drawn, never a puzzle object.
SCENERY_ONLY = {"cove-creek-crocodile"}


def placement_rows() -> list[dict]:
    """The stage placements as `WorldObjectPlacement` field values (seed-owned)."""
    rows = []
    for entity_id, label, spot, (width, height, depth), rotation, _shape, _color in PLACEMENTS:
        x, z = STAGE_SPOTS[spot]
        rows.append(
            {
                "entity_id": entity_id,
                "kind": "SCENERY" if ASSETS.get(entity_id) in KIT_PIECE_ASSETS else "PROP",
                "label": label,
                "asset_id": ASSETS.get(entity_id, ""),
                "x": x,
                "z": z,
                "rotation_y": rotation,
                "placeholder_width": width,
                "placeholder_height": height,
                "placeholder_depth": depth,
            }
        )
    return rows


def stand_ins() -> list[dict]:
    """`scene["effects"]["standIns"]`: a recognisable shape until a model is published."""
    return [
        {"entityId": entity_id, "shape": shape, "color": color}
        for entity_id, _label, _spot, _size, _rotation, shape, color in PLACEMENTS
    ]


# --- variant helpers ------------------------------------------------------------------------------


def _option(option_id: str, label: str, symbol: str) -> dict:
    return {"id": option_id, "label": label, "symbol": symbol}


def choose(vid, prompt, options, answer, explanation, skill) -> dict:
    """A CHOOSE_ANSWER variant. `options` are (id, label, symbol); `answer` is an option id."""
    return {
        "id": vid,
        "prompt": prompt,
        "options": [_option(*option) for option in options],
        "answer": answer,
        "explanation": explanation,
        "skill": skill,
    }


def order(vid, prompt, items, answer, explanation, skill) -> dict:
    """An ORDER_SEQUENCE variant. `items` are (id, label, symbol); `answer` lists item ids."""
    return {
        "id": vid,
        "prompt": prompt,
        "items": [_option(*item) for item in items],
        "answer": list(answer),
        "explanation": explanation,
        "skill": skill,
    }


def dealt(labels: list[str], ids: str, shift: int) -> tuple[list[tuple], list[str]]:
    """Stepping stones: `labels` in the right order, dealt onto the stones `ids` rotated by
    `shift`, so each variant's right path zig-zags differently across the creek."""
    count = len(labels)
    order_ids = [ids[(i + shift) % count] for i in range(count)]
    symbols = ["circle", "square", "triangle", "star", "diamond"]
    by_id = {order_ids[i]: labels[i] for i in range(count)}
    items = [(i, by_id[i], symbols[ids.index(i)]) for i in ids[:count]]
    return items, order_ids


def _band(presentation: str, subject: str, skill: str, entities: dict, variants, hints) -> dict:
    key = "optionEntities" if "options" in variants[0] else "itemEntities"
    return {
        "presentation": presentation,
        "subject": subject,
        "skill": skill,
        key: entities,
        "variants": variants,
        "hints": hints,
        "hintAfterAttempts": 2,
    }


def _body(puzzle_id, kind, title, requires, change_key, reward, bands) -> dict:
    return {
        "puzzleId": puzzle_id,
        "kind": kind,
        "title": title,
        "requiresChangeKeys": list(requires),
        "worldChangeKey": change_key,
        "rewardRuleId": reward,
        "ageBands": bands,
    }


def _collect(message_by_band: dict[str, str], hint: str) -> dict:
    return {
        band: {"discoveryMessage": message, "hints": [hint]}
        for band, message in message_by_band.items()
    }


# --- stage 1: the missing map ---------------------------------------------------------------------


def _map_piece(n: int, where: str) -> dict:
    message = f"You found piece {n} of Pip's map!"
    return _body(
        f"cove-map-piece-{n}",
        "COLLECT_OBJECT",
        f"Torn map piece {n}",
        [],
        MAP_PIECE_KEYS[n - 1],
        None,
        _collect(
            {SPROUT: message, PATHFINDER: message, EXPLORER: f"{message} {where}"},
            "Look round the landing for a torn piece of paper.",
        ),
    )


WAY_ENTITIES = {"grove": "cove-way-grove", "beach": "cove-way-beach", "ruins": "cove-way-ruins"}
PLACES = [
    ("grove", "Palm Tree Grove", "star"),
    ("beach", "Shipwreck Beach", "circle"),
    ("ruins", "Ancient Ruins", "triangle"),
]
DIRECTIONS = [
    ("grove", "West, to the grove", "star"),
    ("beach", "East, to the beach", "circle"),
    ("ruins", "South, to the ruins", "triangle"),
]


def _map_reading() -> dict:
    sprout = [
        choose(
            "s1",
            "Pip's map has a star by the X. Walk to the sign with the star.",
            PLACES,
            "grove",
            "The star on the map matches the star on the sign to Palm Tree Grove.",
            "observation",
        ),
        choose(
            "s2",
            "The map shows palm trees by the X. Walk to the sign that goes to the palm trees.",
            PLACES,
            "grove",
            "Palm Tree Grove is where the palm trees are. Its sign has a star.",
            "observation",
        ),
        choose(
            "s3",
            "The map shows flowers and trees by the X. Which sign goes to the trees?",
            PLACES,
            "grove",
            "The flowers and trees are in Palm Tree Grove. Well spotted!",
            "observation",
        ),
    ]
    pathfinder = [
        choose(
            "p1",
            "The map shows the X past the flowers, under the palm trees. Which sign points there?",
            PLACES,
            "grove",
            "Flowers and palm trees grow in Palm Tree Grove, so that sign shows the way.",
            "observation",
        ),
        choose(
            "p2",
            "The map says the sun goes down over the treasure. The sun goes down in the west. "
            "Which sign points west?",
            DIRECTIONS,
            "grove",
            "The sun goes down in the west, and the west sign goes to Palm Tree Grove.",
            "position-and-direction",
        ),
        choose(
            "p3",
            "The map says: not by the sand, and not by the old stones. Which way is left?",
            PLACES,
            "grove",
            "The beach is sand and the ruins are old stones, so the grove is the one left.",
            "following-instructions",
        ),
    ]
    explorer = [
        choose(
            "e1",
            "Pip's map says: start at the landing, walk west past the flowers, and the X is in "
            "the trees. Which sign do you follow?",
            DIRECTIONS,
            "grove",
            "West, past the flowers and into the trees: that is the path to Palm Tree Grove.",
            "position-and-direction",
        ),
        choose(
            "e2",
            "The map's arrow points away from where the sun comes up. The sun comes up in the "
            "east. Which way does the arrow point?",
            DIRECTIONS,
            "grove",
            "Away from the east is west, and the west sign goes to the grove.",
            "position-and-direction",
        ),
        choose(
            "e3",
            "Three clues: not by the shipwreck, not by the old pillars, near tall palm trees. "
            "Which sign leads to the X?",
            PLACES,
            "grove",
            "The shipwreck is at the beach and the pillars are in the ruins. Tall palms grow in "
            "the grove.",
            "reading-comprehension",
        ),
        choose(
            "e4",
            "The X is to the north-west of the landing. Which sign points nearest to north-west?",
            DIRECTIONS,
            "grove",
            "North-west is between north and west, so the west sign is the closest way.",
            "position-and-direction",
        ),
    ]
    hints = {
        SPROUT: ["Look for the star on a sign.", "The star sign is on the path to the trees."],
        PATHFINDER: [
            "Read the map clue again, one part at a time.",
            "Palm Tree Grove is where the tall palm trees grow.",
        ],
        EXPLORER: [
            "Cross out every place a clue says no to.",
            "The sun goes down in the west.",
        ],
    }
    return _body(
        "cove-treasure-map",
        "CHOOSE_ANSWER",
        "Pip's treasure map",
        MAP_PIECE_KEYS,
        LANDING_CHEST_KEY,
        "reward-treasure-rush-cove-chest",
        {
            band: _band("PATHS", "LOGIC", "observation", WAY_ENTITIES, variants, hints[band])
            for band, variants in ((SPROUT, sprout), (PATHFINDER, pathfinder), (EXPLORER, explorer))
        },
    )


# --- stage 2: Crocodile Creek ---------------------------------------------------------------------


def _stones(letters: str) -> dict:
    return {letter: f"cove-creek-stone-{letter}" for letter in letters}


def _creek_variant(vid, prompt, labels, explanation, skill, shift):
    letters = "abcde"[: len(labels)]
    items, answer = dealt(labels, letters, shift)
    return order(vid, prompt, items, answer, explanation, skill)


def _creek() -> dict:
    sprout = [
        _creek_variant(
            "s1",
            "Snappy says: step on the stones in order. One dot, then two dots, then three dots.",
            ["One dot", "Two dots", "Three dots"],
            "One, two, three! You counted your way across the creek.",
            "counting-sets",
            0,
        ),
        _creek_variant(
            "s2",
            "Step on the stones from the smallest fish to the biggest fish.",
            ["Small fish", "Middle fish", "Big fish"],
            "Small, then middle, then big. You put them in order of size.",
            "comparing-lengths",
            1,
        ),
        _creek_variant(
            "s3",
            "Step on the stones from the fewest frogs to the most frogs.",
            ["1 frog", "2 frogs", "3 frogs"],
            "1 frog, then 2, then 3. Each stone has one more frog.",
            "counting-sets",
            2,
        ),
    ]
    pathfinder = [
        _creek_variant(
            "p1",
            "Step on the numbers from the smallest to the biggest.",
            ["2", "4", "6", "9"],
            "2 is smallest, then 4, then 6, and 9 is biggest.",
            "comparing-and-ordering-numbers",
            0,
        ),
        _creek_variant(
            "p2",
            "Count by twos to cross the creek. Start at 2.",
            ["2", "4", "6", "8"],
            "2, 4, 6, 8: each stone is two more than the one before.",
            "patterns",
            1,
        ),
        _creek_variant(
            "p3",
            "Snappy counts down. Step from the biggest number to the smallest.",
            ["10", "7", "5", "1"],
            "10 is biggest, then 7, then 5, and 1 is smallest.",
            "comparing-and-ordering-numbers",
            2,
        ),
        _creek_variant(
            "p4",
            "Count back by ones to cross. Start at 8.",
            ["8", "7", "6", "5"],
            "8, 7, 6, 5: each stone is one less.",
            "counting-sets",
            3,
        ),
    ]
    explorer = [
        _creek_variant(
            "e1",
            "Each stone is 3 more than the one before. Start at 2 and cross.",
            ["2", "5", "8", "11", "14"],
            "2, 5, 8, 11, 14: add 3 each time.",
            "patterns",
            0,
        ),
        _creek_variant(
            "e2",
            "Cross from the smallest number to the biggest.",
            ["12", "19", "25", "38", "41"],
            "Look at the tens first: 12 and 19, then 25, then 38, then 41.",
            "comparing-and-ordering-numbers",
            1,
        ),
        _creek_variant(
            "e3",
            "Count back by 5 from 25 to cross.",
            ["25", "20", "15", "10", "5"],
            "25, 20, 15, 10, 5: take away 5 each time.",
            "patterns",
            2,
        ),
        _creek_variant(
            "e4",
            "Each stone doubles the one before. Start at 1.",
            ["1", "2", "4", "8", "16"],
            "1, 2, 4, 8, 16: each number is the last one added to itself.",
            "patterns",
            3,
        ),
    ]
    bands = {}
    for band, letters, variants, hints in (
        (SPROUT, "abc", sprout, ["Start with the stone that has the fewest.", "Count out loud."]),
        (
            PATHFINDER,
            "abcd",
            pathfinder,
            ["Find the first number, then look for the next one.", "Say the numbers out loud."],
        ),
        (
            EXPLORER,
            "abcde",
            explorer,
            ["Find the rule from the first two stones.", "Check each step with the rule."],
        ),
    ):
        bands[band] = _band("PATH", "MATHEMATICS", "patterns", _stones(letters), variants, hints)
    return _body(
        "cove-crocodile-creek",
        "ORDER_SEQUENCE",
        "Crocodile Creek",
        [LANDING_CHEST_KEY],
        GROVE_CHEST_KEY,
        "reward-treasure-cove-grove-chest",
        bands,
    )


# --- stage 3: the supply dock ---------------------------------------------------------------------

CRATE_ENTITIES = {letter: f"cove-dock-crate-{letter}" for letter in "abc"}
CRATE_SYMBOLS = ["square", "diamond", "hexagon"]


def _crates(labels: list[str]) -> list[tuple]:
    return [
        (letter, label, CRATE_SYMBOLS[i])
        for i, (letter, label) in enumerate(zip("abc", labels, strict=True))
    ]


def _dock() -> dict:
    sprout = [
        choose(
            "s1",
            "Pip's boat needs 3 bananas. Walk to the crate with 3 bananas.",
            _crates(["3 bananas", "2 bananas", "4 bananas"]),
            "a",
            "That crate has 3 bananas, just what the boat needs.",
            "number-recognition",
        ),
        choose(
            "s2",
            "Which crate has the most fish? Walk to it.",
            _crates(["1 fish", "4 fish", "2 fish"]),
            "b",
            "4 fish is more than 2 fish and more than 1 fish.",
            "counting-sets",
        ),
        choose(
            "s3",
            "The boat needs food. Which crate has food in it?",
            _crates(["Rope", "Hammers", "Apples"]),
            "c",
            "Apples are food. Rope and hammers are tools.",
            "classification",
        ),
    ]
    pathfinder = [
        choose(
            "p1",
            "Two sailors share 6 coconuts equally. Walk to the crate showing how many each "
            "sailor gets.",
            _crates(["3", "2", "4"]),
            "a",
            "3 and 3 make 6, so each sailor gets 3 coconuts.",
            "equal-sharing",
        ),
        choose(
            "p2",
            "The boat has 4 barrels. Pip loads 3 more. Which crate shows how many barrels now?",
            _crates(["6", "8", "7"]),
            "c",
            "4 and 3 more is 7. Count on from 4: 5, 6, 7.",
            "addition-within-ten",
        ),
        choose(
            "p3",
            "Pip packed 8 apples. 5 are in the boat. Which crate has the missing apples?",
            _crates(["2", "3", "4"]),
            "b",
            "5 and 3 more make 8, so 3 apples are missing.",
            "subtraction-within-ten",
        ),
        choose(
            "p4",
            "Which crate has only fruit in it?",
            _crates(["Apples and bananas", "Rope and nails", "Fish and bread"]),
            "a",
            "Apples and bananas are both fruit.",
            "classification",
        ),
    ]
    explorer = [
        choose(
            "e1",
            "Balance the boat: the left side has 9 sacks and the right side has 5. Which crate "
            "makes both sides the same?",
            _crates(["3", "5", "4"]),
            "c",
            "5 and 4 more make 9, so adding 4 balances the boat.",
            "subtraction-within-ten",
        ),
        choose(
            "e2",
            "3 sailors share 12 fish equally. Which crate shows each sailor's share?",
            _crates(["4", "3", "6"]),
            "a",
            "4 and 4 and 4 make 12, so each sailor gets 4 fish.",
            "equal-sharing",
        ),
        choose(
            "e3",
            "Each barrel holds 4 cups of water. Pip needs 3 barrels. How many cups is that?",
            _crates(["7", "12", "10"]),
            "b",
            "3 groups of 4 is 12: 4, 8, 12.",
            "multiplication-facts",
        ),
        choose(
            "e4",
            "Pip needs tools, not food. Which crate goes on the tool shelf?",
            _crates(["Bread and cheese", "Apples and fish", "Hammer and nails"]),
            "c",
            "A hammer and nails are tools for fixing things. The others are food.",
            "classification",
        ),
    ]
    hints = {
        SPROUT: ["Count each crate's things out loud.", "Look at every crate before you choose."],
        PATHFINDER: ["Use your fingers to count it out.", "Try each crate's number in the story."],
        EXPLORER: ["Write the numbers in your head as a sum.", "Check your answer the other way."],
    }
    return _body(
        "cove-supply-dock",
        "CHOOSE_ANSWER",
        "The supply dock",
        [GROVE_CHEST_KEY, KEY_FOUND_KEY],
        BEACH_CHEST_KEY,
        "reward-treasure-cove-beach-chest",
        {
            band: _band(
                "CARDS", "MATHEMATICS", "counting-sets", CRATE_ENTITIES, variants, hints[band]
            )
            for band, variants in ((SPROUT, sprout), (PATHFINDER, pathfinder), (EXPLORER, explorer))
        },
    )


# --- stage 4: the forgotten cave ------------------------------------------------------------------

CARVINGS = [(1, "star", "1 dot"), (2, "moon", "2 dots"), (3, "triangle", "3 dots")]


def _carving(n: int, shape: str, dots: str) -> dict:
    message = f"You found a carved {shape} with {dots}!"
    return _body(
        f"cove-cave-carving-{n}",
        "COLLECT_OBJECT",
        f"Old carving {n}",
        [BEACH_CHEST_KEY],
        CARVING_KEYS[n - 1],
        None,
        _collect(
            {SPROUT: message, PATHFINDER: message, EXPLORER: f"{message} Remember it."},
            "The carvings hide in the corners of the ruins.",
        ),
    )


RUNE_ENTITIES = {
    "star": RUNE_STONE_IDS[0],
    "moon": RUNE_STONE_IDS[1],
    "triangle": RUNE_STONE_IDS[2],
}
RUNES = [("star", "Star", "star"), ("moon", "Moon", "moon"), ("triangle", "Triangle", "triangle")]
REMEMBER = "The star had 1 dot, the moon had 2 dots, and the triangle had 3 dots."


def _cave() -> dict:
    sprout = [
        order(
            "s1",
            "Press the rune stones in order of their dots: 1 dot, then 2 dots, then 3 dots.",
            RUNES,
            ["star", "moon", "triangle"],
            f"{REMEMBER} You remembered them all!",
            "observation",
        ),
        order(
            "s2",
            "Press the stone with the most dots first, then the next, then the fewest.",
            RUNES,
            ["triangle", "moon", "star"],
            f"{REMEMBER} Most to fewest: triangle, moon, star.",
            "observation",
        ),
    ]
    pathfinder = [
        *sprout[:1],
        order(
            "p2",
            "Press the stones from the most dots to the fewest dots.",
            RUNES,
            ["triangle", "moon", "star"],
            f"{REMEMBER} Most to fewest: triangle, moon, star.",
            "observation",
        ),
        order(
            "p3",
            "The moon goes first. Then press the other two from fewest dots to most.",
            RUNES,
            ["moon", "star", "triangle"],
            f"Moon first. Then the star has fewer dots than the triangle. {REMEMBER}",
            "reading-comprehension",
        ),
    ]
    explorer = [
        order(
            "e1",
            "The riddle says: start with the carving that had 2 dots, then the one with the most, "
            "then the one with the fewest.",
            RUNES,
            ["moon", "triangle", "star"],
            f"2 dots is the moon, the most is the triangle, the fewest is the star. {REMEMBER}",
            "reading-comprehension",
        ),
        order(
            "e2",
            "Begin with the shape that has 3 sides. Then press the others from fewest dots "
            "to most.",
            RUNES,
            ["triangle", "star", "moon"],
            f"A triangle has 3 sides. Then the star (1 dot) and the moon (2 dots). {REMEMBER}",
            "reading-comprehension",
        ),
        order(
            "e3",
            "The star is last. The moon is not first. What order opens the cave?",
            RUNES,
            ["triangle", "moon", "star"],
            "If the star is last and the moon is not first, the triangle must be first.",
            "reading-comprehension",
        ),
    ]
    hints = [REMEMBER, "Say the order out loud before you press the first stone."]
    return _body(
        "cove-forgotten-cave",
        "ORDER_SEQUENCE",
        "The forgotten cave",
        [BEACH_CHEST_KEY, *CARVING_KEYS],
        PUZZLE_SOLVED_KEY,
        None,
        {
            band: _band("SWITCHES", "LOGIC", "observation", RUNE_ENTITIES, variants, hints)
            for band, variants in ((SPROUT, sprout), (PATHFINDER, pathfinder), (EXPLORER, explorer))
        },
    )


# --- stage 5: Pip's lost treasure -----------------------------------------------------------------

JOURNEY = [
    ("map", "Pip's map", "star", "cove-finale-torch-1"),
    ("creek", "Crocodile Creek", "moon", "cove-finale-torch-2"),
    ("dock", "The supply dock", "diamond", "cove-finale-torch-3"),
    ("cave", "The forgotten cave", "triangle", "cove-finale-torch-4"),
]


def _finale() -> dict:
    def items(ids):
        return [(i, label, symbol) for i, label, symbol, _ in JOURNEY if i in ids]

    def entities(ids):
        return {i: torch for i, _, _, torch in JOURNEY if i in ids}

    three = ["map", "creek", "dock"]
    four = ["map", "creek", "dock", "cave"]
    forward = "First the map, then the creek, then the dock, then the cave."
    sprout = [
        order(
            "s1",
            "Light the torches in the order of your adventure. What did you do first?",
            items(three),
            three,
            "First the map, then the creek, then the crates at the dock. What an adventure!",
            "sequencing",
        ),
        order(
            "s2",
            "Light the torches backwards: start with the last place you went.",
            items(three),
            list(reversed(three)),
            "Backwards: the dock, then the creek, then the map.",
            "sequencing",
        ),
    ]
    pathfinder = [
        order(
            "p1",
            "Light the torches in the order of your adventure, from first to last.",
            items(four),
            four,
            forward,
            "sequencing",
        ),
        order(
            "p2",
            "Light the torches backwards, from the last place you went to the first.",
            items(four),
            list(reversed(four)),
            "Backwards: the cave, the dock, the creek, then the map.",
            "sequencing",
        ),
        order(
            "p3",
            "The cave torch goes first. Then light the others in the order of your adventure.",
            items(four),
            ["cave", "map", "creek", "dock"],
            "The cave first, then the map, the creek and the dock, in the order you went.",
            "sequencing",
        ),
    ]
    explorer = [
        pathfinder[0],
        pathfinder[1],
        order(
            "e3",
            "Light the places with water first, in the order you went, then the others in order.",
            items(four),
            ["creek", "dock", "map", "cave"],
            "The creek and the dock have water. Then the map and the cave, in the order you went.",
            "reading-comprehension",
        ),
    ]
    hints = {
        SPROUT: ["Where did you meet Pip's map?", "The map came first, then the creek."],
        PATHFINDER: [forward, "Think about where you walked, one place at a time."],
        EXPLORER: [forward, "Read the rule again: which places had water?"],
    }
    return _body(
        "cove-lost-treasure",
        "ORDER_SEQUENCE",
        "Pip's lost treasure",
        [PUZZLE_SOLVED_KEY],
        FINAL_CHEST_KEY,
        "reward-treasure-cove-final-chest",
        {
            SPROUT: _band(
                "SWITCHES", "LITERACY", "sequencing", entities(three), sprout, hints[SPROUT]
            ),
            PATHFINDER: _band(
                "SWITCHES", "LITERACY", "sequencing", entities(four), pathfinder, hints[PATHFINDER]
            ),
            EXPLORER: _band(
                "SWITCHES", "LITERACY", "sequencing", entities(four), explorer, hints[EXPLORER]
            ),
        },
    )


# --- the rows -------------------------------------------------------------------------------------

MAP_PIECE_WHERE = [
    "It was by the tent.",
    "It was near the crates.",
    "It was on the way to the dock.",
]


def puzzle_rows() -> list[tuple[str, str, list[str], dict]]:
    """(puzzle id, kind, entity ids, first published body), in story order."""
    rows: list[tuple[str, str, list[str], dict]] = []
    for n in (1, 2, 3):
        rows.append(
            (
                f"cove-map-piece-{n}",
                "COLLECT_OBJECT",
                [f"cove-map-piece-{n}"],
                _map_piece(n, MAP_PIECE_WHERE[n - 1]),
            )
        )
    rows.append(("cove-treasure-map", "CHOOSE_ANSWER", list(WAY_ENTITIES.values()), _map_reading()))
    rows.append(
        (
            "cove-crocodile-creek",
            "ORDER_SEQUENCE",
            [f"cove-creek-stone-{letter}" for letter in "abcde"],
            _creek(),
        )
    )
    rows.append(("cove-supply-dock", "CHOOSE_ANSWER", list(CRATE_ENTITIES.values()), _dock()))
    for n, shape, dots in CARVINGS:
        rows.append(
            (
                f"cove-cave-carving-{n}",
                "COLLECT_OBJECT",
                [f"cove-cave-carving-{n}"],
                _carving(n, shape, dots),
            )
        )
    rows.append(("cove-forgotten-cave", "ORDER_SEQUENCE", list(RUNE_STONE_IDS), _cave()))
    rows.append(
        (
            "cove-lost-treasure",
            "ORDER_SEQUENCE",
            [torch for *_, torch in JOURNEY],
            _finale(),
        )
    )
    return rows


#: What Pip says to send the child to each chest's stage (`TreasureChest.clue`), replacing the
#: old clues only while they are still the seed's.
CLUES = {
    "cove-chest": (
        "My first chest is right here at Pirate Landing. Walk up to it and open it!",
        "My map is torn! Find the three pieces round the landing, then walk to the sign the map "
        "points to.",
    ),
    "cove-grove-chest": (
        "I hid a chest in Palm Tree Grove. Follow the flowers to the bushes!",
        "Cross Crocodile Creek on the stepping stones in the right order. My hidden chest in the "
        "grove will open!",
    ),
    "cove-beach-chest": (
        "A chest by the shipwreck is locked. Look for an X in the sand to find the key!",
        "Find the brass key on the X in the sand, then help me load my boat from the cargo "
        "crates by the chest.",
    ),
    "cove-ruins-pedestal": (
        "The ruins have a puzzle! Read the glowing pedestal, then touch the right rune stone.",
        "Find the three old carvings hidden in the ruins. Remember their dots, then press the "
        "rune stones.",
    ),
    "cove-final-chest": (
        "The golden chest is on the stone stage behind the pedestal. Open it!",
        "Light the four torches round the golden chest in the order of our adventure!",
    ),
}


# --- the snapshot the frontend tests read ---------------------------------------------------------

SNAPSHOT_PATH = Path(__file__).with_name("treasure_cove_stages.json")


def snapshot() -> dict:
    """Everything the client draws and parses for the stages, as the seed creates it."""
    return {
        "placements": placement_rows(),
        "standIns": stand_ins(),
        "puzzles": [
            {"puzzleId": puzzle_id, "kind": kind, "entityIds": entity_ids, "body": body}
            for puzzle_id, kind, entity_ids, body in puzzle_rows()
        ],
    }


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(snapshot(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()
