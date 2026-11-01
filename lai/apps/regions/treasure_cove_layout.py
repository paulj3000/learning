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
frames them. The models the cove lacks (palm, tent, campfire, torch, flag, rowboat, pillar,
pedestal, gate) are `procedural` entries that the client draws from primitives until finished
assets exist (`docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`).

Run `python -m apps.regions.treasure_cove_layout` from `lai/` to rewrite the JSON snapshot the
frontend tests load; `test_treasure_cove_layout.py` fails while the two differ.
"""

import json
import math
from pathlib import Path

# Bump whenever the layout changes, so the seed refreshes an existing region's layout.
LAYOUT_VERSION = 3
BOUNDS = {"halfExtentX": 36, "halfExtentZ": 44, "wallThickness": 1}
SNAPSHOT_PATH = Path(__file__).with_name("treasure_cove_layout.json")

# Where TR-14 to TR-17 put things. The first chest (`cove-chest`, 0, -6) is already seeded.
SPOTS = {
    "landing-chest": (0.0, -6.0),
    "grove-hidden-chest": (-30.0, 20.0),
    "beach-key": (31.0, 0.0),
    "beach-locked-chest": (21.0, 22.0),
    "ruins-pedestal": (0.0, -26.0),
    "ruins-final-chest": (0.0, -32.0),
    "ruins-gate": (0.0, -35.7),
    "lookout-point": (0.0, -42.5),
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


def _solid(collider_id: str, x: float, z: float, half: float) -> dict:
    return {"rect": _rect(collider_id, _r(x - half), _r(x + half), _r(z - half), _r(z + half))}


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

# --- Palm Tree Grove --------------------------------------------------------------------------

GROVE_PALMS = [
    (-15, 14),
    (-18, 21),
    (-16, 25),
    (-21, 27),
    (-25, 23),
    (-14, -3),
    (-21, -7),
    (-24, -12),
    (-28, -4),
    (-32, 2),
    (-31, 8),
    (-26, 5),
    (-34, 15),
    (-29, 27),
    (-34, 24),
    (-22, 17),
    (-13, 2),
    (-33, -9),
    (-17, -13),
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
BEACH_PALMS = [(15, -4), (18, -10), (32, 1.6), (14, 24), (30, -12), (22, -14), (34, -4)]
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
    procedural += [
        _procedural(
            f"cove-grove-palm-{i}", "PALM", x, z, height=4.6 + (i % 4) * 0.5, rotationY=i * 0.9
        )
        for i, (x, z) in enumerate(GROVE_PALMS)
    ]

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
    procedural += [
        _procedural(
            f"cove-beach-palm-{i}", "PALM", x, z, height=5 + (i % 3) * 0.6, rotationY=i * 1.7
        )
        for i, (x, z) in enumerate(BEACH_PALMS)
    ]

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
        # The way on, broken: two planks sinking in the channel beyond the gate (TR-17 mends it).
        _cluster(
            "cove-broken-bridge",
            "bridge-plank",
            [
                {"x": -0.45, "z": -37.9, "y": -0.05, "rotationY": 0.1},
                {"x": 0.5, "z": -38.6, "y": -0.08, "rotationY": -0.18},
            ],
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
        {"rect": _rect("cove-ruins-gate:collider", -2, 2, -36, -35.4)},
        # The channel: nobody crosses to Lookout Point until the gate and bridge open (TR-17).
        {"rect": _rect("cove-channel:collider", -37, 37, -40.4, -36.4)},
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
        _procedural("cove-final-torch-0", "TORCH", -2.6, -32.6),
        _procedural("cove-final-torch-1", "TORCH", 2.6, -32.6),
        _procedural("cove-arch-torch-0", "TORCH", -2.4, -15.4),
        _procedural("cove-arch-torch-1", "TORCH", 2.4, -15.4),
        # Lookout Point, seen across the channel: the goal the gate keeps from you.
        _procedural(
            "cove-lookout-flag", "FLAG", *SPOTS["lookout-point"], height=7, color=GOLD_FLAG
        ),
        _procedural("cove-lookout-palm-0", "PALM", -4, -42.6, height=5.4, rotationY=0.3),
        _procedural("cove-lookout-palm-1", "PALM", 4.5, -42.2, height=4.8, rotationY=2.1),
    ]

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

    return {
        "scenery": scenery,
        "colliders": colliders,
        "zones": zones,
        "ambient": ambient,
        "lights": lights,
        "procedural": procedural,
    }


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(cove_layout(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)
