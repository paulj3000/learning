"""The Heart of Firepeak: the seven-zone 3D Area's geometry (pure data, no database).

Layout is seed-owned (ADR-033, LAI-0805); `firepeak_heart_seed.py` writes it into the database and
`tests/test_firepeak_heart_layout.py` proves it (checkpoints, hop limits, a walk with no jump).
`docs/firepeak/HEART_OF_FIREPEAK_DESIGN.md` section 4 is the plan; ids there are fixed.

World frame (metres). The child walks from +z (Explorer's Landing) to -z (Heart Chamber). Ground
is flat at y = 0 everywhere (the engine has no terrain); height comes from `platforming.platforms`
(boxes standing on the ground, jumpable) and from low jumpable colliders (logs).

Rules the layout keeps, each checked by a test:

- Every mandatory route is walkable with no jump. The controller steps up 0.25 m, so stairs use
  0.2 m rises and 0.8 m treads. Gates between zones are wall segments with a removable centre
  collider (`effects.openings`), opened in order by the previous zone's completion key.
- Optional jump routes rise at most 0.6 m per hop with gaps of at most 1.4 m (1.6 m for the one
  advanced route over the lava), and lead only to optional shards.
- Lava is drawn by `effects.lava` (`visualOnly`) and enforced by `platforming.hazards`, which is
  height aware: standing on the bridge or a stone (top above 0.05 m) is safe, touching the lava is
  not, and the child returns to the last course checkpoint they touched. Checkpoints stand on
  open ground, never in lava, on a platform or in a collider.
"""

from __future__ import annotations

import math
import random

REGION_ID = "firepeak-heart"
PLACE_SLUG = "firepeak-heart"
QUEST_ID = "the-heart-of-firepeak"
# 2: platforming.recoveryLead, the lava recovery line (was the water "Splash!").
# 3: one checkpoint list and the lava hazard in scene.engineBridge (GE-073); the platforming and
#    effects checkpoint lists and the platforming hazard are gone.
# 4: the Forge steam push (environment.volumes), off once the Forge is restored (GE-073).
HEART_VERSION = 4
FACING_NORTH_TO_SOUTH = math.pi  # forward is (sin yaw, cos yaw); the route runs toward -z

BOUNDS = {"halfExtentX": 32, "halfExtentZ": 96, "wallThickness": 1}

K = {
    "map": "FIREPEAK_HEART_MAP_READ",
    "pattern": "FIREPEAK_HEART_PATTERN_SOLVED",
    "emberwood": "FIREPEAK_HEART_EMBERWOOD_DONE",
    "bridge": "FIREPEAK_HEART_LAVA_BRIDGE",
    "crossed": "FIREPEAK_HEART_LAVA_CROSSED",
    "shapes": "FIREPEAK_HEART_SHAPES_MATCHED",
    "lit": "FIREPEAK_HEART_CAVERN_LIT",
    "powered": "FIREPEAK_HEART_FORGE_POWERED",
    "restored_forge": "FIREPEAK_HEART_FORGE_RESTORED",
    "rocks": "FIREPEAK_HEART_ROCKS_NAMED",
    "summit": "FIREPEAK_HEART_SUMMIT_REACHED",
    "crystals": "FIREPEAK_HEART_CRYSTALS_SET",
    "restored": "FIREPEAK_HEART_RESTORED",
    "celebrated": "FIREPEAK_HEART_CELEBRATED",
}

# Zone id, label, z range (north edge first), completion key that opens the gate *after* it.
ZONES = [
    ("explorers-landing", "Explorer's Landing", 94, 66),
    ("emberwood-forest", "Emberwood Forest", 64, 38),
    ("lava-crossing", "Lava Crossing", 36, 8),
    ("crystal-caverns", "Crystal Caverns", 6, -22),
    ("ancient-forge", "Ancient Forge", -24, -48),
    ("firepeak-summit", "Firepeak Summit", -50, -76),
    ("heart-chamber", "Heart Chamber", -78, -94),
]

# Gate between zones: (collider id, z of the wall, key that opens it).
GATES = [
    ("fh-gate-emberwood", 65.0, K["map"]),
    ("fh-gate-lava", 37.0, K["emberwood"]),
    ("fh-gate-caverns", 7.0, K["crossed"]),
    ("fh-gate-forge", -23.0, K["lit"]),
    ("fh-gate-summit", -49.0, K["restored_forge"]),
    ("fh-gate-heart", -77.0, K["summit"]),
]
GATE_HALF_WIDTH = 4.0
GATE_HALF_DEPTH = 0.75

LAVA = {"minX": -32.0, "maxX": 32.0, "minZ": 14.0, "maxZ": 30.0}
CAVE_WALL_INNER = 13.0

# Course checkpoints (respawn targets) and the effects checkpoints that resume a returning child.
CHECKPOINTS = [
    # id, label, x, z, key that opens it for resume (None: the spawn)
    ("fh-cp-landing", "Explorer's Landing", 0.0, 90.0, None),
    ("fh-cp-emberwood", "Emberwood Forest", 0.0, 61.5, K["map"]),
    ("fh-cp-lava-near", "the near bank", 0.0, 34.5, K["emberwood"]),
    ("fh-cp-lava-far", "the far bank", 0.0, 12.4, K["bridge"]),
    ("fh-cp-caverns", "the Crystal Caverns", 0.0, 3.5, K["crossed"]),
    ("fh-cp-forge", "the Ancient Forge", 0.0, -26.0, K["lit"]),
    ("fh-cp-summit", "the foot of the summit", 0.0, -51.5, K["restored_forge"]),
    ("fh-cp-heart", "the Heart Chamber", 0.0, -79.5, K["summit"]),
]

WOOD = 0xC58B4F
ROCK = 0x6E6A7A
BASALT = 0x4A4650
STONE_TOP = 0xB9B2A8
GOLD = 0xF2C94C
GLOW = 0x7FE7FF


def _rect(rid, min_x, max_x, min_z, max_z, **extra):
    return {"id": rid, "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z, **extra}


def _box(pid, x, z, width, top, depth, y=0.0, **extra):
    """A platform standing on the ground (or at `y`), whose walkable top is `y + height`."""
    return {
        "id": pid,
        "size": {"width": width, "height": top, "depth": depth},
        "position": {"x": x, "y": y, "z": z},
        **extra,
    }


# --- colliders ---------------------------------------------------------------------------------


def _gate_colliders() -> list[dict]:
    out = []
    for gate_id, z, _key in GATES:
        lo, hi = z - GATE_HALF_DEPTH, z + GATE_HALF_DEPTH
        out.append(_rect(f"{gate_id}-west", -32.0, -GATE_HALF_WIDTH, lo, hi))
        out.append(_rect(gate_id, -GATE_HALF_WIDTH, GATE_HALF_WIDTH, lo, hi))
        out.append(_rect(f"{gate_id}-east", GATE_HALF_WIDTH, 32.0, lo, hi))
    return out


def _cave_colliders() -> list[dict]:
    top, bottom = 6.25, -22.25
    return [
        _rect("fh-cave-wall-west", -32.0, -CAVE_WALL_INNER, bottom, top),
        # The east wall has a secret alcove: a small room behind a collider that the arrangement
        # puzzle removes. Rock is solid around it.
        _rect("fh-cave-wall-east-north", CAVE_WALL_INNER, 32.0, -3.5, top),
        _rect("fh-cave-wall-east-south", CAVE_WALL_INNER, 32.0, bottom, -8.5),
        _rect("fh-cave-alcove-back", 22.0, 32.0, -8.5, -3.5),
        _rect("fh-cavern-secret", CAVE_WALL_INNER, 14.0, -8.5, -3.5),
    ]


def _jumpable(cid, min_x, max_x, min_z, max_z, height):
    return _rect(cid, min_x, max_x, min_z, max_z, minY=0.0, maxY=height, jumpable=True)


def _solid_scenery_colliders() -> list[dict]:
    """Trunks, rocks, gears and pillars: solid, small, and never on a mandatory path."""
    out = []
    for entity_id, x, z, _w, _h, _d, solid in _scatter_placements():
        if solid:
            half = solid / 2
            out.append(_rect(f"col-{entity_id}", x - half, x + half, z - half, z + half))
    # Gears and pillars.
    for cid, x, z, side in GEAR_PILLARS:
        half = side / 2
        out.append(_rect(cid, x - half, x + half, z - half, z + half))
    return out


GEAR_PILLARS = [
    ("fh-gear-block-west", -17.0, -31.0, 2.4),
    ("fh-gear-block-east-near", 12.0, -41.0, 2.4),
    ("fh-heart-pillar-nw", -14.0, -84.0, 1.6),
    ("fh-heart-pillar-ne", 14.0, -84.0, 1.6),
    ("fh-heart-pillar-sw", -14.0, -91.0, 1.6),
    ("fh-heart-pillar-se", 14.0, -91.0, 1.6),
]

# Low logs the child may hop (optional) beside an always-open walk-around.
LOGS = [
    # id, x0, x1, z0, z1, height
    ("fh-jump-log", 8.0, 16.0, 75.5, 76.4, 0.45),
    ("fh-forest-log-1", 14.0, 22.0, 55.6, 56.5, 0.4),
    ("fh-forest-log-2", 14.0, 22.0, 52.6, 53.5, 0.4),
    ("fh-forest-log-3", 14.0, 22.0, 49.6, 50.5, 0.4),
]


def colliders() -> list[dict]:
    out = [*_gate_colliders(), *_cave_colliders(), *_solid_scenery_colliders()]
    out += [_jumpable(cid, x0, x1, z0, z1, h) for cid, x0, x1, z0, z1, h in LOGS]
    return out


# --- scattered scenery (deterministic) --------------------------------------------------------


def _scatter(rng, count, x_range, z_range, avoid, min_gap, taken):
    """Pick `count` positions, none inside `avoid` rects or closer than `min_gap` to another."""
    points = []
    attempts = 0
    while len(points) < count and attempts < 4000:
        attempts += 1
        side = -1 if rng.random() < 0.5 else 1
        x = side * (x_range[0] + rng.random() * (x_range[1] - x_range[0]))
        z = z_range[0] + rng.random() * (z_range[1] - z_range[0])
        if any(lo_x <= x <= hi_x and lo_z <= z <= hi_z for lo_x, hi_x, lo_z, hi_z in avoid):
            continue
        if any(math.hypot(x - ox, z - oz) < min_gap for ox, oz in [*points, *taken]):
            continue
        points.append((round(x, 1), round(z, 1)))
    return points


# Hand-placed tree screens around the hidden Emberwood shard.
SCREEN_TREES = [(-20.5, 49.0), (-23.0, 49.6), (-25.5, 49.0), (-27.8, 45.6), (-27.8, 42.4)]
HIDDEN_SHARD = (-22.0, 44.4)


def _scatter_placements() -> list[tuple]:
    """(entity id, x, z, width, height, depth, solid side or 0) for trees and rocks."""
    rng = random.Random(7041)
    out = []
    taken: list[tuple[float, float]] = list(SCREEN_TREES)
    for index, (x, z) in enumerate(SCREEN_TREES):
        out.append((f"fh-tree-screen-{index + 1}", x, z, 1.8, 3.8, 1.8, 0.7))
    plans = [
        # name, count, x range (mirrored), z range, avoid rects, gap, kind
        ("landing-tree", 14, (19.0, 30.0), (68.0, 92.0), [], 3.4, "tree"),
        ("forest-tree", 24, (10.0, 30.0), (40.0, 62.0), [(12.5, 23.5, 47.0, 58.0), (-30, -17, 40.0, 50.5)], 3.2, "tree"),
        ("forest-rock", 6, (10.0, 28.0), (40.0, 62.0), [(12.5, 23.5, 47.0, 58.0), (-30, -17, 40.0, 50.5)], 2.6, "rock"),
        ("lava-rock", 8, (10.0, 28.0), (31.0, 36.0), [], 3.0, "rock"),
        ("lava-far-rock", 4, (10.0, 28.0), (8.0, 13.0), [], 3.0, "rock"),
        ("forge-rock", 8, (22.0, 30.0), (-47.0, -26.0), [(16.0, 24.0, -40.0, -30.0)], 3.0, "rock"),
        ("summit-rock", 8, (16.0, 30.0), (-74.0, -52.0), [(-25.0, -12.0, -70.0, -58.0)], 3.0, "rock"),
        ("heart-rock", 4, (20.0, 30.0), (-93.0, -80.0), [], 3.0, "rock"),
    ]
    for name, count, x_range, z_range, avoid, gap, kind in plans:
        points = _scatter(rng, count, x_range, z_range, avoid, gap, taken)
        taken += points
        for index, (x, z) in enumerate(points):
            if kind == "tree":
                out.append((f"fh-{name}-{index + 1}", x, z, 1.8, 3.8, 1.8, 0.7))
            else:
                out.append((f"fh-{name}-{index + 1}", x, z, 1.4, 1.0, 1.2, 1.0))
    return out


# --- platforming: stairs, ledges, the bridge and the optional routes ---------------------------


def _stairs(prefix, x, z_start, direction, steps, top_start, rise, tread, width):
    """Steps along z. `direction` -1 climbs toward -z; each step's top is `top_start + rise * i`."""
    out = []
    for i in range(steps):
        top = round(top_start + rise * i, 3)
        z0 = z_start + direction * tread * i
        centre = z0 + direction * tread / 2
        out.append(_box(f"{prefix}-{i + 1}", x, round(centre, 3), width, top, tread, color=STONE_TOP))
    return out


# Optional jump routes, checked by tests: (id, [platform ids in order], max gap, start from ground)
OPTIONAL_ROUTES = [
    ("lava-stepping-stones", ["fh-stone-1", "fh-stone-2", "fh-stone-islet", "fh-stone-vanish", "fh-stone-5"], 1.6),
    ("summit-jump-route", ["fh-summit-hop-1", "fh-summit-hop-2", "fh-summit-hop-3", "fh-summit-plateau"], 1.4),
]


def platforms() -> list[dict]:
    out: list[dict] = []
    # Lava Crossing: a wide basalt bridge appears when the numbers puzzle is solved. Top 0.2 m, so
    # a child steps on without jumping; it is above the hazard line (0.05 m).
    bridge_z = (LAVA["minZ"] - 1.0 + LAVA["maxZ"] + 1.0) / 2
    out.append(
        _box(
            "fh-lava-bridge",
            0.0,
            bridge_z,
            6.0,
            0.2,
            LAVA["maxZ"] - LAVA["minZ"] + 2.0,
            color=BASALT,
            activation={"trigger": "SIGNAL", "source": f"world:{K['bridge']}", "hiddenUntilActive": True},
        )
    )
    # Optional advanced route: stones east of the bridge (tops 0.5 m, gaps 1.2 m).
    stone_x = 18.0
    gap = 1.2
    edge = LAVA["maxZ"]
    for pid, depth, extra in (
        ("fh-stone-1", 1.6, {}),
        ("fh-stone-2", 1.6, {}),
        ("fh-stone-islet", 2.4, {}),
        (
            "fh-stone-vanish",
            1.6,
            {"vanish": {"mode": "STAND", "visibleSeconds": 4, "hiddenSeconds": 2.5, "warningSeconds": 1}},
        ),
        ("fh-stone-5", 1.6, {}),
    ):
        far_edge = edge - gap
        centre = far_edge - depth / 2
        width = 2.4 if pid == "fh-stone-islet" else 1.6
        out.append(_box(pid, stone_x, round(centre, 3), width, 0.5, depth, color=ROCK, **extra))
        edge = far_edge - depth
    # Crystal Caverns: an elevated ledge with a stair alternative (0.2 m rises).
    out.append(_box("fh-cavern-ledge", -10.4, -19.0, 4.8, 1.0, 5.0, color=STONE_TOP))
    steps = _stairs("fh-cavern-step", -10.4, -16.5, +1, 4, 0.2, 0.2, 0.8, 3.8)
    for step, top in zip(steps, [0.8, 0.6, 0.4, 0.2], strict=True):  # highest beside the ledge
        step["size"]["height"] = top
    out += steps
    # Ancient Forge: the lift to an optional shard (wakes when the machines are powered).
    out.append(
        _box(
            "fh-forge-lift",
            20.0,
            -33.0,
            2.4,
            0.2,
            2.4,
            color=0x3FA7D6,
            motion={"path": [{"x": 0.0, "y": 2.4, "z": 0.0}], "speed": 0.8, "pauseSeconds": 3},
            activation={"trigger": "SIGNAL", "source": f"world:{K['powered']}"},
        )
    )
    out.append(_box("fh-forge-ledge", 20.0, -36.8, 5.0, 2.6, 5.2, color=STONE_TOP))
    # Firepeak Summit: stairs up, a plateau, stairs down; every rise is 0.2 m.
    out += _stairs("fh-summit-up", 0.0, -55.0, -1, 7, 0.2, 0.2, 0.8, 6.0)
    out.append(_box("fh-summit-plateau", 0.0, -64.6, 14.0, 1.6, 8.0, color=STONE_TOP))
    down = _stairs("fh-summit-down", 0.0, -68.6, -1, 7, 0.2, 0.2, 0.8, 6.0)
    # Descending: the step nearest the plateau is highest.
    for step, top in zip(down, [1.4, 1.2, 1.0, 0.8, 0.6, 0.4, 0.2], strict=True):
        step["size"]["height"] = top
    out += down
    # Optional jump route up the east side (0.5 m hops, 1.2 m gaps).
    for index, (z, top) in enumerate(((-56.4, 0.5), (-59.2, 1.0), (-62.0, 1.5)), start=1):
        out.append(_box(f"fh-summit-hop-{index}", 9.0, z, 1.6, top, 1.6, color=ROCK))
    # One optional moving platform: a shuttle to a lookout ledge on the west side.
    out.append(
        _box(
            "fh-summit-shuttle",
            -8.3,
            -65.0,
            2.4,
            0.2,
            2.4,
            y=1.4,
            color=0x3FA7D6,
            motion={"path": [{"x": -6.0, "y": 0.0, "z": 0.0}], "speed": 1.2, "pauseSeconds": 3},
        )
    )
    out.append(_box("fh-summit-lookout", -18.8, -65.0, 6.4, 1.6, 6.0, color=STONE_TOP))
    return out


def _zone(zid, min_x, max_x, min_z, max_z, message):
    return {"rect": _rect(zid, min_x, max_x, min_z, max_z), "enterMessage": message}


def zones() -> list[dict]:
    return [
        _zone("fh-zone-landing", -32, 32, 66, 94, "Flint: Welcome to Firepeak! Use the stick or the arrow keys to walk. Say hello to me, then read the map."),
        _zone("fh-zone-jump-tip", 6, 18, 73, 78, "Tip: You can press Jump to hop over this log. Jumping is just for fun. You can always walk around."),
        _zone("fh-zone-emberwood", -32, 32, 38, 64, "Emberwood Forest. Kindle the fire spirit is here to help. Hop the logs or walk around them."),
        _zone("fh-zone-lava", -32, 32, 8, 36, "The Lava Crossing. Solve the stone numbers to build a bridge. If you slip, you just go back to a safe spot."),
        _zone("fh-zone-caverns", -13, 13, -22, 6, "The Crystal Caverns. Professor Basalt knows all about these rocks. The crystals glow!"),
        _zone("fh-zone-forge", -32, 32, -48, -24, "The Ancient Forge. Cinder keeps the old machines. Can you wake them up?"),
        _zone("fh-zone-summit", -32, 32, -76, -50, "Firepeak Summit. Climb the steps, or take the hopping stones if you like."),
        _zone("fh-zone-heart", -32, 32, -94, -78, "The Heart Chamber. The Heart of Firepeak is dim. Set the crystals in order to wake it."),
    ]


def platforming() -> dict:
    return {
        "platforms": platforms(),
        # Said first when the lava hazard puts the child back (the engine adds the checkpoint).
        "recoveryLead": "Whoa, the lava is too hot!",
        "zones": zones(),
    }


# --- engine bridge (GE-073): the one checkpoint list and the lava hazard ------------------------

COURSE_ID = "fh-heart"
CHECKPOINT_REACH = 3.0  # half side of the square that counts as reaching a checkpoint, metres
LAVA_BELOW_Y = 0.05  # feet at or below this inside the lava rect: back to the last checkpoint


def _checkpoint(cid, label, x, z, key) -> dict:
    out = {
        "id": cid,
        "courseId": COURSE_ID,
        "position": {"x": x, "y": 0.0, "z": z},
        "yaw": round(FACING_NORTH_TO_SOUTH, 3),
        "label": label,
        "halfSize": CHECKPOINT_REACH,
    }
    # Opens with its zone's key; region play feeds world changes as `world:<key>` signals.
    if key:
        out["requiresSignalId"] = f"world:{key}"
    return out


SUMMIT_GATE_Z = next(z for gate_id, z, _key in GATES if gate_id == "fh-gate-summit")
# The two steam plumes stand in front of the summit gate until the Forge is restored. Walking into
# them, a child is gently pushed back toward the Forge: a gust they can see, never a trap. Half
# strength under reduced motion (engine). It never points at a hazard (the lava is far behind).
STEAM_PUSH = {
    "minX": -GATE_HALF_WIDTH,
    "maxX": GATE_HALF_WIDTH,
    "minZ": SUMMIT_GATE_Z + GATE_HALF_DEPTH + 0.05,
    "maxZ": SUMMIT_GATE_Z + 4.0,
}
STEAM_PUSH_STRENGTH = 1.5  # m/s added toward +z (back into the Forge); walking still wins


def engine_bridge() -> dict:
    lava = {"minX": LAVA["minX"], "maxX": LAVA["maxX"], "minZ": LAVA["minZ"], "maxZ": LAVA["maxZ"]}
    push = STEAM_PUSH
    return {
        "capabilities": [
            {
                "id": "gameplay.checkpoints",
                "config": {"checkpoints": [_checkpoint(*row) for row in CHECKPOINTS], "goals": []},
            },
            {
                "id": "gameplay.hazards",
                "config": {
                    "hazards": [
                        {
                            "id": "fh-lava-hazard",
                            "kind": "LAVA",
                            "rect": lava,
                            "belowY": LAVA_BELOW_Y,
                            # Before any checkpoint is reached on this visit: the near bank.
                            "checkpointId": "fh-cp-lava-near",
                            "messageKey": "hazard.lava.tooHot",
                        }
                    ],
                    "telegraphed": [],
                },
            },
            {
                "id": "environment.volumes",
                "config": {
                    "surfaces": [],
                    "forces": [
                        {
                            "id": "fh-forge-steam-push",
                            "kind": "WIND",
                            "box": {
                                "min": {"x": push["minX"], "y": -1.0, "z": push["minZ"]},
                                "max": {"x": push["maxX"], "y": 3.0, "z": push["maxZ"]},
                            },
                            "direction": {"x": 0.0, "y": 0.0, "z": 1.0},
                            "strength": STEAM_PUSH_STRENGTH,
                            "rampInSeconds": 0.5,
                            "inactiveWhenSignalId": f"world:{K['restored_forge']}",
                            "neverPushIntoHazard": True,
                        }
                    ],
                    "hazardRects": [lava],
                },
            },
        ]
    }


# --- effects ----------------------------------------------------------------------------------

STAND_IN_FOR = {
    # asset id -> (stand-in shape, colour); NPCs and pickups draw themselves but are listed too.
    "firepeak-flint": ("FIGURE", 0xD9822B),
    "firepeak-kindle": ("FIGURE", 0xFF7A2F),
    "firepeak-professor-basalt": ("FIGURE", 0x6E8B9C),
    "firepeak-cinder": ("FIGURE", 0x8A6A4F),
    "firepeak-ignis": ("FIGURE", 0xE9B44C),
    "firepeak-ember-shard": ("CRYSTAL", 0xFF9A3C),
    "firepeak-map-sign": ("MARKER", 0xC58B4F),
    "firepeak-campfire": ("BOX", 0xFF8A3A),
    "firepeak-tree": ("TREE", 0x2F7F4E),
    "firepeak-log": ("LOG", 0x7B5235),
    "firepeak-rock": ("ROCK", 0x6E6A7A),
    "firepeak-ember-crystal": ("CRYSTAL", 0xFF6A3D),
    "firepeak-count-card": ("BOX", 0xF3E3B5),
    "firepeak-lava-stone": ("STONE", 0x5B5450),
    "firepeak-path-marker": ("MARKER", 0xF2C94C),
    "firepeak-shape-stone": ("STONE", 0x8C8794),
    "firepeak-cave-crystal": ("CRYSTAL", 0x7FE7FF),
    "firepeak-forge-switch": ("SWITCH", 0xB87333),
    "firepeak-gear": ("GEAR", 0xB87333),
    "firepeak-rock-sample": ("ROCK", 0x4A4650),
    "firepeak-story-stone": ("STONE", 0xD8C7A0),
    "firepeak-heart-crystal": ("CRYSTAL", 0x8FA7B3),
    "firepeak-crystal-pedestal": ("PEDESTAL", 0x6E6A7A),
    "firepeak-return-portal": ("PORTAL", 0xFFD36B),
    "firepeak-arch": ("ARCH", 0x8C8794),
    "firepeak-sign": ("MARKER", 0xC58B4F),
    "firepeak-circuit-lamp": ("CRYSTAL", 0xFFE08A),
    "firepeak-stream": ("BOX", 0x4C9BD6),
}


def lights() -> list[dict]:
    return [
        {"id": "fh-lava-glow", "x": 0, "y": 1.5, "z": 22, "color": 0xFF6A1A, "intensity": 2.6, "distance": 26},
        {"id": "fh-cave-glow-west", "x": -9, "y": 2.0, "z": -5, "color": GLOW, "intensity": 2.6, "distance": 14},
        {"id": "fh-cave-glow-east", "x": 9, "y": 2.0, "z": -13, "color": 0xB58CFF, "intensity": 2.6, "distance": 14},
        {"id": "fh-secret-glow", "x": 18, "y": 1.6, "z": -6, "color": 0xFFD36B, "intensity": 2.2, "distance": 9},
        {"id": "fh-forge-glow", "x": 0, "y": 2.5, "z": -36, "color": 0xFF8A3A, "intensity": 2.8, "distance": 24},
        {"id": "fh-summit-glow", "x": 0, "y": 3.0, "z": -64, "color": 0xFFE08A, "intensity": 2.0, "distance": 20},
        {"id": "fh-heart-glow", "x": 0, "y": 2.5, "z": -90, "color": GLOW, "intensity": 3.2, "distance": 18},
    ]


def effects(stand_in_entities: list[tuple[str, str]]) -> dict:
    """`stand_in_entities`: (entity id, asset id) for every placement that has an asset."""
    return {
        "lava": [
            {
                "id": "fh-lava-river",
                "minX": LAVA["minX"],
                "maxX": LAVA["maxX"],
                "minZ": LAVA["minZ"],
                "maxZ": LAVA["maxZ"],
                # Drawn only: the platforming hazard is height aware and respawns the child.
                "visualOnly": True,
                "safe": [],
            }
        ],
        "steam": [
            {"id": "fh-forge-steam-west", "x": -2.0, "z": -47.0, "height": 4, "hiddenWhenChangeKey": K["restored_forge"]},
            {"id": "fh-forge-steam-east", "x": 2.0, "z": -47.0, "height": 4, "hiddenWhenChangeKey": K["restored_forge"]},
        ],
        "lights": lights(),
        "backdrop": {"assetId": "firepeak-volcano-main", "x": 0, "z": -128, "radius": 38, "height": 54},
        "openings": [
            *[{"colliderId": gate_id, "whenChangeKey": key} for gate_id, _z, key in GATES],
            {"colliderId": "fh-cavern-secret", "whenChangeKey": K["lit"]},
        ],
        "returns": [
            {
                "entityId": "fh-return-portal",
                "toCheckpoint": "fh-cp-landing",
                # The checkpoint list lives in scene.engineBridge now, so the way back says where.
                "to": {"x": CHECKPOINTS[0][2], "z": CHECKPOINTS[0][3], "yaw": round(FACING_NORTH_TO_SOUTH, 3)},
                "whenChangeKey": K["restored"],
                "label": "Step through the portal back to Explorer's Landing",
            }
        ],
        "standIns": [
            {"entityId": entity, "shape": STAND_IN_FOR[asset][0], "color": STAND_IN_FOR[asset][1]}
            for entity, asset in stand_in_entities
        ],
    }


# --- placements --------------------------------------------------------------------------------

# asset id -> (runtime kind, category, display name). Declared as Django-created `ContentAsset`
# rows with no version: the game draws a stand-in until a GLB is published for the id.
ASSET_DEFS = {
    "firepeak-volcano-main": ("kit-piece", "scenery", "Firepeak volcano"),
    "firepeak-crystal-pedestal": ("prop", "prop", "Ancient pedestal"),
    "firepeak-flint": ("character", "npc", "Flint"),
    "firepeak-kindle": ("character", "npc", "Kindle"),
    "firepeak-professor-basalt": ("character", "npc", "Professor Basalt"),
    "firepeak-cinder": ("character", "npc", "Cinder"),
    "firepeak-ignis": ("character", "npc", "Ignis"),
    "firepeak-ember-shard": ("collectible", "collectible", "Ember shard"),
    "firepeak-map-sign": ("prop", "prop", "Explorer's map sign"),
    "firepeak-campfire": ("prop", "prop", "Campfire"),
    "firepeak-tree": ("prop", "scenery", "Emberwood tree"),
    "firepeak-log": ("prop", "scenery", "Fallen log"),
    "firepeak-rock": ("prop", "scenery", "Volcanic rock"),
    "firepeak-ember-crystal": ("prop", "prop", "Pattern crystal"),
    "firepeak-count-card": ("prop", "prop", "Counting card"),
    "firepeak-lava-stone": ("prop", "prop", "Numbered stepping stone"),
    "firepeak-path-marker": ("prop", "prop", "Path marker"),
    "firepeak-shape-stone": ("prop", "prop", "Shape stone"),
    "firepeak-cave-crystal": ("prop", "scenery", "Cavern crystal"),
    "firepeak-forge-switch": ("prop", "prop", "Forge switch"),
    "firepeak-gear": ("prop", "scenery", "Ancient gear"),
    "firepeak-rock-sample": ("prop", "prop", "Rock sample"),
    "firepeak-story-stone": ("prop", "prop", "Story stone"),
    "firepeak-heart-crystal": ("prop", "prop", "The Heart of Firepeak"),
    "firepeak-return-portal": ("prop", "prop", "Return portal"),
    "firepeak-arch": ("prop", "scenery", "Stone gateway"),
    "firepeak-sign": ("prop", "prop", "Wooden sign"),
    "firepeak-circuit-lamp": ("prop", "prop", "Forge lamp"),
    "firepeak-stream": ("prop", "scenery", "Little stream"),
}

SHARDS = [
    # entity, zone word, x, z, elevation
    ("fh-shard-landing", "landing", 12.0, 73.8, 0.0),
    ("fh-shard-emberwood", "emberwood", HIDDEN_SHARD[0], HIDDEN_SHARD[1], 0.0),
    ("fh-shard-lava-jumper", "lava", 18.0, 22.0, 0.5),
    ("fh-shard-caverns", "caverns", -10.4, -19.0, 1.0),
    ("fh-shard-forge", "forge", 20.0, -37.5, 2.6),
    ("fh-shard-summit", "summit", 5.5, -67.8, 1.6),
    ("fh-shard-heart", "heart", 8.0, -91.0, 0.0),
]

NPC_PLACEMENTS = [
    # entity, npc id, asset, label, x, z, elevation, yaw
    ("fh-flint", "flint", "firepeak-flint", "Flint", -4.0, 86.0, 0.0, 0.4),
    ("fh-kindle", "kindle", "firepeak-kindle", "Kindle", 3.0, 58.0, 0.0, -0.4),
    ("fh-basalt", "professor-basalt", "firepeak-professor-basalt", "Professor Basalt", -6.0, 1.5, 0.0, 0.6),
    ("fh-cinder", "cinder", "firepeak-cinder", "Cinder", -5.0, -31.0, 0.0, 0.5),
    ("fh-basalt-summit", "professor-basalt", "firepeak-professor-basalt", "Professor Basalt", -6.0, -64.6, 1.6, 1.0),
    ("fh-ignis", "ignis", "firepeak-ignis", "Ignis", -4.0, -87.0, 0.0, 0.3),
    ("fh-kindle-heart", "kindle", "firepeak-kindle", "Kindle", 4.0, -86.0, 0.0, -0.3),
]


def _obj(entity, asset, label, x, z, size, elevation=0.0, kind="PROP", rotation_y=0.0, **extra):
    return {
        "entity_id": entity,
        "kind": kind,
        "asset": asset,
        "label": label,
        "x": x,
        "z": z,
        "elevation": elevation,
        "rotation_y": rotation_y,
        "size": size,
        **extra,
    }


def _row(prefix, asset, label, letters, xs, z, size=(0.9, 1.0, 0.9), elevation=0.0, names=None):
    return [
        _obj(
            f"{prefix}{letter}",
            asset,
            (names[i] if names else f"{label} {letter.strip('-').upper()}"),
            x,
            z,
            size,
            elevation,
        )
        for i, (letter, x) in enumerate(zip(letters, xs, strict=True))
    ]


def placements() -> list[dict]:
    out: list[dict] = []
    for entity, npc, asset, label, x, z, elevation, yaw in NPC_PLACEMENTS:
        out.append(
            _obj(entity, asset, label, x, z, (0.6, 1.7, 0.6), elevation, "NPC", yaw, npc=npc)
        )
    for entity, zone, x, z, elevation in SHARDS:
        out.append(
            _obj(
                entity,
                "firepeak-ember-shard",
                "Ember shard",
                x,
                z,
                (0.4, 0.5, 0.4),
                elevation,
                "COLLECTIBLE",
                pickup_key=f"FIREPEAK_HEART_SHARD_{zone.upper()}",
                pickup_rule=f"fh-rule-shard-{zone}",
            )
        )
    # Puzzle objects (every id appears in a puzzle's `entity_ids`).
    out.append(_obj("fh-map-sign", "firepeak-map-sign", "Explorer's map", 3.5, 80.0, (0.8, 1.6, 0.3), rotation_y=0.3))
    out += _row("fh-ember-crystal-", "firepeak-ember-crystal", "Crystal", "abc", (-5.0, 0.0, 5.0), 53.0, (0.7, 1.2, 0.7))
    out += _row("fh-count-card-", "firepeak-count-card", "Card", "abc", (-5.0, 0.0, 5.0), 46.5, (0.9, 1.1, 0.2))
    out += _row("fh-lava-stone-", "firepeak-lava-stone", "Stone", "abc", (-5.0, 0.0, 5.0), 32.5, (1.1, 0.5, 1.1))
    out += _row("fh-lava-path-", "firepeak-path-marker", "Path", "abc", (-8.0, 0.0, 8.0), 10.0, (0.7, 1.4, 0.4))
    out += _row("fh-cavern-shape-", "firepeak-shape-stone", "Shape", "abcd", (-9.0, -3.0, 3.0, 9.0), -3.0, (1.0, 1.2, 0.8))
    out += _row("fh-cavern-crystal-", "firepeak-cave-crystal", "Crystal", "abcd", (-7.5, -2.5, 2.5, 7.5), -10.0, (0.8, 1.4, 0.8))
    out += _row(
        "fh-forge-switch-",
        "firepeak-forge-switch",
        "Switch",
        ["red", "blue", "gold", "green"],
        (-7.5, -2.5, 2.5, 7.5),
        -38.0,
        (0.6, 1.1, 0.5),
        names=["Red switch", "Blue switch", "Gold switch", "Green switch"],
    )
    out += _row("fh-circuit-path-", "firepeak-path-marker", "Wire path", "abc", (-7.0, 0.0, 7.0), -43.5, (0.7, 1.4, 0.4))
    out.append(_obj("fh-circuit-lamp", "firepeak-circuit-lamp", "The forge lamp", 0.0, -45.6, (0.8, 1.0, 0.8)))
    out += _row("fh-rock-sample-", "firepeak-rock-sample", "Rock sample", "abc", (-4.0, 0.0, 4.0), -63.0, (0.9, 0.8, 0.9), 1.6)
    out += _row("fh-island-step-", "firepeak-story-stone", "Story stone", "abcde", (-5.0, -2.5, 0.0, 2.5, 5.0), -66.2, (0.9, 0.6, 0.9), 1.6)
    out += _row(
        "fh-heart-crystal-",
        "firepeak-cave-crystal",
        "Elemental crystal",
        ["forest", "magma", "cavern", "forge"],
        (-9.0, -3.0, 3.0, 9.0),
        -82.0,
        (0.8, 1.4, 0.8),
        names=["Forest crystal", "Magma crystal", "Cavern crystal", "Forge crystal"],
    )
    out.append(_obj("fh-heart-pedestal", "firepeak-crystal-pedestal", "Ancient pedestal", 0.0, -90.5, (1.2, 1.0, 1.2)))
    out.append(_obj("fh-heart-crystal", "firepeak-heart-crystal", "The Heart of Firepeak", 0.0, -90.5, (0.7, 1.1, 0.7), 1.0))
    out.append(_obj("fh-return-portal", "firepeak-return-portal", "Portal back to the landing", 11.0, -86.0, (1.4, 2.4, 0.4)))
    # Landmarks and decoration.
    out.append(_obj("fh-landing-campfire", "firepeak-campfire", "Campfire", 7.0, 86.0, (1.1, 0.7, 1.1)))
    out.append(_obj("fh-landing-sign", "firepeak-sign", "Welcome to Firepeak", -2.0, 77.0, (0.6, 1.5, 0.2)))
    out.append(_obj("fh-lookout-sign", "firepeak-sign", "Lookout point", -18.8, -65.0, (0.6, 1.5, 0.2), 1.6, kind="SCENERY"))
    for cid, x0, x1, z0, z1, height in LOGS:
        out.append(
            _obj(f"{cid}-model", "firepeak-log", "", (x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0, height, z1 - z0), kind="SCENERY")
        )
    out.append(_obj("fh-forest-stream", "firepeak-stream", "", -14.0, 54.0, (1.8, 0.06, 10.0), kind="SCENERY"))
    for index, (gate_id, z, _key) in enumerate(GATES, start=1):
        out.append(_obj(f"fh-arch-{index}", "firepeak-arch", "", 0.0, z, (8.6, 4.5, 1.2), kind="SCENERY"))
    for index, (x, z) in enumerate([(-11.8, 2.0), (12.0, -1.0), (-12.0, -14.0), (12.0, -17.0), (-12.0, -8.0), (12.0, 4.0)], start=1):
        out.append(_obj(f"fh-cave-crystal-{index}", "firepeak-cave-crystal", "", x, z, (1.0, 1.8, 1.0), kind="SCENERY"))
    for index, (x, z) in enumerate([(17.0, -5.0), (20.0, -7.0)], start=1):
        out.append(_obj(f"fh-secret-crystal-{index}", "firepeak-cave-crystal", "", x, z, (1.0, 1.6, 1.0), kind="SCENERY"))
    for cid, x, z, side in GEAR_PILLARS[:2]:
        out.append(_obj(f"{cid}-model", "firepeak-gear", "", x, z, (side, side, 0.8), kind="SCENERY"))
    for index, (x, z) in enumerate([(-26.0, -44.0), (26.0, -28.0), (-25.0, -27.0)], start=1):
        out.append(_obj(f"fh-gear-{index}", "firepeak-gear", "", x, z, (2.6, 2.6, 0.8), kind="SCENERY"))
    for entity, x, z, width, height, depth, solid in _scatter_placements():
        asset = "firepeak-tree" if "tree" in entity else "firepeak-rock"
        out.append(_obj(entity, asset, "", x, z, (width, height, depth), kind="SCENERY"))
    for spec in out:
        # Scenery is not interactive, but a drawn stand-in still needs readable copy.
        spec["label"] = spec["label"] or ASSET_DEFS[spec["asset"]][2]
    return out


def entity_asset_pairs() -> list[tuple[str, str]]:
    return [(p["entity_id"], p["asset"]) for p in placements() if p["asset"]]


def scene() -> dict:
    """The whole `WorldRegion.scene`: bounds, copy, colliders, effects and the platforming block."""
    return {
        "firepeakHeartVersion": HEART_VERSION,
        "bounds": dict(BOUNDS),
        "environment": {"backgroundColor": 0x3B2A33},
        "groundAssetId": "ground-tile-stone",
        "copy": {
            "loading": "Hiking up to the Heart of Firepeak.",
            "instructions": "Talk to Flint, then follow the glowing path to the mountain.",
            "altNavLabel": "Go back to the harbor",
        },
        "colliders": colliders(),
        "effects": effects(entity_asset_pairs()),
        "platforming": platforming(),
        "engineBridge": engine_bridge(),
    }
