"""Firepeak Volcano's 3D Area and the first parameters of its puzzles (FP-2, FP-4 to FP-8).

Two kinds of content, kept apart as ADR-043 requires:

- **Layout** (code, ADR-033 item 4 and ADR-043 H; LAI-0805 decides later authoring): the 3D Area,
  spawn point, placements, colliders, effects (lava, steam, glow, checkpoints, stand-ins), and
  which mechanic each puzzle uses and which placements it binds.
- **Authored content** (Django-authoritative once seeded, ADR-043): the 3D Area's copy and each
  puzzle's per-age-band parameters, recorded as their first published versions (origin SEED).
  Administrators edit them in Django Admin; re-running this seed never overwrites anything.

Everything non-spatial (the Place, Professor Ember, the quest, items and reward rules) is catalog
content from the export (`react/src/features/content-export/firepeakContent.ts`): run
`load_content` first. Rows are created as DRAFT; `publish_firepeak` (development only) publishes.

Ages: Pathfinders and Explorers only (FP-D2). Pathfinders get visual guidance (stone outlines, a
visible steam path) and shorter text; Explorers reason from sizes and pipe labels. No puzzle asks
for arithmetic unrelated to it (FP-D5, FP-D6).

Asset ids are flat (FP-D4). The ten Firepeak models do not exist yet, so the seed creates their
asset definitions (Django-created `ContentAsset` rows with no version). The client draws a shaped
stand-in until an administrator uploads and publishes a GLB for that id in the Asset Manager;
the next visit then loads it, with no code change (`docs/regions/firepeak_assets.md`).
"""

import math

from django.db import transaction

from apps.catalog.models import (
    AssetCategory,
    AssetOrigin,
    ContentAsset,
    Location,
    NpcDefinition,
    Quest,
    RewardRule,
)

from .models import PlacementKind, PuzzleKind, SpawnPoint, WorldObjectPlacement, WorldRegion
from .seeding import record_seed_revision, seed_puzzle

REGION_ID = "firepeak-volcano"
PLACE_SLUG = "firepeak-volcano"
QUEST_ID = "the-volcano-awakens"
NPC_ID = "professor-ember"
EMBER_ENTITY = "firepeak-ember"

CHANGE = {
    "observed": "FIREPEAK_FEATURES_OBSERVED",
    "crossing": "FIREPEAK_CROSSING_REPAIRED",
    "steam": "FIREPEAK_STEAM_REDIRECTED",
    "crystal": "FIREPEAK_HEART_CRYSTAL_FOUND",
    "returned": "FIREPEAK_REPORTED_TO_EMBER",
}
SEALED_PASSAGE = "firepeak-sealed-passage"
FACING_VOLCANO = math.pi  # the controller faces +z at yaw 0; the volcano is toward -z

# (asset id, kind, category, display name): definitions awaiting their GLB (FP-3).
FIREPEAK_ASSETS = [
    ("firepeak-volcano-main", "kit-piece", AssetCategory.SCENERY, "Firepeak volcano"),
    ("firepeak-base-camp", "prop", AssetCategory.BUILDING, "Research tent"),
    ("firepeak-professor-ember", "character", AssetCategory.NPC, "Professor Ember"),
    ("firepeak-telescope", "prop", AssetCategory.EQUIPMENT, "Observation telescope"),
    ("firepeak-lava-crossing", "kit-piece", AssetCategory.SCENERY, "Lava river crossing"),
    ("firepeak-stone-platform", "prop", AssetCategory.PROP, "Movable stone platform"),
    ("firepeak-steam-valve", "prop", AssetCategory.EQUIPMENT, "Steam valve"),
    ("firepeak-steam-pipe", "prop", AssetCategory.SCENERY, "Steam pipe"),
    ("firepeak-crystal-cavern", "kit-piece", AssetCategory.SCENERY, "Crystal cavern formations"),
    (
        "firepeak-heart-crystal-fragment",
        "collectible",
        AssetCategory.COLLECTIBLE,
        "Heart Crystal fragment",
    ),
    ("firepeak-crystal-pedestal", "prop", AssetCategory.PROP, "Ancient pedestal"),
]

STONES = [
    ("firepeak-stone-small", -3.0),
    ("firepeak-stone-middle", 0.0),
    ("firepeak-stone-big", 3.0),
]
SLOTS = [("firepeak-gap-near", 9.5), ("firepeak-gap-middle", 6.5), ("firepeak-gap-far", 3.5)]
VALVES = [
    ("firepeak-valve-red", -3.2, -5.0, "Red valve"),
    ("firepeak-valve-blue", 3.2, -7.0, "Blue valve"),
    ("firepeak-valve-green", -3.2, -9.0, "Green valve"),
]


class SeedPrerequisiteMissing(LookupError):
    pass


def _scene() -> dict:
    """Bounds, environment, copy, colliders and effects. Positions are metres; z runs from Base
    Camp (+z) to the Crystal Chamber (-z)."""
    wall = 1.0
    return {
        "bounds": {"halfExtentX": 14, "halfExtentZ": 34, "wallThickness": wall},
        "environment": {"backgroundColor": 0x3B2A33},
        "groundAssetId": "ground-tile-stone",
        "copy": {
            "loading": "Hiking up to Firepeak base camp.",
            "instructions": "Talk to Professor Ember, then look through the telescope.",
            "calmStop": "The volcano is resting now, and so can you. Professor Ember will be here.",
            "altNavLabel": "Go back to the harbor",
        },
        "colliders": [
            # The steam passage is a corridor: rock on both sides from the far bank to the cavern.
            {
                "id": "firepeak-passage-wall-west",
                "minX": -14,
                "maxX": -4.5,
                "minZ": -15,
                "maxZ": -1,
            },
            {"id": "firepeak-passage-wall-east", "minX": 4.5, "maxX": 14, "minZ": -15, "maxZ": -1},
            # Opens when the steam is redirected (removed by the client from server state).
            {"id": SEALED_PASSAGE, "minX": -4.5, "maxX": 4.5, "minZ": -14, "maxZ": -12.5},
        ],
        "effects": {
            "lava": [
                {
                    "id": "firepeak-lava-river",
                    "minX": -14,
                    "maxX": 14,
                    "minZ": 1.5,
                    "maxZ": 11.5,
                    # Once the crossing is repaired, walking on the stones is safe.
                    "safe": [
                        {
                            "minX": -1.4,
                            "maxX": 1.4,
                            "minZ": 1.5,
                            "maxZ": 11.5,
                            "whenChangeKey": CHANGE["crossing"],
                        }
                    ],
                }
            ],
            "steam": [
                {
                    "id": "firepeak-passage-steam",
                    "x": 0,
                    "z": -13,
                    "height": 4,
                    "hiddenWhenChangeKey": CHANGE["steam"],
                },
                {
                    "id": "firepeak-sky-vent",
                    "x": 6,
                    "z": -30,
                    "height": 6,
                    "shownWhenChangeKey": CHANGE["steam"],
                },
            ],
            "lights": [
                {
                    "id": "firepeak-lava-glow",
                    "x": 0,
                    "y": 1.5,
                    "z": 6.5,
                    "color": 0xFF6A1A,
                    "intensity": 2.5,
                    "distance": 18,
                },
                {
                    "id": "firepeak-crystal-glow",
                    "x": 0,
                    "y": 2.0,
                    "z": -26,
                    "color": 0x7FE7FF,
                    "intensity": 3.0,
                    "distance": 14,
                },
            ],
            "backdrop": {
                "assetId": "firepeak-volcano-main",
                "x": 0,
                "z": -70,
                "radius": 30,
                "height": 34,
            },
            # Safe places the child can be returned to; each is open once its key exists.
            "checkpoints": [
                {"id": "base-camp", "label": "Base Camp", "x": 0, "z": 28, "yaw": FACING_VOLCANO},
                {
                    "id": "near-bank",
                    "label": "the lava river",
                    "x": 0,
                    "z": 13,
                    "yaw": FACING_VOLCANO,
                },
                {
                    "id": "far-bank",
                    "label": "the far bank",
                    "x": 0,
                    "z": 0,
                    "yaw": FACING_VOLCANO,
                    "whenChangeKey": CHANGE["crossing"],
                },
                {
                    "id": "crystal-chamber",
                    "label": "the crystal chamber",
                    "x": 0,
                    "z": -18,
                    "yaw": FACING_VOLCANO,
                    "whenChangeKey": CHANGE["steam"],
                },
            ],
            "openings": [{"colliderId": SEALED_PASSAGE, "whenChangeKey": CHANGE["steam"]}],
            # The safe way back once the crystal is found (FP stage 5): a glowing rope lift.
            "returns": [
                {
                    "entityId": "firepeak-return-lift",
                    "toCheckpoint": "base-camp",
                    "whenChangeKey": CHANGE["crystal"],
                    "label": "Ride the rope lift back to Base Camp",
                }
            ],
            # What to draw while a model is not published yet (FP-3).
            "standIns": [
                {"entityId": "firepeak-tent", "shape": "TENT", "color": 0xC9853A},
                {"entityId": "firepeak-telescope", "shape": "TELESCOPE", "color": 0x8C6A3F},
                {"entityId": "firepeak-pipes", "shape": "PIPE", "color": 0xB87333},
                {"entityId": "firepeak-pedestal", "shape": "PEDESTAL", "color": 0x6E6A7A},
                {"entityId": "firepeak-crystal", "shape": "CRYSTAL", "color": 0x7FE7FF},
                {
                    "entityId": "firepeak-crystal-cluster-west",
                    "shape": "CRYSTAL",
                    "color": 0xB58CFF,
                },
                {
                    "entityId": "firepeak-crystal-cluster-east",
                    "shape": "CRYSTAL",
                    "color": 0x7FE7FF,
                },
                {"entityId": "firepeak-return-lift", "shape": "PORTAL", "color": 0xFFD36B},
                *[
                    {"entityId": entity, "shape": "STONE", "color": 0x5B5450}
                    for entity, _ in STONES
                ],
                *[
                    {"entityId": entity, "shape": "VALVE", "color": 0xB33A3A}
                    for entity, *_ in VALVES
                ],
            ],
        },
    }


def _observe(band: str) -> dict:
    explorer = band == "EXPLORER"
    return {
        "intro": (
            "Firepeak is waking up! Look through my telescope and find three clues: the crater, "
            "the lava flow, and a steam vent."
            if explorer
            else "Look through my telescope. Can you find the crater, the lava, and the steam?"
        ),
        "features": [
            {
                "id": "crater",
                "label": "Crater",
                "explanation": (
                    "The crater is the bowl-shaped opening at the top. Gas and lava come out here."
                    if explorer
                    else "The crater is the big bowl at the top of the volcano."
                ),
            },
            {
                "id": "lava-flow",
                "label": "Lava flow",
                "explanation": (
                    "Lava is melted rock. Under the ground it is called magma; once it comes out "
                    "it is lava, and it cools into new rock."
                    if explorer
                    else "Lava is rock so hot that it melted. It glows orange."
                ),
            },
            {
                "id": "steam-vent",
                "label": "Steam vent",
                "explanation": (
                    "A steam vent is a crack where water underground is heated by magma and "
                    "escapes as steam."
                    if explorer
                    else "A steam vent is a crack that puffs out hot steam."
                ),
            },
        ],
        "hints": ["Look at the very top of the mountain first."],
        "completeMessage": (
            "Great observing! The steam and lava tell us magma is moving. Let us cross the "
            "lava river and look closer."
            if explorer
            else "You found all three! Now let us go look closer."
        ),
        "scienceNote": (
            "Scientists watch volcanoes from a safe distance with telescopes and cameras."
        ),
    }


def _platforms(band: str) -> dict:
    explorer = band == "EXPLORER"
    stone_ids = [entity for entity, _ in STONES]
    slot_ids = [entity for entity, _ in SLOTS]
    labels = ("Small stone", "Middle stone", "Long stone")
    stones = list(zip(stone_ids, labels, (1, 2, 3), strict=True))
    # Pathfinders: gaps in size order, with outlines. Explorers: mixed order, no outlines.
    gaps = (2, 3, 1) if explorer else (1, 2, 3)
    return {
        "intro": (
            "The old stone bridge fell into the lava. Each gap needs a stone exactly as long as "
            "the gap. Look at the gaps and choose wisely."
            if explorer
            else "Fill each gap with the stone that fits. The glowing outline shows the size."
        ),
        "stones": [{"id": i, "label": label, "size": size} for i, label, size in stones],
        "slots": [
            {"id": slot, "label": label, "gap": gap}
            for slot, label, gap in zip(
                slot_ids, ("Near gap", "Middle gap", "Far gap"), gaps, strict=True
            )
        ],
        "showOutlines": not explorer,
        "hintAfterAttempts": 2,
        "hints": (
            ["Compare each gap with each stone. A stone that is too short leaves a hole."]
            if explorer
            else ["Match the outline to the stone with the same size."]
        ),
        "completeMessage": "The crossing is safe now. Walk across the stones!",
        "scienceNote": "Basalt is a dark rock that forms when lava cools quickly.",
    }


def _valves(band: str) -> dict:
    explorer = band == "EXPLORER"
    red, blue, green = (entity for entity, *_ in VALVES)
    # Cause and effect: steam moves from channel to channel; a valve whose channel is empty does
    # nothing. Pathfinders see the steam's path; Explorers read the pipe labels.
    return {
        "intro": (
            "Hot steam is blocking the passage. Each valve moves steam from one pipe to another. "
            "Follow the steam to the sky vent."
            if explorer
            else "Turn the valves to send the steam out of the passage and up into the sky."
        ),
        "channels": [
            {"id": "passage", "label": "Passage"},
            {"id": "copper-pipe", "label": "Copper pipe"},
            {"id": "cooling-tank", "label": "Cooling tank"},
            {"id": "sky-vent", "label": "Sky vent"},
        ],
        "start": "passage",
        "goal": "sky-vent",
        "valves": [
            {"id": red, "label": "Red valve", "from": "passage", "to": "copper-pipe"},
            {"id": blue, "label": "Blue valve", "from": "copper-pipe", "to": "cooling-tank"},
            {"id": green, "label": "Green valve", "from": "cooling-tank", "to": "sky-vent"},
        ],
        "showSteamPath": not explorer,
        "hintAfterAttempts": 2,
        "hints": (
            [
                "Find the valve whose pipe starts in the passage.",
                "Then follow where it sends the steam.",
            ]
            if explorer
            else ["Turn the valve next to the steam first."]
        ),
        "completeMessage": "Whoosh! The steam goes up the sky vent and the passage opens.",
        "scienceNote": (
            "Steam is water heated until it turns into a gas. It pushes hard when it is trapped."
        ),
    }


def _crystal(band: str) -> dict:
    explorer = band == "EXPLORER"
    return {
        "intro": "Something is glowing on the old pedestal. Go and look!",
        "discoveryMessage": "You found the first Heart Crystal fragment!",
        "scienceNote": (
            "Real crystals grow when hot, mineral-rich liquid cools slowly and its tiny parts "
            "line up in a pattern. This one also glows with island magic."
            if explorer
            else "Crystals grow slowly as hot rock cools. This one also glows with island magic."
        ),
        "completeMessage": "Take it back to Professor Ember. The rope lift will carry you.",
    }


def _return(band: str) -> dict:
    return {
        "intro": "Show Professor Ember the crystal fragment.",
        "npcEntityId": EMBER_ENTITY,
        "completeMessage": (
            "Thank you, explorer! You have earned the Volcano Explorer Badge. There are more "
            "crystal secrets deeper in the mountain, for another day."
        ),
    }


def _body(puzzle_id, kind, title, change, factory, *, requires=(), reward=None) -> dict:
    return {
        "puzzleId": puzzle_id,
        "kind": kind,
        "title": title,
        "requiresChangeKeys": list(requires),
        "worldChangeKey": change,
        "rewardRuleId": reward,
        "ageBands": {band: factory(band) for band in ("PATHFINDER", "EXPLORER")},
    }


@transaction.atomic
def seed_firepeak() -> list[str]:
    """Create the rows that do not exist yet. Returns what was created."""
    created: list[str] = []

    def get_or_create(model, lookup: dict, values: dict):
        row, was_created = model.objects.get_or_create(**lookup, defaults=values)
        if was_created:
            created.append(f"{model.__name__} {row}")
        return row

    try:
        place = Location.objects.get(slug=PLACE_SLUG)
        ember = NpcDefinition.objects.get(npc_id=NPC_ID)
        quest = Quest.objects.get(slug=QUEST_ID)
        for rule in (
            "reward-firepeak-telescope",
            "reward-firepeak-crystal",
            "reward-firepeak-complete",
        ):
            RewardRule.objects.get(rule_id=rule)
    except (
        Location.DoesNotExist,
        NpcDefinition.DoesNotExist,
        Quest.DoesNotExist,
        RewardRule.DoesNotExist,
    ) as error:
        raise SeedPrerequisiteMissing("Run load_content first.") from error

    for asset_id, kind, category, name in FIREPEAK_ASSETS:
        get_or_create(
            ContentAsset,
            {"asset_id": asset_id},
            {
                "kind": kind,
                "origin": AssetOrigin.DJANGO,
                "category": category,
                "display_name": name,
                "description": (
                    "Firepeak Volcano model. Not delivered yet; the game draws a stand-in."
                ),
                "tags": ["firepeak"],
            },
        )

    region = get_or_create(
        WorldRegion,
        {"region_id": REGION_ID},
        {
            "location": place,
            "title": "Firepeak Volcano",
            "scene": _scene(),
            "age_bands": ["PATHFINDER", "EXPLORER"],  # FP-D2: no Sprouts
        },
    )
    get_or_create(
        SpawnPoint,
        {"region": region, "checkpoint_id": "base-camp"},
        {"label": "Base Camp", "x": 0.0, "z": 28.0, "yaw": FACING_VOLCANO, "is_default": True},
    )

    def place_it(entity_id, kind, label, x, z, *, asset="", npc=None, interaction="", **size):
        return get_or_create(
            WorldObjectPlacement,
            {"region": region, "entity_id": entity_id},
            {
                "kind": kind,
                "label": label,
                "asset_id": asset,
                "npc": npc,
                "interaction_id": interaction,
                "x": x,
                "z": z,
                **size,
            },
        )

    # A. Base Camp
    place_it(
        EMBER_ENTITY,
        PlacementKind.NPC,
        "Professor Ember",
        -3.0,
        22.0,
        asset="firepeak-professor-ember",
        npc=ember,
        interaction=ember.interaction_id,
        placeholder_height=1.7,
        placeholder_width=0.6,
        placeholder_depth=0.6,
    )
    place_it(
        "firepeak-tent",
        PlacementKind.PROP,
        "Research tent",
        -7.5,
        26.0,
        asset="firepeak-base-camp",
        placeholder_width=4.0,
        placeholder_height=2.6,
        placeholder_depth=3.0,
    )
    place_it(
        "firepeak-telescope",
        PlacementKind.PROP,
        "Telescope",
        4.0,
        20.0,
        asset="firepeak-telescope",
        placeholder_width=0.6,
        placeholder_height=1.6,
        placeholder_depth=0.6,
    )
    place_it(
        "firepeak-sign",
        PlacementKind.SCENERY,
        "Firepeak Volcano: please stay on the path",
        2.0,
        25.0,
        asset="signpost",
        placeholder_width=0.6,
        placeholder_height=1.6,
        placeholder_depth=0.2,
    )
    for index, (x, z) in enumerate([(-10, 30), (9, 27), (-9, 17), (10, 15)]):
        place_it(f"firepeak-rock-{index + 1}", PlacementKind.SCENERY, "", x, z, asset="rock")
    for index, (x, z) in enumerate([(7, 31), (-11, 22)]):
        place_it(f"firepeak-fern-{index + 1}", PlacementKind.SCENERY, "", x, z, asset="fern")

    # B. Lava River Crossing: three stones on the near bank, three gaps across the lava.
    for entity, x in STONES:
        place_it(
            entity,
            PlacementKind.PROP,
            "Stone",
            x,
            13.5,
            asset="firepeak-stone-platform",
            placeholder_width=1.0,
            placeholder_height=0.4,
            placeholder_depth=1.0,
        )
    for entity, z in SLOTS:
        place_it(
            entity,
            PlacementKind.PROP,
            "Gap in the crossing",
            0.0,
            z,
            placeholder_width=2.4,
            placeholder_height=0.1,
            placeholder_depth=2.4,
        )

    # C. Steam Vent Passage
    for entity, x, z, label in VALVES:
        place_it(
            entity,
            PlacementKind.PROP,
            label,
            x,
            z,
            asset="firepeak-steam-valve",
            placeholder_width=0.6,
            placeholder_height=1.0,
            placeholder_depth=0.3,
        )
    place_it(
        "firepeak-pipes",
        PlacementKind.SCENERY,
        "Steam pipes",
        0.0,
        -10.5,
        asset="firepeak-steam-pipe",
        placeholder_width=6.0,
        placeholder_height=0.6,
        placeholder_depth=0.6,
    )

    # D. Crystal Discovery Chamber
    place_it(
        "firepeak-pedestal",
        PlacementKind.PROP,
        "Ancient pedestal",
        0.0,
        -26.0,
        asset="firepeak-crystal-pedestal",
        placeholder_width=1.2,
        placeholder_height=1.0,
        placeholder_depth=1.2,
    )
    place_it(
        "firepeak-crystal",
        PlacementKind.COLLECTIBLE,
        "Glowing crystal",
        0.0,
        -25.4,
        asset="firepeak-heart-crystal-fragment",
        placeholder_width=0.4,
        placeholder_height=0.6,
        placeholder_depth=0.4,
        elevation=1.2,
    )
    place_it(
        "firepeak-crystal-cluster-west",
        PlacementKind.SCENERY,
        "Crystals",
        -7.0,
        -28.0,
        asset="firepeak-crystal-cavern",
        placeholder_width=2.0,
        placeholder_height=2.5,
        placeholder_depth=2.0,
    )
    place_it(
        "firepeak-crystal-cluster-east",
        PlacementKind.SCENERY,
        "Crystals",
        7.0,
        -24.0,
        asset="firepeak-crystal-cavern",
        placeholder_width=1.6,
        placeholder_height=2.0,
        placeholder_depth=1.6,
    )
    place_it(
        "firepeak-return-lift",
        PlacementKind.PROP,
        "Rope lift",
        5.0,
        -19.0,
        placeholder_width=1.2,
        placeholder_height=2.4,
        placeholder_depth=1.2,
    )

    puzzles = [
        (
            "firepeak-telescope",
            PuzzleKind.OBSERVE_FEATURES,
            ["firepeak-telescope"],
            _body(
                "firepeak-telescope",
                PuzzleKind.OBSERVE_FEATURES,
                "Look through the telescope",
                CHANGE["observed"],
                _observe,
                reward="reward-firepeak-telescope",
            ),
        ),
        (
            "firepeak-crossing",
            PuzzleKind.PLACE_PLATFORMS,
            [entity for entity, _ in STONES] + [entity for entity, _ in SLOTS],
            _body(
                "firepeak-crossing",
                PuzzleKind.PLACE_PLATFORMS,
                "Repair the lava crossing",
                CHANGE["crossing"],
                _platforms,
                requires=[CHANGE["observed"]],
            ),
        ),
        (
            "firepeak-steam",
            PuzzleKind.VALVE_SEQUENCE,
            [entity for entity, *_ in VALVES],
            _body(
                "firepeak-steam",
                PuzzleKind.VALVE_SEQUENCE,
                "Redirect the steam",
                CHANGE["steam"],
                _valves,
                requires=[CHANGE["crossing"]],
            ),
        ),
        (
            "firepeak-heart-crystal",
            PuzzleKind.COLLECT_OBJECT,
            ["firepeak-crystal"],
            _body(
                "firepeak-heart-crystal",
                PuzzleKind.COLLECT_OBJECT,
                "Discover the Heart Crystal",
                CHANGE["crystal"],
                _crystal,
                requires=[CHANGE["steam"]],
                reward="reward-firepeak-crystal",
            ),
        ),
        (
            "firepeak-return",
            PuzzleKind.RETURN_TO_NPC,
            [EMBER_ENTITY],
            _body(
                "firepeak-return",
                PuzzleKind.RETURN_TO_NPC,
                "Return to Professor Ember",
                CHANGE["returned"],
                _return,
                requires=[CHANGE["crystal"]],
                reward="reward-firepeak-complete",
            ),
        ),
    ]
    for order, (puzzle_id, kind, entity_ids, body) in enumerate(puzzles):
        _, was_created = seed_puzzle(
            region,
            puzzle_id=puzzle_id,
            kind=kind,
            entity_ids=entity_ids,
            body=body,
            sort_order=order,
        )
        if was_created:
            created.append(f"AreaPuzzle {REGION_ID}:{puzzle_id}")

    if not region.offered_quests.exists():
        region.offered_quests.add(quest)
    record_seed_revision(region)
    return created
