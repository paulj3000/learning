"""Treasure Cove's four-zone layout (TR-13), in the location manifest's own vocabulary.

The seed (`treasure_rush_seed.py`) writes this into `WorldRegion.scene["layout"]`, which the
client turns into manifest scenery, colliders, zones, ambient movers, lights, and the
`region-play` extension's procedural placeholders (`react/src/features/region-play/
regionLayout.ts`). Spatial layout is not Django-administered until LAI-0805's ADR (ADR-033), so
this module is its source of truth; the JSON stays editable in Django admin meanwhile.

Coordinates are metres. +X is east, +Z is north; the child arrives at the north dock and looks
south. Four zones, joined by paths and a loop:

- **Pirate Landing** (centre, x -10..10, z -2..30): the dock, Pip's camp, the first chest.
- **Palm Tree Grove** (west, x -36..-12): palms, boulders, and a trail of flowers that ends at
  a hiding place ringed by bushes.
- **Shipwreck Beach** (east, x 14..36): the wreck, washed-up cargo, an X in the sand.
- **Ancient Treasure Ruins** (south, x -14..14, z -36..-16): walls, an archway, a ring of
  pillars round a glowing pedestal, and a locked gate over the channel to Lookout Point. The
  three rune stones at `RUNE_STONES` are interactive placements (TR-14's puzzle), not layout.

`SPOTS` names where TR-14's encounters go; nothing is placed there yet beyond the scenery that
frames them. The models the cove lacks (tent, campfire, torch, flag, rowboat, pillar, pedestal,
gate) are `procedural` entries that the client draws from primitives until finished assets exist
(`docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`).

**Palms (TR-PALM-05).** Every palm is a `PALM` procedural entry that also names an asset library
model (`assetId`, one of the four `nature-palm-tree-*` ids the Quaternius pack import registers).
The client draws the published model at the entry's height and turning; while nothing is
published, or if the model fails, it draws the primitive palm in the same place. Positions,
models, heights and turnings are authored here, so every visit looks the same. Each trunk has a
small square collider (`PALM_TRUNK_HALF`); the fronds never block. `test_treasure_cove_layout.py`
keeps every palm clear of the paths, the encounter spots, the spawn point and the other scenery.

**Barrels and logs (TR-ENV-06).** `props` lists the barrels, logs and wood piles drawn from the
asset library (`prop-wooden-barrel`, `nature-wood-log`, `nature-wood-log-moss`,
`prop-wood-pile`). Each carries its own collider rectangles, sized from the prepared model
(`PROP_SIZES`): one square for an upright barrel, a short chain of squares along a log, so a
turned log never grows an invisible corner. The client adds a prop's colliders only once its
model is drawn, and then hides the older bundled barrels and logs its group `replaces`; until an
administrator publishes the models, those older ones stay, with no colliders, exactly as before.

Run `python -m apps.regions.treasure_cove_layout` from `lai/` to rewrite the JSON snapshot the
frontend tests load; `test_treasure_cove_layout.py` fails while the two differ.
"""

import json
import math
from pathlib import Path

from .treasure_cove_vegetation import vegetation as grow_vegetation

# Bump whenever the layout changes, so the seed refreshes an existing region's layout.
LAYOUT_VERSION = 7
BOUNDS = {"halfExtentX": 36, "halfExtentZ": 44, "wallThickness": 1}
SNAPSHOT_PATH = Path(__file__).with_name("treasure_cove_layout.json")

# Where TR-14 to TR-17 and TR-20 put things. The first chest (`cove-chest`, 0, -6) is seeded.
SPOTS = {
    "landing-chest": (0.0, -6.0),
    "grove-hidden-chest": (-30.0, 20.0),
    "beach-key": (31.0, 0.0),
    "beach-locked-chest": (21.0, 22.0),
    "ruins-pedestal": (0.0, -26.0),
    "ruins-final-chest": (0.0, -32.0),
    "ruins-gate": (0.0, -35.7),
    "lookout-point": (0.0, -42.5),
    "lookout-spyglass": (2.6, -41.6),
}

# TR-17: what the quest's completion (QUEST_COMPLETE_KEY, recorded by Django) opens. The client
# lifts the gate, takes the closed-channel collider out, lays the bridge and hides the sinking
# planks, on the visit it completes and on every later one. The side colliders of the channel
# stay, so the bridge is the only way across and nobody can step off it into the water.
UNLOCK = {
    "changeKey": "TREASURE_COVE_QUEST_COMPLETE",
    "openColliders": ["cove-ruins-gate:collider", "cove-channel-gap:collider"],
    "showWhenOpen": ["cove-bridge", "cove-lookout-lanterns"],
    "hideWhenOpen": ["cove-broken-bridge"],
    "liftGates": ["cove-ruins-gate"],
}
BRIDGE_HALF_WIDTH = 1.6

# TR-18: the water that shimmers and the fireflies that drift. Decoration only; the client holds
# both still when the device asks for reduced motion.
AMBIENCE = {
    "water": ["cove-channel", "cove-north-shallows", "cove-east-shallows"],
    "fireflies": [
        {"id": "cove-fireflies-grove", "x": -24, "z": 8, "radius": 9, "height": 2.4, "count": 28},
        {"id": "cove-fireflies-ruins", "x": 0, "z": -26, "radius": 10, "height": 3, "count": 24},
        {
            "id": "cove-fireflies-lookout",
            "x": 0,
            "z": -41.5,
            "radius": 6,
            "height": 2.6,
            "count": 16,
        },
    ],
}

SEA = 0x2F86B8
SHALLOWS = 0x7CC6D6
SAND = 0xE9D8A6
YARD = 0xC8A46A
GROVE_FLOOR = 0x5F9F48
JUNGLE_FLOOR = 0x4F8A3C
STONE = 0xA39B8B
DAIS = 0xC9B98F
GULL = 0xF4F4F0
GOLD_FLAG = 0xF2C94C


def _r(value: float) -> float:
    return round(value, 2)


def _rect(rect_id: str, min_x: float, max_x: float, min_z: float, max_z: float) -> dict:
    return {"id": rect_id, "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z}


def _along(points: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    """Evenly spaced points along a polyline, ends included."""
    out: list[tuple[float, float]] = [points[0]]
    for (ax, az), (bx, bz) in zip(points, points[1:], strict=False):
        length = math.hypot(bx - ax, bz - az)
        count = max(1, round(length / step))
        for index in range(1, count + 1):
            t = index / count
            out.append((ax + (bx - ax) * t, az + (bz - az) * t))
    return out


def _ring(cx: float, cz: float, radius: float, count: int, start: float = 0.0):
    return [
        (
            cx + radius * math.cos(start + 2 * math.pi * i / count),
            cz + radius * math.sin(start + 2 * math.pi * i / count),
        )
        for i in range(count)
    ]


def _positions(points, y: float | None = None, rotation_y=None, scale: dict | None = None):
    out = []
    for index, (x, z) in enumerate(points):
        position: dict = {"x": _r(x), "z": _r(z)}
        if y is not None:
            position["y"] = y
        if rotation_y is not None:
            angle = rotation_y(index) if callable(rotation_y) else rotation_y
            position["rotationY"] = _r(angle)
        if scale is not None:
            position["scale"] = scale
        out.append(position)
    return out


def _plane(plane_id: str, color: int, area: dict, y: float) -> dict:
    return {"kind": "FLAT_PLANE", "id": plane_id, "color": color, "area": area, "y": y}


def _cluster(cluster_id: str, asset_id: str, positions: list[dict]) -> dict:
    return {"kind": "CLUSTER", "id": cluster_id, "assetId": asset_id, "positions": positions}


def _wall(wall_id: str, min_x, max_x, min_z, max_z, height: float):
    """A stone ruin wall: a solid box and the collider that makes it solid."""
    area = _rect(f"{wall_id}:area", min_x, max_x, min_z, max_z)
    box = {"kind": "BOX", "id": wall_id, "color": STONE, "area": area, "minY": 0, "maxY": height}
    collider = {"rect": _rect(f"{wall_id}:collider", min_x, max_x, min_z, max_z)}
    return box, collider


def _procedural(proc_id: str, shape: str, x: float, z: float, **extra) -> dict:
    entry = {"id": proc_id, "shape": shape, "x": _r(x), "z": _r(z)}
    entry.update({key: value if key == "color" else _r(value) for key, value in extra.items()})
    return entry


def _palms(prefix: str, palms, turn: float, colliders: list[dict]) -> list[dict]:
    """PALM entries naming their model, with a varied height and turning, and trunk colliders."""
    out = []
    for i, (x, z, model) in enumerate(palms):
        palm_id = f"{prefix}-{i}"
        height = PALM_HEIGHTS[model] * (0.92 + 0.08 * (i % 3))
        out.append(
            _procedural(palm_id, "PALM", x, z, height=height, rotationY=(i * turn) % (2 * math.pi))
            | {"assetId": model}
        )
        colliders.append(_solid(f"{palm_id}:collider", x, z, PALM_TRUNK_HALF))
    return out


def _solid(collider_id: str, x: float, z: float, half: float) -> dict:
    return {"rect": _rect(collider_id, _r(x - half), _r(x + half), _r(z - half), _r(z + half))}


def _prop(prop_id: str, asset_id: str, x: float, z: float, yaw: float = 0.0, *, scale: float = 1.0,
          lying: bool = False) -> dict:
    """A drawn prop with the colliders that match its footprint at this turn and scale.

    The footprint is the model's length along its own X and its width along Z (a lying barrel's
    length is its height). The colliders are squares as wide as the prop, spread evenly from one
    end to the other, so their union hugs the prop at any turn.
    """
    length, width, height = PROP_SIZES[asset_id]
    if lying:
        length, height = height, width
    length, width = length * scale, width * scale
    count = max(1, math.ceil(length / width - 1e-9))
    spacing = 0.0 if count == 1 else (length - width) / (count - 1)
    along_x, along_z = math.cos(yaw), -math.sin(yaw)  # three.js: +X turned by `yaw` about +Y
    half = width / 2
    colliders = []
    for i in range(count):
        offset = -(length - width) / 2 + i * spacing
        cx, cz = x + along_x * offset, z + along_z * offset
        colliders.append(
            _rect(f"{prop_id}:collider-{i}", _r(cx - half), _r(cx + half), _r(cz - half), _r(cz + half))
        )
    entry = {"id": prop_id, "assetId": asset_id, "x": _r(x), "z": _r(z), "rotationY": _r(yaw)}
    if lying:
        entry["rotationZ"] = _r(math.pi / 2)
    if scale != 1.0:
        entry["scale"] = _r(scale)
    entry["colliders"] = colliders
    return entry


# --- Paths ------------------------------------------------------------------------------------

LANDING_TO_RUINS = [(0, -1), (0, -16)]
LANDING_TO_DOCK = [(0, 21), (0, 30)]
LANDING_TO_GROVE = [(-9, 8), (-14, 7), (-19, 9), (-23, 12)]
LANDING_TO_BEACH = [(9, 8), (14, 7), (19, 5), (23, 4)]
BEACH_TO_RUINS = [(19, 5), (14, -4), (7, -11), (0.8, -14.5)]
GROVE_TO_RUINS = [(-19, 9), (-18, -2), (-9, -10), (-0.8, -14.5)]
RUINS_AISLE = [(0, -17), (0, -23)]
# The clue for the hidden chest: flowers from the end of the grove path to the hiding place.
FLOWER_TRAIL = [(-23.5, 12.8), (-25.5, 15), (-27.5, 17.2), (-28.6, 18.4)]
# Every walkable line in the cove, for keeping scenery off it.
PATHS = [
    LANDING_TO_RUINS,
    LANDING_TO_DOCK,
    LANDING_TO_GROVE,
    LANDING_TO_BEACH,
    BEACH_TO_RUINS,
    GROVE_TO_RUINS,
    RUINS_AISLE,
    FLOWER_TRAIL,
]

# --- Palms (TR-PALM-05) -------------------------------------------------------------------------

# The asset library models (apps/assets/model_packs.py) and each one's nominal height in metres,
# which a palm's `height` varies around.
PALM_SMALL = "nature-palm-tree-small"
PALM_STANDARD = "nature-palm-tree-standard"
PALM_TALL = "nature-palm-tree-tall"
PALM_CURVED = "nature-palm-tree-curved"
PALM_HEIGHTS = {PALM_SMALL: 2.8, PALM_STANDARD: 4.6, PALM_TALL: 6.5, PALM_CURVED: 5.3}
# Half the side of the square trunk collider: wide enough to stop walking into the trunk, small
# enough that a palm beside a path never narrows it.
PALM_TRUNK_HALF = 0.3

# --- Barrels and logs (TR-ENV-06) ----------------------------------------------------------------

BARREL = "prop-wooden-barrel"
LOG = "nature-wood-log"
MOSS_LOG = "nature-wood-log-moss"
WOOD_PILE = "prop-wood-pile"
# Each prepared model's size at scale 1, in metres: length along its X, width along Z, height.
# They match the import's fit (apps/assets/model_packs.py), which a test checks.
PROP_SIZES = {
    BARREL: (0.77, 0.77, 1.0),
    LOG: (2.3, 0.68, 0.67),
    MOSS_LOG: (2.6, 0.87, 0.67),
    WOOD_PILE: (1.4, 1.16, 1.03),
}
# The older bundled scenery each model takes over once it is drawn.
PROP_REPLACES = {
    BARREL: [
        "cove-landing-barrels",
        "cove-beach-barrels",
        "cove-beach-lying-barrel-0",
        "cove-beach-lying-barrel-1",
        "cove-beach-lying-barrel-2",
    ],
    LOG: ["cove-campfire-logs", "cove-grove-logs"],
}
# Where each zone's barrels and logs go: (id, model, x, z, yaw, options). The landing's barrels
# and campfire logs and the beach's barrels stand about where the bundled ones did. Barrels that
# touch overlap their colliders, and every other gap is at least 0.6 m, so nobody slips through a
# crack between them or gets wedged against a wall.
LANDING_PROPS = [
    ("cove-landing-barrel-0", BARREL, -7.5, 18.4, 0.0, {}),
    ("cove-landing-barrel-1", BARREL, -8.2, 17.9, 0.7, {}),
    ("cove-landing-barrel-2", BARREL, 5, 18.5, 1.2, {}),
    ("cove-landing-barrel-3", BARREL, 5.6, 19.0, 2.1, {}),
    # Seats by the campfire.
    ("cove-landing-log-0", LOG, -7.3, 9.6, math.pi / 2, {"scale": 0.8}),
    ("cove-landing-log-1", LOG, -2.6, 10.7, math.pi + 0.2, {"scale": 0.8}),
]
BEACH_PROPS = [
    ("cove-beach-barrel-0", BARREL, 18.4, 20.4, 0.0, {}),
    ("cove-beach-barrel-1", BARREL, 20, 14, 0.4, {}),
    ("cove-beach-barrel-2", BARREL, 24, 6, 0.8, {}),
    ("cove-beach-barrel-3", BARREL, 33, 12, 1.2, {}),
    ("cove-beach-barrel-4", BARREL, 17.6, -1.2, 1.6, {}),
    # Washed up on their sides.
    ("cove-beach-barrel-5", BARREL, 25.4, 10.2, 0.3, {"lying": True}),
    ("cove-beach-barrel-6", BARREL, 18.2, 16.6, 1.9, {"lying": True}),
    ("cove-beach-barrel-7", BARREL, 31.6, 18.6, 2.6, {"lying": True}),
    # Driftwood along the shore.
    ("cove-beach-log-0", LOG, 34.4, 16.6, 1.45, {}),
    ("cove-beach-log-1", LOG, 28.6, 27.8, 0.15, {"scale": 0.9}),
    ("cove-beach-log-2", LOG, 34.8, -10.2, 1.75, {"scale": 1.1}),
    ("cove-beach-log-3", LOG, 27.8, -24.6, 0.65, {}),
]
GROVE_PROPS = [
    ("cove-grove-barrel-0", BARREL, -21.6, -3.6, 0.5, {}),
    ("cove-grove-barrel-1", BARREL, -27.8, 22.4, 1.1, {"lying": True}),
    ("cove-grove-log-0", LOG, -23.8, -8.6, 0.35, {}),
    ("cove-grove-log-1", LOG, -26.4, 9.6, 0.3, {}),
    ("cove-grove-log-2", MOSS_LOG, -31.4, -2.8, 0.6, {}),
    ("cove-grove-log-3", MOSS_LOG, -22.4, -15.0, 0.1, {}),
    ("cove-grove-log-4", MOSS_LOG, -34.2, 5.0, 1.5, {}),
    ("cove-grove-log-5", LOG, -18.6, 28.4, 0.25, {}),
    ("cove-grove-log-6", MOSS_LOG, -31.8, 28.4, 2.9, {}),
    ("cove-grove-log-7", WOOD_PILE, -27.6, -10.6, 0.4, {}),
]
RUINS_PROPS = [
    # A supply corner by the south-west wall, and another inside the north-east corner.
    ("cove-ruins-barrel-0", BARREL, -12.4, -33.8, 0.0, {}),
    ("cove-ruins-barrel-1", BARREL, -11.7, -34.2, 0.9, {}),
    ("cove-ruins-barrel-2", BARREL, 12.2, -17.8, 0.4, {}),
    ("cove-ruins-barrel-3", BARREL, 11.5, -18.2, 1.3, {}),
    ("cove-ruins-log-0", WOOD_PILE, -12.2, -24.4, math.pi / 2, {}),
    ("cove-ruins-log-1", LOG, 12.2, -27.4, math.pi / 2, {"scale": 0.8}),
    ("cove-ruins-log-2", LOG, -8.2, -18.6, 0.1, {"scale": 0.8}),
]
LOOKOUT_PROPS = [
    ("cove-lookout-barrel-0", BARREL, -8.6, -41.6, 0.6, {}),
    ("cove-lookout-log-0", LOG, 9.8, -42.6, 0.1, {"scale": 0.9}),
]


S, M, T, C = PALM_SMALL, PALM_STANDARD, PALM_TALL, PALM_CURVED
GROVE_PALMS = [
    (-15, 14, T),
    (-18, 21, M),
    (-16, 25, C),
    (-21, 27, T),
    (-25, 23, M),
    (-15, -0.5, C),  # was (-14, -3), on the grove path
    (-21, -7, T),
    (-24, -12, M),
    (-28, -4, C),
    (-32, 2, T),
    (-31, 8, S),
    (-26, 5, M),
    (-34, 15, C),
    (-29, 27, S),
    (-34, 24, T),
    (-22, 17, C),
    (-13, 2, M),
    (-33, -9, S),
    (-17, -13, T),
]
GROVE_TREES = [(-35, -12), (-33, -14), (-35, 10), (-26, -15), (-35, 28), (-26, 29), (-13, 28)]
HIDING_BUSHES = _ring(-30, 20, 1.9, 7, start=math.radians(-20))[:6]  # open to the south-east
GROVE_BUSHES = [(-16, 18), (-20, 13), (-27, 1), (-31, -6), (-23, 25), (-15, -8), (-33, 6)]
GROVE_FERNS = [
    (-17, 16),
    (-24, 20),
    (-22, 6),
    (-29, 12),
    (-33, 12),
    (-27, -8),
    (-19, -11),
    (-31, 24),
    (-14, 22),
    (-25, -2),
]
GROVE_FLOWERS = [(-16, 10), (-20, 24), (-30, -1), (-13, -6), (-26, 26)]
GROVE_BOULDERS = [(-28.6, 16.6), (-27.4, 17.4), (-32.4, 18.8)]

# --- Shipwreck Beach --------------------------------------------------------------------------

WRECK = (27.0, 16.0)
WRECK_YAW = 0.5
BEACH_PALMS = [
    (17.5, -6.5, C),  # was (15, -4), on the beach path
    (18, -10, T),
    (33.6, 2.8, C),  # was (32, 1.6), beside the key spot
    (14, 24, M),
    (30, -12, T),
    (22, -14, C),
    (34, -4, M),
    # TR-PALM-05: shoreline clusters along the east shallows and the south of the beach.
    (34.2, 9.2, T),
    (31.6, 26.4, C),
    (26.5, -20.5, M),
    (21, -24.5, S),
]
# Pirate Landing: palms framing the dock you arrive on, and one by the path south. All stand
# well off the yard, so Pip, the camp and the first chest stay in plain view.
LANDING_PALMS = [(-8.8, 24.4, T), (8.6, 25.6, C), (-5.8, 28.8, M), (5.6, 29.2, S), (-9.2, 1.4, M)]
CARGO_CRATES = [(19.4, 23.2), (20.2, 24.0), (22.8, 23.4), (16, 18), (23, 9), (30, 8), (34, 20)]
BEACH_BARRELS = [(19.6, 21.0), (20, 14), (24, 6), (33, 12), (17, -2)]
DRIFT_PLANKS = [(17, 18.8), (25, 25), (28.8, 4.4), (22, 0), (33.4, -8)]
BEACH_ROPES = [(26, 22.5), (29.6, -0.8)]
PIER_STUBS = [(33.6, 24), (34.4, 26), (33.6, 28)]
SHORE_ROCKS = [(35, -14), (34.6, -20), (33.8, 6), (35.2, 14), (31, -24), (25, -27)]

# --- Ancient Treasure Ruins -------------------------------------------------------------------

PEDESTAL = SPOTS["ruins-pedestal"]
RUIN_PILLARS = _ring(PEDESTAL[0], PEDESTAL[1], 7, 8, start=math.pi / 8)
RUNE_STONES = [(-3.0, -23.0), (3.0, -23.0), (0.0, -29.4)]
# Where people stand or meet something: the spawn point, Pip and the first chest's helpers
# (treasure_rush_seed), the encounter spots and the rune stones. Scenery keeps clear of them.
KEEP_CLEAR = [(0.0, 10.0), (0.0, -6.0), (3.0, 6.0), (-3.0, 6.0), *SPOTS.values(), *RUNE_STONES]
# Palms in the ruins' corners, clear of the walls, the pillars, the aisle and the gate.
RUINS_PALMS = [(-10.6, -20.4, M), (10.4, -32.4, C), (-10.4, -31.2, S), (9.8, -22.8, M)]
# Lookout Point: the two that frame the flag, and two at the far ends of the sand, so the view
# out to sea and the spyglass stay open.
LOOKOUT_PALMS = [(-4, -42.6, T), (5.4, -42.8, C), (-15, -42.4, M), (16, -42.6, T)]
RUBBLE = [
    (-12, -19),
    (-11, -33),
    (12, -21),
    (11, -31),
    (-6, -34),
    (7, -18),
    (-9, -27),
    (10, -26),
]


def cove_layout() -> dict:
    scenery: list[dict] = []
    colliders: list[dict] = []
    procedural: list[dict] = []

    # Ground and water, lowest first. The tiled grass the client always lays covers the bounds.
    scenery += [
        _plane("cove-sea", SEA, _rect("cove-sea:area", -160, 160, -160, 160), -0.06),
        _plane(
            "cove-jungle-floor",
            JUNGLE_FLOOR,
            _rect("cove-jungle-floor:area", -90, -36, -90, 90),
            -0.02,
        ),
        _plane(
            "cove-grove-floor",
            GROVE_FLOOR,
            _rect("cove-grove-floor:area", -36, -12, -16, 30),
            0.008,
        ),
        _plane("cove-north-sand", SAND, _rect("cove-north-sand:area", -36, 36, 30, 44), 0.01),
        _plane("cove-east-sand", SAND, _rect("cove-east-sand:area", 14, 36, -30, 30), 0.01),
        _plane("cove-landing-yard", YARD, _rect("cove-landing-yard:area", -9, 9, -1, 21), 0.012),
        _plane(
            "cove-north-shallows",
            SHALLOWS,
            _rect("cove-north-shallows:area", -36, 36, 40.5, 44),
            0.02,
        ),
        _plane(
            "cove-east-shallows",
            SHALLOWS,
            _rect("cove-east-shallows:area", 32.5, 36, -30, 44),
            0.02,
        ),
        _plane("cove-channel", SEA, _rect("cove-channel:area", -36, 36, -40.4, -36.4), 0.02),
        # Lookout Point (TR-17): sand beyond the channel, and a stone plaza round the flag.
        _plane(
            "cove-lookout-sand", SAND, _rect("cove-lookout-sand:area", -36, 36, -44, -40.4), 0.01
        ),
        _plane(
            "cove-lookout-plaza", DAIS, _rect("cove-lookout-plaza:area", -5, 5, -44, -40.4), 0.02
        ),
        _plane("cove-dais", DAIS, _rect("cove-dais:area", -3, 3, -34.5, -30.5), 0.02),
        {
            "kind": "TILED_GROUND",
            "id": "cove-ruins-floor",
            "assetId": "ground-tile-stone",
            "area": _rect("cove-ruins-floor:area", -14, 14, -36, -16),
            "tileSize": 4,
            "y": 0.015,
        },
    ]

    # Paths: a hair above the ground, since `path` is a flat quad.
    town_path = (
        _along(LANDING_TO_RUINS, 1.5)
        + _along(LANDING_TO_DOCK, 1.5)
        + _along(LANDING_TO_BEACH, 1.5)
        + _along(BEACH_TO_RUINS, 1.5)
        + _along(RUINS_AISLE, 1.5)
    )
    grove_path = _along(LANDING_TO_GROVE, 1.5) + _along(GROVE_TO_RUINS, 1.5)
    scenery += [
        _cluster("cove-paths", "path", _positions(town_path, y=0.03)),
        _cluster("cove-grove-paths", "path-forest", _positions(grove_path, y=0.03)),
    ]

    # Pirate Landing: the dock you arrive on, the camp, the flag, the waymarkers.
    dock = [(x, z) for z in (31.5, 34.5, 37.5, 40.5) for x in (-0.45, 0.45)]
    scenery += [
        _cluster("cove-dock", "bridge-plank", _positions(dock, y=0.12)),
        _cluster(
            "cove-dock-posts",
            "mooring-post",
            _positions([(-1.3, 33), (1.3, 33), (-1.3, 39), (1.3, 39)]),
        ),
        _cluster(
            "cove-landing-crates",
            "crate",
            _positions([(6.5, 15), (7.3, 15), (6.9, 15.8)]) + [{"x": 6.9, "z": 15.3, "y": 0.8}],
        ),
        _cluster(
            "cove-landing-barrels",
            "barrel",
            _positions([(-7.5, 18), (-8.2, 17.4), (5, 18.5), (5.7, 19)]),
        ),
        _cluster("cove-landing-ropes", "rope-coil", _positions([(1.6, 19), (-1.8, 22)])),
        _cluster(
            "cove-campfire-logs",
            "log-fallen",
            _positions([(-6.9, 8.4), (-3.1, 10.6)], rotation_y=lambda i: (0.2, math.pi + 0.2)[i]),
        ),
        _cluster(
            "cove-waymarkers",
            "signpost",
            _positions(
                [(-10.5, 10), (10.5, 10), (1.8, -2.5)], rotation_y=lambda i: (1.57, -1.57, 0)[i]
            ),
        ),
    ]
    colliders += [
        {"rect": _rect("cove-landing-crates:collider", 6, 7.8, 14.5, 16.3)},
        {"rect": _rect("cove-tent:collider", -7.6, -4.4, 13.4, 16.6)},
        _solid("cove-campfire:collider", -5, 9.5, 0.8),
    ]
    procedural += [
        _procedural("cove-tent", "TENT", -6, 15, rotationY=0.4),
        _procedural("cove-campfire", "CAMPFIRE", -5, 9.5),
        _procedural("cove-landing-flag", "FLAG", 8, 3, height=5),
        _procedural("cove-rowboat", "ROWBOAT", 2.6, 41, rotationY=0.2),
        *[
            _procedural(f"cove-landing-torch-{i}", "TORCH", x, z)
            for i, (x, z) in enumerate(
                [(-8.5, 6.5), (-8.5, 9.5), (8.5, 6.5), (8.5, 9.5), (-1.4, -1), (1.4, -1)]
            )
        ],
    ]

    # Palm Tree Grove.
    scenery += [
        _cluster(
            "cove-grove-trees",
            "foliage-tree",
            _positions(GROVE_TREES, scale={"x": 1.3, "y": 1.3, "z": 1.3}),
        ),
        _cluster(
            "cove-hiding-bushes",
            "foliage-bush",
            _positions(
                HIDING_BUSHES, rotation_y=lambda i: i * 1.1, scale={"x": 3, "y": 3.2, "z": 3}
            ),
        ),
        _cluster(
            "cove-grove-bushes",
            "foliage-bush",
            _positions(
                GROVE_BUSHES, rotation_y=lambda i: i * 0.7, scale={"x": 2.6, "y": 2.6, "z": 2.6}
            ),
        ),
        _cluster(
            "cove-grove-ferns",
            "fern",
            _positions(
                GROVE_FERNS, rotation_y=lambda i: i * 0.9, scale={"x": 1.3, "y": 1.3, "z": 1.3}
            ),
        ),
        _cluster(
            "cove-flower-trail",
            "flower-cluster",
            _positions(
                _along(FLOWER_TRAIL, 1.0),
                rotation_y=lambda i: i * 0.8,
                scale={"x": 1.4, "y": 1.4, "z": 1.4},
            ),
        ),
        _cluster(
            "cove-grove-flowers",
            "flower-cluster",
            _positions(GROVE_FLOWERS, rotation_y=lambda i: i),
        ),
        _cluster(
            "cove-grove-boulders",
            "rock",
            _positions(
                GROVE_BOULDERS, rotation_y=lambda i: i * 1.3, scale={"x": 4.5, "y": 4, "z": 4}
            ),
        ),
        _cluster(
            "cove-grove-logs",
            "log-fallen",
            _positions([(-20, -2), (-26, 13.6)], rotation_y=lambda i: (1.2, 0.3)[i]),
        ),
        {
            "kind": "SCATTER",
            "id": "cove-jungle",
            "assetId": "foliage-tree",
            "area": _rect("cove-jungle:area", -60, -37, -60, 60),
            "spacing": 3.5,
            "seed": 13,
            "clearance": 1,
        },
    ]
    colliders += [
        _solid(f"cove-grove-boulder-{i}:collider", x, z, 0.6)
        for i, (x, z) in enumerate(GROVE_BOULDERS)
    ]
    procedural += _palms("cove-grove-palm", GROVE_PALMS, 0.9, colliders)

    # Shipwreck Beach.
    lying_barrel_yaws = [0.3, 1.9, 2.6]
    scenery += [
        {
            "kind": "MODEL",
            "id": "cove-shipwreck",
            "assetId": "shipwreck",
            "position": {"x": WRECK[0], "y": 0, "z": WRECK[1]},
            "rotation": {"x": 0, "y": WRECK_YAW, "z": 0.1},
            "scale": {"x": 1.5, "y": 1.5, "z": 1.5},
            "placeholderSize": {"width": 9.6, "height": 9, "depth": 3.9},
        },
        _cluster(
            "cove-beach-crates", "crate", _positions(CARGO_CRATES, rotation_y=lambda i: i * 0.6)
        ),
        _cluster(
            "cove-beach-barrels", "barrel", _positions(BEACH_BARRELS, rotation_y=lambda i: i * 0.4)
        ),
        *[
            {
                "kind": "MODEL",
                "id": f"cove-beach-lying-barrel-{i}",
                "assetId": "barrel",
                "position": {"x": x, "y": 0.33, "z": z},
                "rotation": {"x": 0, "y": yaw, "z": 1.5708},
            }
            for i, ((x, z), yaw) in enumerate(
                zip([(25.4, 10.2), (18.2, 16.6), (31.6, 18.6)], lying_barrel_yaws, strict=True)
            )
        ],
        _cluster(
            "cove-drift-planks",
            "bridge-plank",
            _positions(DRIFT_PLANKS, y=0.02, rotation_y=lambda i: i * 1.3),
        ),
        _cluster("cove-beach-ropes", "rope-coil", _positions(BEACH_ROPES)),
        _cluster(
            "cove-pier-stubs",
            "mooring-post",
            _positions(PIER_STUBS, scale={"x": 1, "y": 0.7, "z": 1}),
        ),
        _cluster(
            "cove-shore-rocks",
            "rock",
            _positions(
                SHORE_ROCKS, rotation_y=lambda i: i * 0.8, scale={"x": 3.5, "y": 3, "z": 3.5}
            ),
        ),
        # The clue for the key: an X in the sand, two planks crossed flat.
        *[
            {
                "kind": "MODEL",
                "id": f"cove-x-mark-{i}",
                "assetId": "bridge-plank",
                "position": {"x": SPOTS["beach-key"][0], "y": 0.02, "z": SPOTS["beach-key"][1]},
                "rotation": {"x": 0, "y": yaw, "z": 0},
                "scale": {"x": 0.35, "y": 0.4, "z": 0.6},
            }
            for i, yaw in enumerate([0.785, -0.785])
        ],
    ]
    axis_x, axis_z = math.cos(WRECK_YAW), -math.sin(WRECK_YAW)
    for i, offset in enumerate((2.4, -2.4)):
        cx, cz = WRECK[0] + axis_x * offset, WRECK[1] + axis_z * offset
        colliders.append(
            {
                "rect": _rect(
                    f"cove-shipwreck-{i}:collider",
                    _r(cx - 2.6),
                    _r(cx + 2.6),
                    _r(cz - 2),
                    _r(cz + 2),
                )
            }
        )
    colliders.append({"rect": _rect("cove-cargo:collider", 19, 23.2, 22.8, 24.4)})
    procedural += _palms("cove-beach-palm", BEACH_PALMS, 1.7, colliders)

    # Ancient Treasure Ruins: an outer wall, the archway on the north side, the gate on the south.
    walls = [
        ("cove-ruin-north-0", -14, -10, -16.6, -16, 2.6),
        ("cove-ruin-north-1", -10, -7, -16.6, -16, 1.2),
        ("cove-ruin-north-2", -7, -2, -16.6, -16, 2.2),
        ("cove-ruin-north-3", 2, 6, -16.6, -16, 2.4),
        ("cove-ruin-north-4", 6, 9, -16.6, -16, 0.9),
        ("cove-ruin-north-5", 9, 14, -16.6, -16, 2.6),
        ("cove-ruin-west-0", -14, -13.4, -36, -30, 2.4),
        ("cove-ruin-west-1", -14, -13.4, -30, -26, 1.0),
        ("cove-ruin-west-2", -14, -13.4, -26, -20, 2.8),
        ("cove-ruin-west-3", -14, -13.4, -20, -16.6, 1.6),
        ("cove-ruin-east-0", 13.4, 14, -36, -30, 2.6),
        ("cove-ruin-east-1", 13.4, 14, -30, -24, 1.1),
        ("cove-ruin-east-2", 13.4, 14, -24, -16.6, 2.4),
        ("cove-ruin-south-0", -14, -2, -36, -35.4, 3),
        ("cove-ruin-south-1", 2, 14, -36, -35.4, 3),
    ]
    for wall in walls:
        box, collider = _wall(*wall)
        scenery.append(box)
        colliders.append(collider)
    scenery += [
        {
            "kind": "MODEL",
            "id": "cove-ruins-archway",
            "assetId": "archway",
            "position": {"x": 0, "y": 0, "z": -16.3},
            "scale": {"x": 1.55, "y": 1.25, "z": 1},
        },
        _cluster(
            "cove-ruins-rubble",
            "rock",
            _positions(RUBBLE, rotation_y=lambda i: i * 0.9, scale={"x": 2.5, "y": 2, "z": 2.5}),
        ),
    ]
    colliders += [
        _solid(f"cove-pillar-{i}:collider", x, z, 0.45) for i, (x, z) in enumerate(RUIN_PILLARS)
    ]
    # The rune stones are TR-14's puzzle answers, placed by the seed; solid like the pillars.
    colliders += [
        _solid(f"cove-rune-stone-{i}:collider", x, z, 0.3) for i, (x, z) in enumerate(RUNE_STONES)
    ]
    colliders += [
        _solid("cove-pedestal:collider", PEDESTAL[0], PEDESTAL[1], 0.8),
        # Closed until the quest is complete (UNLOCK.openColliders).
        {"rect": _rect("cove-ruins-gate:collider", -2, 2, -36, -35.4)},
        # The channel (TR-17): the sides always hold; the gap under the bridge is closed until
        # the quest is complete (UNLOCK.openColliders), then it is the only way across.
        {"rect": _rect("cove-channel-west:collider", -37, -BRIDGE_HALF_WIDTH, -40.4, -36.4)},
        {"rect": _rect("cove-channel-east:collider", BRIDGE_HALF_WIDTH, 37, -40.4, -36.4)},
        {
            "rect": _rect(
                "cove-channel-gap:collider", -BRIDGE_HALF_WIDTH, BRIDGE_HALF_WIDTH, -40.4, -36.4
            )
        },
    ]
    procedural += [
        *[
            _procedural(
                f"cove-ruin-pillar-{i}", "PILLAR", x, z, height=(3.2 if i % 2 == 0 else 1.4)
            )
            for i, (x, z) in enumerate(RUIN_PILLARS)
        ],
        _procedural("cove-pedestal", "PEDESTAL", *PEDESTAL),
        _procedural("cove-ruins-gate", "GATE", *SPOTS["ruins-gate"]),
        # The way on, broken: two planks sinking in the channel beyond the gate. TR-17 hides
        # them and lays the bridge once the quest is complete.
        _procedural("cove-broken-bridge", "BROKEN_PLANKS", 0, -38.2),
        _procedural("cove-bridge", "BRIDGE", 0, -37.9, height=5.6),
        _procedural("cove-lookout-lanterns", "LANTERNS", 0, -41.2),
        # The spyglass at Lookout Point (TR-20's replay activity stands here).
        _procedural("cove-lookout-spyglass", "SPYGLASS", *SPOTS["lookout-spyglass"]),
        _procedural("cove-final-torch-0", "TORCH", -2.6, -32.6),
        _procedural("cove-final-torch-1", "TORCH", 2.6, -32.6),
        _procedural("cove-arch-torch-0", "TORCH", -2.4, -15.4),
        _procedural("cove-arch-torch-1", "TORCH", 2.4, -15.4),
        # Lookout Point, seen across the channel: the goal the gate keeps from you.
        _procedural(
            "cove-lookout-flag", "FLAG", *SPOTS["lookout-point"], height=7, color=GOLD_FLAG
        ),
    ]
    procedural += _palms("cove-landing-palm", LANDING_PALMS, 2.3, colliders)
    procedural += _palms("cove-ruins-palm", RUINS_PALMS, 1.1, colliders)
    procedural += _palms("cove-lookout-palm", LOOKOUT_PALMS, 2.1, colliders)

    zones = [
        {
            "rect": _rect("cove-zone-landing", -10, 10, -2, 30),
            "enterMessage": "Pirate Landing. This is Pip's camp.",
        },
        {
            "rect": _rect("cove-zone-grove", -36, -12, -16, 30),
            "enterMessage": "Palm Tree Grove. Lots of places to hide things here!",
        },
        {
            "rect": _rect("cove-zone-beach", 14, 36, -30, 30),
            "enterMessage": "Shipwreck Beach. What a big old ship!",
        },
        {
            "rect": _rect("cove-zone-ruins", -14, 14, -36, -16),
            "enterMessage": "The Ancient Treasure Ruins. Something is glowing.",
        },
        # SM-P7: the sand and plaza at Lookout Point, beyond the gate. Reaching it still needs the
        # bridge (TR-17); this volume only lets the audio know the child is there. No geometry,
        # collider or route changes.
        {
            "rect": _rect("cove-zone-lookout", -36, 36, -44, -40.4),
            "enterMessage": "Lookout Point. The whole sea is out there!",
        },
    ]

    def loop(cx, cz, radius, y, count=6):
        return [{"x": _r(x), "y": y, "z": _r(z)} for x, z in _ring(cx, cz, radius, count)]

    ambient = [
        {
            "kind": "SPLINE_LOOP",
            "id": "cove-gull-wreck",
            "path": loop(WRECK[0], WRECK[1], 7, 9),
            "loopsPerSecond": 0.04,
            "appearance": {"primitive": "CONE", "color": GULL},
        },
        {
            "kind": "SPLINE_LOOP",
            "id": "cove-gull-dock",
            "path": loop(-4, 36, 6, 7.5),
            "loopsPerSecond": 0.05,
            "appearance": {"primitive": "CONE", "color": GULL},
        },
        {
            "kind": "SPLINE_LOOP",
            "id": "cove-butterfly-hiding",
            "path": loop(-29.5, 19.5, 1.8, 0.7),
            "loopsPerSecond": 0.12,
            "appearance": {"assetId": "butterfly"},
        },
        {
            "kind": "SPLINE_LOOP",
            "id": "cove-butterfly-flowers",
            "path": loop(-17, 9, 2.2, 0.8),
            "loopsPerSecond": 0.1,
            "appearance": {"assetId": "butterfly"},
        },
    ]

    lights = [
        {
            "id": "cove-campfire-light",
            "kind": "POINT",
            "position": {"x": -5, "y": 0.9, "z": 9.5},
            "color": 0xFFA040,
            "intensity": 1.2,
            "distance": 8,
        },
        {
            "id": "cove-pedestal-light",
            "kind": "POINT",
            "position": {"x": PEDESTAL[0], "y": 1.8, "z": PEDESTAL[1]},
            "color": 0x7FE3FF,
            "intensity": 1.5,
            "distance": 7,
        },
    ]

    props = [
        _prop(prop_id, asset_id, x, z, yaw, **options)
        for prop_id, asset_id, x, z, yaw, options in (
            LANDING_PROPS + BEACH_PROPS + GROVE_PROPS + RUINS_PROPS + LOOKOUT_PROPS
        )
    ]
    # ENV-2: bushes, flowers and grass round the palms and props, clear of every path and spot.
    vegetation = grow_vegetation(
        {
            "scenery": scenery,
            "colliders": colliders,
            "procedural": procedural,
            "props": props,
            "zones": zones,
        },
        paths=PATHS,
        keep_clear=KEEP_CLEAR,
    )

    return {
        "scenery": scenery,
        "colliders": colliders,
        "props": props,
        "propReplaces": PROP_REPLACES,
        "vegetation": vegetation,
        "zones": zones,
        "ambient": ambient,
        "lights": lights,
        "procedural": procedural,
        "unlock": UNLOCK,
        "ambience": AMBIENCE,
    }


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(cove_layout(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)
