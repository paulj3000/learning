"""North Pole Village: the 3D layout of "The Missing Christmas Star" (NP-010 to NP-019, NP-036).

Pure data and builders, no ORM. The coordinator's seed (`north_pole_seed.py`, Wave 3) writes
`scene()` into `WorldRegion.scene`, creates a `WorldObjectPlacement` for every entry of
`PLACEMENTS`, a `TreasureChest` at every `CHEST_SPOTS` entry, and binds `PUZZLE_ENTITIES` /
`PUZZLE_ENTITY_MAPS` into the puzzle configs. The contract is
`docs/north-pole/NORTH_POLE_DESIGN.md` (sections 4, 5, 7, 9).

Coordinates are metres. +x is east, +z is south; the controller faces +z at yaw 0, so the child
at Santa's Landing (0, 92) looks north (yaw pi) and walks toward negative z.

```text
   x -66        -26 -24      24 26         66
z -100 +----------+--+--------+--+----------+
       | mountain | D| (summit)  | observatory
 -68   +--gate-----+-- lane ----+-----------+
 -66   | gingerbread| north road | Pine Hollow
 -20   +---------+--+          +--+  (stables z 8..34)
 -18   | frozen   | |          | |
  34   | lake     | |          | |
  36   +----------+ | village  | +----------+
  54   | workshop g| |  tree    | g forest  |
  76   |           | | landing  | |         |
  98   +-----------+-+----------+-+---------+
```

Rules the layout keeps (NP-D5): every required route is walkable; jumps lead only to optional
collectibles or shortcuts. Required arithmetic unlocks raise walkable bridges. The mountain is
terraced, its drops are 0.8 m, and it has no hazard. The only hazard is the lake's open water,
with a checkpoint on both banks. Static ledges and steps are `layout.colliders` (jumpable) and
do not count toward the 64-platform limit; platforms exist only where something moves, vanishes,
bounces or appears.

Run `python -m apps.regions.north_pole_layout` from `lai/` to rewrite `north_pole_scene.json`.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

REGION_ID = "north-pole-village"
BOUNDS = {"halfExtentX": 66, "halfExtentZ": 100, "wallThickness": 1}
LAYOUT_VERSION = 1
SNAPSHOT_PATH = Path(__file__).with_name("north_pole_scene.json")

SPAWN = {"checkpoint_id": "np-cp-landing", "x": 0, "z": 92, "yaw": math.pi, "label": "Santa's Landing"}

# Heading into a zone: yaw 0 faces +z (south), pi/2 faces +x (east).
NORTH, SOUTH, EAST, WEST = math.pi, 0.0, math.pi / 2, -math.pi / 2

# Colours (24-bit).
SNOW = 0xF4F8FF
ICE = 0xBFE3F5
WATER = 0x2B6CB0
WALL = 0xDCE9F7
DRIFT = 0xFFFFFF
RED = 0xB5483E
GREEN = 0x2F7D4F
BROWN = 0x8B5A2B
WOOD = 0x9C6B3C
GOLD = 0xF2C94C
PEPPERMINT = 0xE8434F
COOKIE = 0xC98A4B
CAKE = 0xD8A06A

# --- the keys (contract section 5) -----------------------------------------------------------

CH = {
    "welcome": "NORTH_POLE_WELCOME_LOOKED",
    "workshop": "NORTH_POLE_WORKSHOP_RESTORED",
    "forest": "NORTH_POLE_FOREST_DONE",
    "lake": "NORTH_POLE_LAKE_DONE",
    "snowball": "NORTH_POLE_SNOWBALL_HOME",
    "ginger": "NORTH_POLE_GINGER_REPAIRED",
    "summit": "NORTH_POLE_MOUNTAIN_SUMMIT",
    "star": "NORTH_POLE_STAR_RESTORED",
    "eve": "NORTH_POLE_CHRISTMAS_EVE",
    "lake_bridge": "NORTH_POLE_LAKE_BRIDGE",
    "bridge1": "NORTH_POLE_MOUNTAIN_BRIDGE_ONE",
    "bridge2": "NORTH_POLE_MOUNTAIN_BRIDGE_TWO",
}

GATES = {
    "np-gate-workshop": ((-26, -24, 52, 56), CH["welcome"]),
    "np-gate-forest": ((24, 26, 52, 56), CH["workshop"]),
    "np-gate-lake": ((-26, -24, 10, 14), CH["forest"]),
    "np-gate-stables": ((24, 26, 18, 22), CH["lake"]),
    "np-gate-gingerbread": ((-26, -24, -44, -40), CH["snowball"]),
    "np-gate-mountain": ((-48, -44, -68, -66), CH["ginger"]),
    "np-gate-observatory": ((-2, 2, -86, -82), CH["summit"]),
    "np-gate-north-road": ((-1.5, 1.5, -68, -66), CH["summit"]),
    "np-gate-ice-cave": ((18, 22, 90, 92), CH["eve"]),
}

# Zone rectangles (contract section 4). The ids are also the audio zone ids.
ZONES = {
    "santas-landing": (-24, 24, 76, 98),
    "christmas-village": (-24, 24, 30, 74),
    "santas-workshop": (-66, -26, 36, 98),
    "candy-cane-forest": (26, 66, 36, 98),
    "frozen-lake": (-66, -26, -18, 34),
    "reindeer-stables": (26, 66, -66, 34),
    "gingerbread-village": (-66, -26, -66, -20),
    "north-road": (-24, 24, -66, 28),
    "snowflake-mountain": (-66, -2, -100, -68),
    "north-pole-observatory": (2, 66, -100, -68),
}

ZONE_MESSAGES = {
    "santas-landing": (
        "Welcome to Santa's Landing! Jingle the elf is here to help you. "
        "Walk up to Jingle to say hello. Press Jump to hop. Jumping is just for fun."
    ),
    "christmas-village": (
        "Christmas Village! Look at the big tree, Jingle says. The snow stairs are a nice walking "
        "way up. You can jump up the snow steps too."
    ),
    "santas-workshop": (
        "Santa's Workshop! Tinker the elf needs your help with the toys. Walk up the long stairs "
        "to the high shelf, or hop up the crates."
    ),
    "candy-cane-forest": (
        "Candy Cane Forest! Peppermint will show you the way. You can walk across the creek "
        "bridge, or hop over the peppermint stones."
    ),
    "frozen-lake": (
        "The Frozen Lake! Frosty the elf skates here. Stay on the ice, and walk over the ice "
        "bridge when it appears."
    ),
    "reindeer-stables": (
        "Reindeer Stables! Noel looks after the reindeer. Follow the little footprints into "
        "Pine Hollow."
    ),
    "gingerbread-village": (
        "Gingerbread Village! Ginger and Mrs. Claus are baking. Walk up the sweet ramp to the "
        "rooftop, or hop on the cookies."
    ),
    "north-road": "The North Road. Follow the lanterns to the next adventure. Jingle is cheering for you!",
    "snowflake-mountain": (
        "Snowflake Mountain! Climb the snowy stairs one step at a time. If you slip, you only "
        "slide down a little. Jingle will cheer you on."
    ),
    "north-pole-observatory": (
        "The Observatory! Polaris studies the stars here. Walk up the ramp to the big dome."
    ),
}

# Optional collectibles that need a jump (or a bounce). Every other pickup, NPC, chest and
# puzzle entity is reachable on foot (NP-D5); `test_north_pole_layout.py` proves it.
JUMP_ONLY_OPTIONAL = frozenset(
    {
        "np-snowflake-01",
        "np-snowflake-02",
        "np-snowflake-03",
        "np-snowflake-04",
        "np-snowflake-05",
        "np-snowflake-06",
        "np-snowflake-07",
    }
)

# Optional jump routes, as ordered chains of ledge/platform ids from the ground ("ground").
# `test_north_pole_layout.py` keeps every gap at 1.6 m or less and every rise at 0.6 m or less.
JUMP_ROUTES = {
    "village-snow-steps": ["np-ledge-step-a", "np-ledge-step-b", "np-ledge-step-c"],
    "village-trampoline": ["np-plat-trampoline"],
    "workshop-crates": ["np-ledge-crate-1", "np-ledge-crate-2", "np-ledge-shelf"],
    "forest-stones": [
        "np-plat-pepper-1",
        "np-plat-pepper-2",
        "np-plat-pepper-3",
        "np-plat-pepper-4",
        "np-plat-pepper-5",
        "np-ledge-candy-mound",
    ],
    "stables-log-hops": ["np-ledge-log-1", "np-ledge-log-2", "np-ledge-log-3"],
    "gingerbread-cookies": ["np-plat-cookie-1", "np-plat-cookie-2", "np-ledge-ginger-roof"],
    "lake-thin-ice": ["np-plat-lake-stone", "np-plat-lake-thin-ice"],
}

# --- builder state ----------------------------------------------------------------------------

_r = lambda v: round(float(v), 3)  # noqa: E731


def _rect(rid: str, min_x, max_x, min_z, max_z) -> dict:
    return {"id": rid, "minX": _r(min_x), "maxX": _r(max_x), "minZ": _r(min_z), "maxZ": _r(max_z)}


class _Build:
    def __init__(self) -> None:
        self.scenery: list[dict] = []
        self.colliders: list[dict] = []  # layout colliders: {"rect", [minY, maxY, jumpable]}
        self.platforms: list[dict] = []
        self.placements: list[dict] = []
        self.stand_ins: list[dict] = []
        self.clusters: dict[str, list[dict]] = {}
        self.cluster_points: list[tuple[float, float]] = []
        self.pine_points: list[tuple[float, float]] = []
        self.keep_clear: list[tuple[float, float, float]] = []  # (x, z, radius)

    # --- geometry -------------------------------------------------------------------------
    def wall(self, wid: str, x0, x1, z0, z1, height: float = 3.0, color: int = WALL) -> None:
        self.scenery.append(
            {"kind": "BOX", "id": wid, "color": color, "area": _rect(f"{wid}:area", x0, x1, z0, z1), "minY": 0, "maxY": height}
        )
        self.colliders.append({"rect": _rect(f"{wid}:collider", x0, x1, z0, z1), "minY": 0, "maxY": height})

    def fence(self, fid: str, x0, x1, z0, z1) -> None:
        """An invisible-height snow lip: a solid collider with no drawing (keeps a fall to one terrace)."""
        self.colliders.append({"rect": _rect(fid, x0, x1, z0, z1), "minY": 0, "maxY": 6})

    def solid(self, cid: str, x0, x1, z0, z1) -> None:
        self.colliders.append({"rect": _rect(cid, x0, x1, z0, z1)})

    def ledge(self, lid: str, x0, x1, z0, z1, top: float, color: int = SNOW, draw: bool = True) -> None:
        if draw:
            self.scenery.append(
                {"kind": "BOX", "id": lid, "color": color, "area": _rect(f"{lid}:area", x0, x1, z0, z1), "minY": 0, "maxY": _r(top)}
            )
        self.colliders.append(
            {"rect": _rect(f"{lid}:collider", x0, x1, z0, z1), "minY": 0, "maxY": _r(top), "jumpable": True}
        )

    def stairs(self, prefix: str, axis: str, edge: float, away: int, lo: float, hi: float, top: float, count: int, color: int = SNOW) -> None:
        """`count` steps of 0.2 m rise, 0.8 m tread, rising toward a terrace whose top is `top`.

        `edge` is the terrace edge on `axis`; `away` (+1 or -1) is the side the steps lie on;
        `lo..hi` is the width on the other axis. Step j (1 nearest the terrace) is `top - 0.2 j`.
        """
        for j in range(1, count + 1):
            near = edge + away * 0.8 * (j - 1)
            far = edge + away * 0.8 * j
            a, b = sorted((near, far))
            height = top - 0.2 * j
            if axis == "z":
                self.ledge(f"{prefix}-{j}", lo, hi, a, b, height, color)
            else:
                self.ledge(f"{prefix}-{j}", a, b, lo, hi, height, color)

    def cluster(self, asset_id: str, x: float, z: float, yaw: float = 0.0, scale: float | None = None, y: float | None = None) -> None:
        position: dict = {"x": _r(x), "z": _r(z), "rotationY": _r(yaw)}
        if y is not None:
            position["y"] = _r(y)
        if scale is not None:
            position["scale"] = {"x": scale, "y": scale, "z": scale}
        self.clusters.setdefault(asset_id, []).append(position)

    def tree(self, asset_id: str, x: float, z: float, half: float = 0.4, yaw: float = 0.0, scale: float | None = None) -> None:
        self.cluster(asset_id, x, z, yaw, scale)
        self.pine_points.append((x, z))
        self.solid(f"np-tree-{len(self.pine_points)}", x - half, x + half, z - half, z + half)

    # --- entities -------------------------------------------------------------------------
    def put(
        self,
        entity_id: str,
        kind: str,
        label: str,
        x: float,
        z: float,
        asset: str,
        size: tuple[float, float, float],
        *,
        elev: float = 0.0,
        yaw: float = 0.0,
        npc: str = "",
        key: str = "",
        shape: str | None = None,
        color: int = SNOW,
        solid: bool = False,
        **stand_in_extra,
    ) -> None:
        self.placements.append(
            {
                "entity_id": entity_id,
                "kind": kind,
                "label": label,
                "x": _r(x),
                "z": _r(z),
                "elevation": _r(elev),
                "rotation_y": _r(yaw),
                "asset_id": asset,
                "npc_id": npc,
                "placeholder_width": _r(size[0]),
                "placeholder_height": _r(size[1]),
                "placeholder_depth": _r(size[2]),
                "pickup_change_key": key,
            }
        )
        if kind != "NPC" and shape:
            self.stand_ins.append({"entityId": entity_id, "shape": shape, "color": color, **stand_in_extra})
        if solid:
            hw, hd = size[0] / 2, size[2] / 2
            if abs(math.sin(yaw)) > 0.7:
                hw, hd = hd, hw
            self.solid(f"np-col-{entity_id}", x - hw, x + hw, z - hd, z + hd)
        self.keep_clear.append((x, z, max(size[0], size[2]) / 2 + 1.0))

    def prop(self, entity_id, label, x, z, asset, size, shape, color, **kw) -> None:
        self.put(entity_id, "PROP", label, x, z, asset, size, shape=shape, color=color, **kw)

    def scenery_entity(self, entity_id, label, x, z, asset, size, shape, color, **kw) -> None:
        self.put(entity_id, "SCENERY", label, x, z, asset, size, shape=shape, color=color, **kw)

    def npc(self, entity_id, npc_id, label, x, z, yaw=0.0) -> None:
        self.put(entity_id, "NPC", label, x, z, "", (0.8, 1.7, 0.8), yaw=yaw, npc=npc_id)

    def pickup(self, entity_id, label, x, z, asset, key, shape, color, elev=0.0, size=(0.5, 0.5, 0.5)) -> None:
        self.put(entity_id, "COLLECTIBLE", label, x, z, asset, size, elev=elev, key=key, shape=shape, color=color)

    def platform(self, pid: str, x: float, z: float, w: float, h: float, d: float, y: float = 0.0, **extra) -> None:
        self.platforms.append(
            {
                "id": pid,
                "size": {"width": w, "height": h, "depth": d},
                "position": {"x": _r(x), "y": _r(y), "z": _r(z)},
                **extra,
            }
        )


# --- the world --------------------------------------------------------------------------------

ASSET_IDS_USED = (
    "north-pole-bridge",
    "north-pole-candy-cane",
    "north-pole-candy-cane-tall",
    "north-pole-christmas-star",
    "north-pole-christmas-tree",
    "north-pole-cookie-platform",
    "north-pole-fragment-socket",
    "north-pole-gingerbread-house",
    "north-pole-golden-bell",
    "north-pole-ice-platform",
    "north-pole-lantern",
    "north-pole-observatory",
    "north-pole-ornament",
    "north-pole-peppermint-platform",
    "north-pole-present",
    "north-pole-signpost",
    "north-pole-sleigh",
    "north-pole-sleigh-bell",
    "north-pole-snowbank",
    "north-pole-snowflake",
    "north-pole-snowman",
    "north-pole-snowy-pine",
    "north-pole-stable",
    "north-pole-star-fragment",
    "north-pole-workshop",
)

PINE = "north-pole-snowy-pine"
CANE_TREE = "north-pole-candy-cane"
LANTERN = "north-pole-lantern"
SNOWMAN = "north-pole-snowman"
PRESENT = "north-pole-present"
SIGNPOST = "north-pole-signpost"

FRAGMENT_ZONES = ("village", "workshop", "forest", "lake", "stables", "gingerbread", "mountain")


def _walls(b: _Build) -> None:
    n = 0

    def seg(x0, x1, z0, z1, h=3.0):
        nonlocal n
        n += 1
        b.wall(f"np-snowbank-{n:02d}", x0, x1, z0, z1, h)

    # West and east walls of the central corridor, with a gap at every gate.
    for z0, z1 in ((56, 100), (14, 52), (-40, 10), (-66, -44)):
        seg(-26, -24, z0, z1)
    for z0, z1 in ((56, 100), (22, 52), (-66, 18)):
        seg(24, 26, z0, z1)
    # Rows between zones.
    seg(-66, -26, 34, 36)
    seg(26, 66, 34, 36)
    seg(-66, -26, -20, -18)
    for x0, x1 in ((-66, -48), (-44, -26), (-26, -1.5), (1.5, 66)):
        seg(x0, x1, -68, -66)
    # The divider between the mountain and the observatory: solid in the north, a lane in the south.
    seg(-2, 2, -100, -86)
    seg(-2, -1.5, -82, -68)
    seg(1.5, 2, -82, -68)
    # The east edge of the mountain terraces: nobody walks off a three metre cliff.
    seg(-12, -11, -100, -76, 4.0)
    # The ice cave (landing, south east): walls and a gate in the north wall.
    seg(13, 14, 92, 100)
    seg(14, 18, 90, 92)
    seg(22, 24, 90, 92)


def _gates(b: _Build) -> list[dict]:
    colliders = []
    for gate_id, ((x0, x1, z0, z1), _key) in GATES.items():
        colliders.append({"id": gate_id, "minX": x0, "maxX": x1, "minZ": z0, "maxZ": z1})
    return colliders


def _drifts(b: _Build) -> None:
    """The snowdrift that fills each gate: drawn, and hidden once its key exists."""
    for gate_id, ((x0, x1, z0, z1), key) in GATES.items():
        b.put(
            gate_id.replace("np-gate-", "np-drift-"),
            "SCENERY",
            "A big snowdrift",
            (x0 + x1) / 2,
            (z0 + z1) / 2,
            "north-pole-snowbank",
            (max(x1 - x0, 1.0), 2.4, max(z1 - z0, 1.0)),
            shape="ROCK",
            color=DRIFT,
            hiddenWhenChangeKey=key,
        )


def _landing(b: _Build) -> None:
    b.npc("np-jingle", "jingle", "Jingle", -4, 86, yaw=SOUTH)
    b.npc("np-santa", "santa-claus", "Santa Claus", -10, 82, yaw=SOUTH)
    # Santa's sleigh: a platform that lifts off once, up and away, on Christmas Eve.
    b.platform(
        "np-sleigh", 10, 86, 5, 1.0, 7, assetId="north-pole-sleigh", color=RED,
        motion={"path": [{"x": 0, "y": 40, "z": -45}], "speed": 4.0, "mode": "ONCE"},
        activation={"trigger": "SIGNAL", "source": f"world:{CH['eve']}"},
        indicator=False,
    )
    b.prop("np-sleigh-bell", "Santa's sleigh bell", 14, 82, "north-pole-sleigh-bell", (0.6, 0.8, 0.6), "LANTERN", GOLD)
    # Ice cave (post-story): three golden bells.
    for i, (x, z) in enumerate(((16.5, 96.0), (20.0, 97.0), (22.5, 94.5)), start=1):
        b.pickup(f"np-golden-bell-{i}", "Golden bell", x, z, "north-pole-golden-bell", f"NORTH_POLE_GOLDEN_BELL_{i}", "LANTERN", GOLD, 0.2)
    b.scenery_entity("np-ice-cave-sign", "The ice cave", 20, 88.6, SIGNPOST, (0.6, 1.8, 0.3), "SIGN", ICE)
    # Decor.
    b.scenery_entity("np-landing-snowman", "Snowman", -16, 90, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-landing-gifts", "A pile of presents", 16, 78, PRESENT, (1.6, 1.0, 1.6), "GIFT", RED, solid=True)
    for i, (x, z) in enumerate(((-3.5, 94), (3.5, 94), (-3.5, 82), (3.5, 82), (-3.5, 78), (3.5, 78)), start=1):
        b.cluster(LANTERN, x, z)
        b.solid(f"np-landing-lantern-{i}", x - 0.25, x + 0.25, z - 0.25, z + 0.25)


def _village(b: _Build) -> None:
    # The jump tutorial: snow steps 0.25, 0.5 and 0.8 m, the fragment on top, and a stair beside.
    b.ledge("np-ledge-step-a", -17, -15.4, 66, 69.8, 0.25)
    b.ledge("np-ledge-step-b", -15.4, -13.8, 66, 69.8, 0.5)
    b.ledge("np-ledge-step-c", -13.8, -10.8, 66, 69.8, 0.8)
    b.stairs("np-stair-village", "z", 69.8, +1, -13.8, -10.8, 0.8, 3)
    b.pickup("np-fragment-village", "Star fragment", -12.3, 67.9, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_VILLAGE", "STAR", GOLD, 0.8, (0.6, 0.6, 0.6))
    # The plaza: the giant Christmas tree and the five landmarks of the welcome look.
    b.scenery_entity("np-landmark-tree", "The giant Christmas tree", 0, 52, "north-pole-christmas-tree", (4.0, 10.0, 4.0), "PINE", GREEN, solid=True)
    b.scenery_entity("np-landmark-cottage", "Santa's cottage", 15, 66, "north-pole-gingerbread-house", (6.0, 4.5, 5.0), "HOUSE", RED, solid=True)
    b.scenery_entity("np-landmark-snowman", "Big snowman", -9, 46, SNOWMAN, (1.4, 2.0, 1.4), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-landmark-lantern", "The plaza lantern", 7, 60, LANTERN, (0.5, 3.0, 0.5), "LANTERN", GOLD, solid=True)
    b.scenery_entity("np-landmark-gifts", "The present pile", 10, 42, PRESENT, (1.8, 1.2, 1.8), "GIFT", PEPPERMINT, solid=True)
    b.scenery_entity("np-village-cottage-2", "A snug cottage", -17, 38, "north-pole-gingerbread-house", (5.0, 4.0, 5.0), "HOUSE", BROWN, solid=True)
    b.scenery_entity("np-village-cottage-3", "A cosy cottage", 17, 36, "north-pole-gingerbread-house", (5.0, 4.0, 5.0), "HOUSE", 0x4F7CAC, solid=True)
    b.scenery_entity("np-village-snowman-2", "Snowman", 12, 56, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    for i, (x, z) in enumerate(((-4.5, 70), (4.5, 70), (-4.5, 62), (4.5, 62), (-4.5, 44), (4.5, 44), (-4.5, 36), (4.5, 36)), start=1):
        b.cluster(LANTERN, x, z)
        b.solid(f"np-village-lantern-{i}", x - 0.25, x + 0.25, z - 0.25, z + 0.25)
    for sid, label, x, z in (
        ("np-signpost-workshop", "To Santa's Workshop", -9, 57),
        ("np-signpost-forest", "To the Candy Cane Forest", 9, 57),
    ):
        b.prop(sid, label, x, z, SIGNPOST, (0.5, 2.0, 0.3), "SIGN", WOOD)
    # A snow trampoline and a high ledge (optional).
    b.platform("np-plat-trampoline", -6, 36, 2.4, 0.4, 2.4, color=0x7FD1F5, bounce={"height": 2.8})
    b.ledge("np-ledge-snow-roof", -9.5, -5.5, 28, 31, 2.0, SNOW)
    b.pickup("np-snowflake-01", "Snowflake", -7.5, 29.5, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_01", "STAR", ICE, 2.0, (0.4, 0.4, 0.1))
    b.pickup("np-snowflake-02", "Snowflake", -15.0, 67.8, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_02", "STAR", ICE, 0.5, (0.4, 0.4, 0.1))
    b.pickup("np-ornament-1", "Christmas ornament", -21.5, 44, "north-pole-ornament", "NORTH_POLE_ORNAMENT_1", "STAR", PEPPERMINT, 0.3, (0.4, 0.4, 0.4))
    b.pickup("np-ornament-2", "Christmas ornament", 21.5, 62, "north-pole-ornament", "NORTH_POLE_ORNAMENT_2", "STAR", GOLD, 0.3, (0.4, 0.4, 0.4))


def _workshop(b: _Build) -> None:
    b.npc("np-tinker", "tinker", "Tinker", -35, 56, yaw=EAST)
    b.scenery_entity("np-workshop-building", "Santa's workshop", -55, 90, "north-pole-workshop", (18.0, 7.0, 14.0), "HOUSE", RED, solid=True)
    # Stations, in an arc in the yard.
    b.prop("np-workshop-count-board", "Toy counting board", -40, 62, "", (1.4, 1.6, 0.4), "SIGN", WOOD)
    b.prop("np-workshop-sort-bins", "Present sorting bins", -37, 68, "", (2.0, 1.0, 1.0), "BOX", PEPPERMINT)
    b.prop("np-workshop-belt-sign", "Belt pattern sign", -47, 74, "", (1.4, 1.6, 0.4), "SIGN", GREEN)
    b.prop("np-workshop-assembly-bench", "Toy assembly bench", -42, 78, "", (2.0, 1.0, 1.0), "BOX", BROWN)
    b.scenery_entity("np-workshop-gift-spot", "A tidy gift stack", -33, 80, PRESENT, (1.2, 1.0, 1.2), "GIFT", GREEN, solid=True)
    # The conveyor: a belt that rides east and west (optional).
    b.platform(
        "np-conveyor", -44, 64, 6, 0.5, 2.4, color=0x555B66,
        motion={"path": [{"x": 0, "y": 0, "z": 6}], "speed": 1.0, "pauseSeconds": 2},
    )
    # Crate shelves with a long stair to the high shelf (fragment), and crates to jump (optional).
    b.ledge("np-ledge-shelf", -64, -58, 74, 80, 1.6, WOOD)
    b.stairs("np-stair-shelf", "x", -58, +1, 75, 79, 1.6, 7, WOOD)
    b.ledge("np-ledge-crate-1", -57, -55, 70, 72, 0.6, 0xC8A46A)
    b.ledge("np-ledge-crate-2", -60.4, -58.4, 71.4, 73.4, 1.1, 0xC8A46A)
    b.pickup("np-fragment-workshop", "Star fragment", -61, 77, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_WORKSHOP", "STAR", GOLD, 1.6, (0.6, 0.6, 0.6))
    b.pickup("np-snowflake-03", "Snowflake", -59.4, 72.4, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_03", "STAR", ICE, 1.1, (0.4, 0.4, 0.1))
    # Toy decor: crate walls and gifts.
    for i, (x, z) in enumerate(((-33, 90), (-30, 66), (-34, 46)), start=1):
        b.scenery_entity(f"np-workshop-gifts-{i}", "A stack of presents", x, z, PRESENT, (1.4, 1.2, 1.4), "GIFT", (PEPPERMINT, GOLD, GREEN)[i - 1], solid=True)
    b.scenery_entity("np-workshop-snowman", "Snowman", -48, 48, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.pickup("np-ornament-3", "Christmas ornament", -64.5, 42, "north-pole-ornament", "NORTH_POLE_ORNAMENT_3", "STAR", GREEN, 0.3, (0.4, 0.4, 0.4))


def _forest(b: _Build) -> None:
    b.npc("np-peppermint", "peppermint", "Peppermint", 35, 58, yaw=WEST)
    b.prop("np-forest-sequence-sign", "Number path sign", 40, 64, "", (1.4, 1.6, 0.4), "SIGN", PEPPERMINT)
    b.prop("np-forest-signs-post", "Direction signpost", 44, 72, SIGNPOST, (0.6, 2.2, 0.4), "SIGN", WOOD)
    b.prop("np-forest-stripes-arch", "Candy stripe arch", 46, 82, "north-pole-candy-cane-tall", (2.4, 2.6, 0.6), "CANE", PEPPERMINT)
    # The frozen creek, a walking bridge, and the peppermint stepping stones (optional).
    b.ledge("np-bridge-creek", 51, 55, 66, 70, 0.2, WOOD)
    for i, x in enumerate((47.5, 50.5, 53.5, 56.5, 59.5), start=1):
        b.platform(f"np-plat-pepper-{i}", x, 46, 1.8, 0.4, 1.8, assetId="north-pole-peppermint-platform", color=PEPPERMINT)
    b.ledge("np-ledge-candy-mound", 61, 65, 44, 48, 0.4, 0xFFFFFF)
    b.stairs("np-stair-candy", "z", 48, +1, 61, 65, 0.4, 1)
    b.pickup("np-fragment-forest", "Star fragment", 63, 46, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_FOREST", "STAR", GOLD, 0.4, (0.6, 0.6, 0.6))
    b.pickup("np-snowflake-04", "Snowflake", 56.5, 46, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_04", "STAR", ICE, 0.9, (0.4, 0.4, 0.1))
    for i, (x, z) in enumerate(((32, 84), (42, 92), (38, 44), (60, 84), (62, 60)), start=1):
        b.pickup(f"np-candy-cane-{i}", "Candy cane", x, z, "north-pole-candy-cane", f"NORTH_POLE_CANDY_CANE_{i}", "CANE", PEPPERMINT, 0.3, (0.4, 0.8, 0.4))
    for i, (x, z) in enumerate(((31, 76), (58, 90), (45, 56)), start=1):
        b.scenery_entity(f"np-forest-gifts-{i}", "Sweet gifts", x, z, PRESENT, (1.2, 1.0, 1.2), "GIFT", (PEPPERMINT, GREEN, GOLD)[i - 1], solid=True)
    b.scenery_entity("np-forest-snowman", "Snowman", 36, 40, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)


def _lake(b: _Build) -> None:
    b.npc("np-frosty", "frosty", "Frosty", -34, 22, yaw=WEST)
    # The east bank: floes for the sums puzzle and the order puzzle (flat ice shapes on the bank).
    for key, z in (("a", 18), ("b", 22), ("c", 26)):
        b.prop(f"np-lake-floe-{key}", f"Ice floe {key.upper()}", -39, z, "north-pole-ice-platform", (2.4, 0.3, 2.4), "BOX", ICE)
    for key, z in (("a", 0), ("b", -4), ("c", -8), ("d", -12)):
        b.prop(f"np-lake-order-floe-{key}", f"Order floe {key.upper()}", -39, z, "north-pole-ice-platform", (2.4, 0.3, 2.4), "BOX", 0xA6D8F0)
    b.prop("np-lake-shapes-board", "Shapes and fractions board", -32, 30, "", (1.6, 1.6, 0.4), "SIGN", WOOD)
    # Open water between the bank and the island; the ice bridge appears over it.
    b.platform(
        "np-lake-bridge", -47.25, 12.6, 8.5, 0.2, 2.4, assetId="north-pole-bridge", color=0xE8F6FF,
        activation={"trigger": "SIGNAL", "source": f"world:{CH['lake_bridge']}", "hiddenUntilActive": True},
    )
    # An optional way across the water: a stone, a thin ice platform, and a floe that rides.
    b.platform("np-plat-lake-stone", -46.0, 26, 1.6, 0.4, 1.6, assetId="north-pole-ice-platform", color=ICE)
    b.platform(
        "np-plat-lake-thin-ice", -48.2, 26, 1.6, 0.3, 1.6, color=0xDDF3FF,
        vanish={"mode": "STAND", "visibleSeconds": 3, "hiddenSeconds": 2.5, "warningSeconds": 1},
    )
    b.platform(
        "np-plat-lake-floe-ride", -47.2, 4, 3, 0.3, 3, assetId="north-pole-ice-platform", color=ICE,
        motion={"path": [{"x": 0, "y": 0, "z": 8}], "speed": 0.8, "pauseSeconds": 3},
    )
    # The island.
    b.pickup("np-fragment-lake", "Star fragment", -58, 12, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_LAKE", "STAR", GOLD, 0.0, (0.6, 0.6, 0.6))
    b.pickup("np-snowflake-05", "Snowflake", -48.2, 26, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_05", "STAR", ICE, 0.5, (0.4, 0.4, 0.1))
    b.scenery_entity("np-lake-snowman", "Snowman", -60, 22, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-lake-gifts", "A lonely present", -62, 2, PRESENT, (1.2, 1.0, 1.2), "GIFT", PEPPERMINT, solid=True)


def _stables(b: _Build) -> None:
    b.npc("np-noel", "noel", "Noel", 34, 22, yaw=WEST)
    b.scenery_entity("np-stable-building", "The reindeer stable", 50, 28, "north-pole-stable", (14.0, 4.5, 6.0), "HOUSE", BROWN, solid=True)
    for i, (x, z) in enumerate(((44, 18), (50, 16), (56, 19)), start=1):
        b.scenery_entity(f"np-reindeer-{i}", "A reindeer", x, z, "", (1.6, 1.6, 0.8), "ANIMAL", 0x9C6B3C, solid=True)
    b.prop("np-stables-facts-board", "Reindeer facts board", 38, 12, "", (1.6, 1.6, 0.4), "SIGN", WOOD)
    b.prop("np-stables-tracks-sign", "Footprint sign", 44, 6, SIGNPOST, (0.6, 2.0, 0.4), "SIGN", WOOD)
    b.prop("np-stables-supplies-crate", "Supplies crate", 60, 12, "", (1.4, 1.0, 1.0), "BOX", WOOD)
    for i, (x, z) in enumerate(((40.8, 1.0), (40.6, -8.0), (44.2, -16.0), (49.0, -26.0), (51.6, -35.0), (49.4, -44.0)), start=1):
        b.prop(f"np-track-{i}", "Footprints", x, z, "", (0.5, 0.1, 0.8), "MARKER", 0x8FA7BE, yaw=0.3 * i)
    b.npc("np-snowball", "snowball", "Snowball", 52, -55, yaw=NORTH)
    b.pickup("np-snowball-collar", "Snowball's collar", 49.5, -53.5, "", "NORTH_POLE_SNOWBALL_FOUND", "MARKER", PEPPERMINT, 0.1, (0.4, 0.2, 0.4))
    b.pickup("np-fragment-stables", "Star fragment", 55.5, -57, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_STABLES", "STAR", GOLD, 0.0, (0.6, 0.6, 0.6))
    # Log hops (optional): three logs with 1.4 m gaps, off the path.
    b.ledge("np-ledge-log-1", 59.4, 60.6, -23.5, -20.5, 0.5, 0x7B5235)
    b.ledge("np-ledge-log-2", 59.4, 60.6, -19.1, -16.1, 0.5, 0x7B5235)
    b.ledge("np-ledge-log-3", 59.4, 60.6, -14.7, -11.7, 0.5, 0x7B5235)
    b.pickup("np-snowflake-06", "Snowflake", 60, -17.6, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_06", "STAR", ICE, 0.9, (0.4, 0.4, 0.1))
    b.scenery_entity("np-stables-snowman", "Snowman", 32, 28, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)


def _gingerbread(b: _Build) -> None:
    b.npc("np-ginger", "ginger", "Ginger", -34, -38, yaw=WEST)
    b.npc("np-mrs-claus", "mrs-claus", "Mrs. Claus", -44, -46, yaw=EAST)
    b.scenery_entity("np-ginger-house-1", "Gingerbread house", -38, -26, "north-pole-gingerbread-house", (6.0, 4.0, 5.0), "HOUSE", COOKIE, solid=True)
    b.scenery_entity("np-ginger-bakery", "Mrs. Claus's bakery", -38, -58, "north-pole-gingerbread-house", (8.0, 4.5, 6.0), "HOUSE", CAKE, solid=True)
    b.scenery_entity("np-ginger-house-4", "Gingerbread house", -58, -54, "north-pole-gingerbread-house", (6.0, 4.0, 5.0), "HOUSE", BROWN, solid=True)
    # A low gingerbread roof reached by a sweet ramp (walk) or the cookies (hop).
    b.ledge("np-ledge-ginger-roof", -62, -54, -38, -30, 1.6, COOKIE)
    b.stairs("np-ramp-ginger", "x", -54, +1, -36, -32, 1.6, 7, COOKIE)
    b.platform("np-plat-cookie-1", -60, -43, 2.0, 0.6, 2.0, assetId="north-pole-cookie-platform", color=COOKIE)
    b.platform("np-plat-cookie-2", -60, -40.4, 2.0, 1.1, 2.0, assetId="north-pole-cookie-platform", color=0xE0A869)
    b.pickup("np-fragment-gingerbread", "Star fragment", -59, -34, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_GINGERBREAD", "STAR", GOLD, 1.6, (0.6, 0.6, 0.6))
    b.pickup("np-cookie-1", "Gingerbread cookie", -57, -31.5, "", "NORTH_POLE_COOKIE_1", "MARKER", COOKIE, 1.6, (0.4, 0.1, 0.4))
    b.pickup("np-cookie-2", "Gingerbread cookie", -44, -63, "", "NORTH_POLE_COOKIE_2", "MARKER", COOKIE, 0.1, (0.4, 0.1, 0.4))
    b.pickup("np-cookie-3", "Gingerbread cookie", -30, -24, "", "NORTH_POLE_COOKIE_3", "MARKER", COOKIE, 0.1, (0.4, 0.1, 0.4))
    b.pickup("np-snowflake-07", "Snowflake", -60, -41.8, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_07", "STAR", ICE, 0.7, (0.4, 0.4, 0.1))
    # Stations and the beam puzzle.
    b.prop("np-ginger-shapes-board", "Shape matching board", -31, -30, "", (1.6, 1.6, 0.4), "SIGN", COOKIE)
    b.prop("np-ginger-symmetry-window", "The symmetric window", -48, -27, "", (1.6, 1.8, 0.4), "SIGN", PEPPERMINT)
    b.prop("np-ginger-recipe-card", "Mrs. Claus's recipe card", -47, -49, "", (0.8, 1.2, 0.4), "SIGN", WOOD)
    b.prop("np-ginger-measure-table", "Measuring table", -52, -45, "", (2.0, 1.0, 1.0), "BOX", WOOD)
    for i, (x, z) in enumerate(((-31, -58), (-31, -54), (-31, -50)), start=1):
        b.prop(f"np-ginger-stone-{i}", f"Cookie beam {i}", x, z, "north-pole-cookie-platform", (2.0 + i * 0.5, 0.4, 1.0), "BOX", COOKIE)
    for i, (x, z) in enumerate(((-54, -60), (-50, -60), (-46, -60)), start=1):
        b.prop(f"np-ginger-slot-{i}", f"Wall gap {i}", x, z, "", (1.6, 0.2, 1.0), "MARKER", GOLD)
    b.scenery_entity("np-ginger-snowman", "Gingerbread snowman", -30, -34, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-ginger-gifts", "Candy gifts", -62, -24, PRESENT, (1.4, 1.2, 1.4), "GIFT", GREEN, solid=True)


def _mountain(b: _Build) -> None:
    """Four wide terraces (0.8, 1.6, 2.4, 3.2 m). Stairs of 0.2 m rises are always available; the
    ledges are optional 0.8 m hops. Two chasms are notches bridged by hidden signal bridges."""
    colors = (0xEAF4FF, 0xDDEBFA, 0xCFE0F4, 0xC2D6EE)
    # T1 (0.8): z -100..-76. West and east parts, and the cap over the notch's north end.
    b.ledge("np-mt-t1-west", -66, -38, -100, -76, 0.8, colors[0])
    b.ledge("np-mt-t1-east", -32, -12, -100, -76, 0.8, colors[0])
    b.ledge("np-mt-t1-cap", -38, -32, -100, -82, 0.8, colors[0], draw=False)
    # T2 (1.6): z -100..-82, full width.
    b.ledge("np-mt-t2", -66, -12, -100, -82, 1.6, colors[1])
    # T3 (2.4): z -100..-88, west and east parts and a cap.
    b.ledge("np-mt-t3-west", -66, -38, -100, -88, 2.4, colors[2])
    b.ledge("np-mt-t3-east", -32, -12, -100, -88, 2.4, colors[2])
    b.ledge("np-mt-t3-cap", -38, -32, -100, -94, 2.4, colors[2], draw=False)
    # T4 (3.2): the summit, z -100..-94.
    b.ledge("np-mt-t4", -66, -12, -100, -94, 3.2, colors[3])
    # Stairs: apron to T1 (west), T1 to T2 (east), T2 to T3 (west), T3 to T4 (east).
    b.stairs("np-mt-s1", "z", -76, +1, -56, -50, 0.8, 3)
    b.stairs("np-mt-s2", "z", -82, +1, -22, -16, 1.6, 3)
    b.stairs("np-mt-s3", "z", -88, +1, -58, -52, 2.4, 3)
    b.stairs("np-mt-s4", "z", -94, +1, -22, -16, 3.2, 3)
    # Snow lips so a slip off an edge over a notch is still one terrace.
    b.fence("np-mt-lip-1", -38, -32, -82.5, -82)
    b.fence("np-mt-lip-2", -38, -32, -94.5, -94)
    # Hidden bridges (appear when the lever chest is solved).
    b.platform(
        "np-mt-bridge-1", -35, -79, 7, 0.3, 2.4, y=0.5, assetId="north-pole-bridge", color=0xE8F6FF,
        activation={"trigger": "SIGNAL", "source": f"world:{CH['bridge1']}", "hiddenUntilActive": True},
    )
    b.platform(
        "np-mt-bridge-2", -35, -91, 7, 0.3, 2.4, y=2.1, assetId="north-pole-bridge", color=0xE8F6FF,
        activation={"trigger": "SIGNAL", "source": f"world:{CH['bridge2']}", "hiddenUntilActive": True},
    )
    b.npc("np-jingle-mountain", "jingle", "Jingle", -42, -72, yaw=NORTH)
    b.prop("np-summit-weather-station", "The weather station", -30, -97, "", (1.6, 2.4, 1.0), "SIGN", ICE, elev=3.2)
    b.pickup("np-fragment-mountain", "Star fragment", -16, -97, "north-pole-star-fragment", "NORTH_POLE_FRAGMENT_MOUNTAIN", "STAR", GOLD, 3.2, (0.6, 0.6, 0.6))
    b.pickup("np-snowflake-08", "Snowflake", -14, -79, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_08", "STAR", ICE, 0.8, (0.4, 0.4, 0.1))
    b.pickup("np-snowflake-09", "Snowflake", -60, -85, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_09", "STAR", ICE, 1.6, (0.4, 0.4, 0.1))
    b.pickup("np-snowflake-10", "Snowflake", -60, -97, "north-pole-snowflake", "NORTH_POLE_SNOWFLAKE_10", "STAR", ICE, 3.2, (0.4, 0.4, 0.1))
    b.scenery_entity("np-mountain-snowman", "Snowman", -24, -72, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-summit-flag", "The summit flag", -22, -97, SIGNPOST, (0.4, 3.0, 0.4), "SIGN", RED, elev=3.2)


def _observatory(b: _Build) -> None:
    b.npc("np-polaris", "polaris", "Polaris", 16, -80, yaw=SOUTH)
    b.scenery_entity("np-observatory-dome", "The observatory dome", 42, -95, "north-pole-observatory", (14.0, 8.0, 8.0), "DOME", 0xE9EEF7, solid=True)
    # The terrace in front of the dome, reached by a ramp of 0.2 m stairs.
    b.ledge("np-ledge-obs-terrace", 24, 60, -91, -82, 0.8, 0xE6EDF7)
    b.stairs("np-stair-obs", "z", -82, +1, 38, 46, 0.8, 3, 0xE6EDF7)
    for i, zone in enumerate(FRAGMENT_ZONES):
        b.prop(f"np-socket-{zone}", f"Fragment socket {i + 1}", 28 + 4 * i, -87, "north-pole-fragment-socket", (0.8, 1.0, 0.8), "PEDESTAL", 0x6E6A7A, elev=0.8)
    b.prop("np-obs-final-console", "The star console", 56, -85, "", (1.6, 1.4, 1.0), "PEDESTAL", GOLD, elev=0.8)
    b.prop("np-obs-stars-telescope", "The big telescope", 22, -76, "", (1.2, 2.0, 1.2), "TELESCOPE", 0x8C6A3F)
    b.prop("np-obs-constellation-board", "Constellation board", 30, -74, "", (1.8, 1.6, 0.4), "SIGN", 0x3A4A7A)
    b.prop("np-obs-sequence-dial", "Night sky dial", 12, -92, "", (1.2, 1.4, 1.2), "PEDESTAL", 0x3A4A7A)
    b.prop("np-observatory-sled", "The sled home", 60, -76, "", (2.4, 1.2, 1.6), "SLEIGH", RED)
    b.scenery_entity("np-obs-snowman", "Star-gazing snowman", 8, -74, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    b.scenery_entity("np-obs-gifts", "A present", 62, -92, PRESENT, (1.2, 1.0, 1.2), "GIFT", GREEN, solid=True)
    # The restored Star above the dome, shown once the key exists.
    b.scenery_entity(
        "np-christmas-star", "The Christmas Star", 42, -90, "north-pole-christmas-star", (3.0, 3.0, 0.6), "STAR", GOLD,
        elev=11.0, shownWhenChangeKey=CH["star"],
    )


def _north_road(b: _Build) -> None:
    for i, z in enumerate((22, 10, -2, -14, -26, -38, -50, -62), start=1):
        for side, x in (("w", -5), ("e", 5)):
            b.cluster(LANTERN, x, z)
            b.solid(f"np-road-lantern-{i}{side}", x - 0.25, x + 0.25, z - 0.25, z + 0.25)
    for sid, label, x, z in (
        ("np-signpost-lake", "To the Frozen Lake", -8, 15),
        ("np-signpost-stables", "To the Reindeer Stables", 8, 23),
        ("np-signpost-gingerbread", "To Gingerbread Village", -8, -37),
        ("np-signpost-mountain", "To Snowflake Mountain", -8, -61),
    ):
        b.prop(sid, label, x, z, SIGNPOST, (0.5, 2.0, 0.3), "SIGN", WOOD)
    for i, (x, z) in enumerate(((7, 2), (-9, -22), (10, -46)), start=1):
        b.scenery_entity(f"np-road-snowman-{i}", "Snowman", x, z, SNOWMAN, (1.2, 1.8, 1.2), "SNOWMAN", SNOW, solid=True)
    for i, (x, z) in enumerate(((-12, 4), (12, -30)), start=1):
        b.scenery_entity(f"np-road-gifts-{i}", "A present", x, z, PRESENT, (1.2, 1.0, 1.2), "GIFT", (RED, GOLD)[i - 1], solid=True)
    b.pickup("np-ornament-4", "Christmas ornament", 20, -8, "north-pole-ornament", "NORTH_POLE_ORNAMENT_4", "STAR", PEPPERMINT, 0.3, (0.4, 0.4, 0.4))
    b.pickup("np-ornament-5", "Christmas ornament", -20, -52, "north-pole-ornament", "NORTH_POLE_ORNAMENT_5", "STAR", GOLD, 0.3, (0.4, 0.4, 0.4))


# Where trees may stand: (area, tree asset, minimum spacing). Each tree is a small solid trunk.
_PINE_BELTS = (
    ((-23.2, -18.5, 77, 98), PINE),
    ((18.5, 23.2, 77, 89), PINE),
    ((-23.2, -18.5, 30, 74), PINE),
    ((18.5, 23.2, 30, 74), PINE),
    ((-23.2, -16, -66, 28), PINE),
    ((16, 23.2, -66, 28), PINE),
    ((-65, -28, 37, 98), PINE),
    ((28, 65, 37, 98), CANE_TREE),
    ((-65, -28, -17, 33), PINE),
    ((28, 65, 9, 33), PINE),
    ((28, 65, -65, 8), PINE),
    ((-65, -28, -65, -21), PINE),
    ((-65, -13, -75, -68), PINE),
    ((4, 65, -99, -69), PINE),
)
# The footprint trail through Pine Hollow: nothing grows within 3.2 m of it.
_HOLLOW_PATH = ((40, 6), (40, -4), (43, -14), (48, -24), (52, -32), (49, -42), (50, -52))


def _near_path(x: float, z: float, path, radius: float) -> bool:
    for (ax, az), (bx, bz) in zip(path, path[1:], strict=False):
        dx, dz = bx - ax, bz - az
        t = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
        if math.hypot(x - (ax + t * dx), z - (az + t * dz)) < radius:
            return True
    return False


def _in(rect_xyxy: tuple[float, float, float, float], x: float, z: float, margin: float) -> bool:
    x0, x1, z0, z1 = rect_xyxy
    return x0 - margin <= x <= x1 + margin and z0 - margin <= z <= z1 + margin


def _trees(b: _Build) -> None:
    """Deterministic jittered grid of pines and candy canes in the belts, clear of everything else."""
    seed = 20261118
    blockers = [c["rect"] for c in b.colliders]
    for p in b.platforms:
        s, q = p["size"], p["position"]
        blockers.append(_rect("p", q["x"] - s["width"] / 2, q["x"] + s["width"] / 2, q["z"] - s["depth"] / 2, q["z"] + s["depth"] / 2))
    gate_rects = [g[0] for g in GATES.values()]
    water = (-50, -44.5, -18, 34)
    bridge_lane = (-52, -42, 10, 15)
    for (x0, x1, z0, z1), asset in _PINE_BELTS:
        z = z0 + 1.0
        row = 0
        while z <= z1 - 1.0:
            x = x0 + 1.0 + (1.5 if row % 2 else 0.0)
            while x <= x1 - 1.0:
                seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
                jx = ((seed >> 8) % 100) / 100 * 1.6 - 0.8
                seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
                jz = ((seed >> 8) % 100) / 100 * 1.6 - 0.8
                px, pz = round(x + jx, 2), round(z + jz, 2)
                x += 3.6
                if not (x0 + 0.6 <= px <= x1 - 0.6 and z0 + 0.6 <= pz <= z1 - 0.6):
                    continue
                if any(math.hypot(px - qx, pz - qz) < 4.4 for qx, qz in b.pine_points):
                    continue
                if any(math.hypot(px - kx, pz - kz) < kr + 0.8 for kx, kz, kr in b.keep_clear):
                    continue
                if any(
                    r["minX"] - 1.8 <= px <= r["maxX"] + 1.8 and r["minZ"] - 1.8 <= pz <= r["maxZ"] + 1.8 for r in blockers
                ):
                    continue
                if any(_in(g, px, pz, 5.0) for g in gate_rects):
                    continue
                if _in(water, px, pz, 1.5) or _in(bridge_lane, px, pz, 0):
                    continue
                if _near_path(px, pz, _HOLLOW_PATH, 3.4):
                    continue
                b.tree(asset, px, pz, half=0.4, yaw=((seed >> 4) % 628) / 100)
            z += 3.4
            row += 1


def _scenery_planes(b: _Build) -> None:
    plane = lambda pid, color, x0, x1, z0, z1, y: {  # noqa: E731
        "kind": "FLAT_PLANE", "id": pid, "color": color, "area": _rect(f"{pid}:area", x0, x1, z0, z1), "y": y,
    }
    b.scenery.insert(0, plane("np-snow-ground", SNOW, -66, 66, -100, 100, 0.01))
    b.scenery.insert(1, plane("np-lake-ice", ICE, -66, -42, -18, 34, 0.02))
    b.scenery.insert(2, plane("np-lake-water", WATER, -50, -44.5, -18, 34, 0.03))
    b.scenery.insert(3, plane("np-forest-creek", ICE, 51, 55, 38, 96, 0.02))
    b.scenery.insert(4, plane("np-road-snow", 0xFFFFFF, -3, 3, -64, 99, 0.012))
    b.scenery.insert(5, plane("np-village-plaza", 0xE8F0FA, -12, 12, 40, 64, 0.012))
    b.scenery.insert(6, plane("np-hollow-path", 0xE2ECF6, 38, 54, -58, 8, 0.012))


def _build() -> _Build:
    b = _Build()
    _walls(b)
    _landing(b)
    _village(b)
    _workshop(b)
    _forest(b)
    _lake(b)
    _stables(b)
    _gingerbread(b)
    _mountain(b)
    _observatory(b)
    _north_road(b)
    _drifts(b)
    _trees(b)
    _scenery_planes(b)
    return b


_B = _build()

PLACEMENTS: list[dict] = _B.placements

CHEST_SPOTS = {
    "np-workshop-gift-chest": {"x": -34, "z": 72, "elevation": 0.0, "rotation_y": EAST, "label": "Tinker's gift chest"},
    "np-mountain-lever-1": {"x": -42, "z": -79, "elevation": 0.8, "rotation_y": NORTH, "label": "The first bridge lever"},
    "np-mountain-lever-2": {"x": -42, "z": -91, "elevation": 2.4, "rotation_y": NORTH, "label": "The second bridge lever"},
    "np-replay-workshop-sums": {"x": -30, "z": 84, "elevation": 0.0, "rotation_y": WEST, "label": "Workshop practice chest"},
    "np-replay-lake-count": {"x": -32, "z": 8, "elevation": 0.0, "rotation_y": WEST, "label": "Lake practice chest"},
}

PUZZLE_ENTITIES = {
    "np-welcome-look": ["np-landmark-tree", "np-landmark-cottage", "np-landmark-snowman", "np-landmark-lantern", "np-landmark-gifts"],
    "np-workshop-count": ["np-workshop-count-board"],
    "np-workshop-sort": ["np-workshop-sort-bins"],
    "np-workshop-pattern": ["np-workshop-belt-sign"],
    "np-workshop-assemble": ["np-workshop-assembly-bench"],
    "np-forest-sequence": ["np-forest-sequence-sign"],
    "np-forest-signs": ["np-forest-signs-post"],
    "np-forest-stripes": ["np-forest-stripes-arch"],
    "np-lake-sums": ["np-lake-floe-a", "np-lake-floe-b", "np-lake-floe-c"],
    "np-lake-order": ["np-lake-order-floe-a", "np-lake-order-floe-b", "np-lake-order-floe-c", "np-lake-order-floe-d"],
    "np-lake-shapes": ["np-lake-shapes-board"],
    "np-stables-facts": ["np-stables-facts-board"],
    "np-stables-tracks": ["np-stables-tracks-sign", *[f"np-track-{i}" for i in range(1, 7)]],
    "np-stables-supplies": ["np-stables-supplies-crate"],
    "np-stables-return": ["np-noel"],
    "np-ginger-shapes": ["np-ginger-shapes-board"],
    "np-ginger-symmetry": ["np-ginger-symmetry-window"],
    "np-ginger-recipe": ["np-ginger-recipe-card"],
    "np-ginger-measure": ["np-ginger-measure-table"],
    "np-ginger-build": [*[f"np-ginger-stone-{i}" for i in range(1, 4)], *[f"np-ginger-slot-{i}" for i in range(1, 4)]],
    "np-mountain-weather": ["np-summit-weather-station"],
    "np-obs-stars": ["np-obs-stars-telescope"],
    "np-obs-constellation": ["np-obs-constellation-board"],
    "np-obs-sequence": ["np-obs-sequence-dial"],
    "np-obs-fragments": [f"np-socket-{zone}" for zone in FRAGMENT_ZONES],
    "np-obs-final": ["np-obs-final-console"],
    "np-eve-sleigh-bell": ["np-sleigh-bell"],
}

# Per option or item key, the entity the puzzle draws it on. The puzzles workstream keys its
# options "a", "b", "c" (sums) and its items "a" .. "d" (order floes); fragments by zone name.
PUZZLE_ENTITY_MAPS = {
    "np-lake-sums": {"a": "np-lake-floe-a", "b": "np-lake-floe-b", "c": "np-lake-floe-c"},
    "np-lake-order": {
        "a": "np-lake-order-floe-a",
        "b": "np-lake-order-floe-b",
        "c": "np-lake-order-floe-c",
        "d": "np-lake-order-floe-d",
    },
    "np-obs-fragments": {zone: f"np-socket-{zone}" for zone in FRAGMENT_ZONES},
}


def _effects(b: _Build) -> dict:
    checkpoints = [
        {"id": "np-cp-landing", "label": "Santa's Landing", "x": 0, "z": 92, "yaw": _r(NORTH)},
        {"id": "np-cp-workshop", "label": "Santa's Workshop", "x": -29, "z": 54, "yaw": _r(WEST), "whenChangeKey": CH["welcome"]},
        {"id": "np-cp-forest", "label": "the Candy Cane Forest", "x": 29, "z": 54, "yaw": _r(EAST), "whenChangeKey": CH["workshop"]},
        {"id": "np-cp-lake", "label": "the Frozen Lake", "x": -29, "z": 12, "yaw": _r(WEST), "whenChangeKey": CH["forest"]},
        {"id": "np-cp-stables", "label": "the Reindeer Stables", "x": 29, "z": 20, "yaw": _r(EAST), "whenChangeKey": CH["lake"]},
        {"id": "np-cp-gingerbread", "label": "Gingerbread Village", "x": -29, "z": -42, "yaw": _r(WEST), "whenChangeKey": CH["snowball"]},
        {"id": "np-cp-mountain", "label": "Snowflake Mountain", "x": -46, "z": -71, "yaw": _r(NORTH), "whenChangeKey": CH["ginger"]},
        {"id": "np-cp-observatory", "label": "the Observatory", "x": 6, "z": -84, "yaw": _r(EAST), "whenChangeKey": CH["summit"]},
        {"id": "np-cp-finale", "label": "Santa's Landing", "x": 0, "z": 86, "yaw": _r(NORTH), "whenChangeKey": CH["star"]},
    ]
    lights = [
        ("np-light-landing", 0, 3.0, 88, 0xFFD27A, 1.6, 16),
        ("np-light-tree", 0, 4.0, 56, 0xFFE9A8, 2.2, 22),
        ("np-light-workshop", -40, 2.5, 66, 0xFFB44D, 1.6, 16),
        ("np-light-forest", 40, 2.5, 66, 0xFF8FA3, 1.6, 16),
        ("np-light-lake", -36, 2.5, 12, 0x9FD8FF, 1.5, 16),
        ("np-light-stables", 40, 2.5, 22, 0xFFC27A, 1.5, 16),
        ("np-light-hollow", 48, 2.5, -36, 0xA8D8FF, 1.2, 14),
        ("np-light-gingerbread", -44, 2.5, -42, 0xFFC98A, 1.6, 16),
        ("np-light-mountain", -34, 6.0, -90, 0xCFE8FF, 1.4, 20),
        ("np-light-observatory", 38, 3.0, -82, 0xB9C8FF, 1.6, 18),
        ("np-light-road", 0, 3.0, -20, 0xFFD27A, 1.4, 18),
    ]
    light_items = [
        {"id": lid, "x": x, "y": y, "z": z, "color": col, "intensity": inten, "distance": dist}
        for lid, x, y, z, col, inten, dist in lights
    ]
    light_items.append(
        {
            "id": "np-light-star", "x": 42, "y": 11.0, "z": -90, "color": 0xFFF1A8, "intensity": 3.0, "distance": 40,
            "shownWhenChangeKey": CH["star"],
        }
    )
    return {
        "checkpoints": checkpoints,
        "openings": [{"colliderId": gate_id, "whenChangeKey": key} for gate_id, (_r_, key) in GATES.items()],
        "returns": [
            {
                "entityId": "np-observatory-sled",
                "toCheckpoint": "np-cp-finale",
                "whenChangeKey": CH["star"],
                "label": "Ride the sled back to Santa's Landing",
            }
        ],
        "standIns": b.stand_ins,
        "lights": light_items,
    }


def _platforming(b: _Build) -> dict:
    zones = [
        {"rect": _rect(zone_id, *rect), "enterMessage": ZONE_MESSAGES[zone_id]} for zone_id, rect in ZONES.items()
    ]
    return {
        "platforms": b.platforms,
        "pressurePlates": [],
        "checkpoints": [
            {"id": "np-course-cp-lake-east", "x": -42, "z": 8, "yaw": _r(WEST), "label": "the east bank"},
            {"id": "np-course-cp-lake-island", "x": -54, "z": 8, "yaw": _r(EAST), "label": "the island"},
        ],
        "hazards": [{"id": "np-hazard-lake-water", "rect": _rect("np-hazard-lake-water", -50, -44.5, -18, 34)}],
        "goals": [],
        "zones": zones,
    }


def scene() -> dict:
    """The complete `WorldRegion.scene` for the North Pole (version `LAYOUT_VERSION`)."""
    b = _B
    scenery = list(b.scenery)
    for asset_id, positions in sorted(b.clusters.items()):
        scenery.append({"kind": "CLUSTER", "id": f"np-cluster-{asset_id.removeprefix('north-pole-')}", "assetId": asset_id, "positions": positions})
    return {
        "bounds": dict(BOUNDS),
        "environment": {
            "backgroundColor": 1979224,
            "lighting": {"ambientColor": 13623551, "ambientIntensity": 0.9, "sunColor": 16773856, "sunIntensity": 0.9},
        },
        "atmosphere": {
            "fog": {"color": 0x2A4470, "near": 50, "far": 190},
            "precipitation": {"kind": "SNOW", "density": 0.6},
            "skyRibbons": [
                {"id": "np-aurora-1", "colors": [6222512, 9075954], "x": 0, "y": 60, "z": -140, "width": 220, "height": 30}
            ],
        },
        "copy": {
            "loading": "Packing up the sleigh for the North Pole.",
            "instructions": (
                "Walk with the arrow keys or the stick. Press Jump or the space bar to hop. "
                "Say hello to Jingle the elf at Santa's Landing."
            ),
            "calmStop": "The elves are resting now, and so can you. The North Pole will be here.",
            "altNavLabel": "Go back to the harbor",
        },
        "colliders": _gates(b),
        "layout": {"scenery": scenery, "colliders": b.colliders, "zones": [], "lights": [], "procedural": []},
        "platforming": _platforming(b),
        "effects": _effects(b),
        "northPoleVersion": LAYOUT_VERSION,
    }


def snapshot() -> dict:
    return {
        "scene": scene(),
        "placements": PLACEMENTS,
        "chests": CHEST_SPOTS,
        "puzzleEntities": PUZZLE_ENTITIES,
        "puzzleEntityMaps": PUZZLE_ENTITY_MAPS,
        "spawn": SPAWN,
    }


def write_snapshot() -> None:
    SNAPSHOT_PATH.write_text(json.dumps(snapshot(), indent=1, sort_keys=True) + "\n")


if __name__ == "__main__":
    write_snapshot()  # silent: application code does not print (test_privacy_logging)
