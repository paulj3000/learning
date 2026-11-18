"""North Pole layout (NP-010 to NP-019, NP-036): contract, platforming limits and walkability.

Plain asserts, no database. The walkability check is a grid flood fill at 0.5 m resolution over
the scene's own colliders, ledges, platforms and hazards, so a required route that needs a jump
fails here, long before a browser run (NP-D5).
"""

import json
import math
from collections import deque

import pytest

from apps.regions import north_pole_layout as L
from apps.regions import platforming

SCENE = L.scene()
LAYOUT = SCENE["layout"]
PLATFORMING = SCENE["platforming"]
EFFECTS = SCENE["effects"]
BOUNDS = L.BOUNDS
PLAYER_RADIUS = 0.35
STEP_UP = 0.25
REACH = 3.0  # how far from a reachable spot a child can talk to or pick up an entity

# The contract (docs/north-pole/NORTH_POLE_DESIGN.md sections 4 and 5), repeated here on purpose.
CONTRACT_ZONES = {
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
CONTRACT_GATES = {
    "np-gate-workshop": "NORTH_POLE_WELCOME_LOOKED",
    "np-gate-forest": "NORTH_POLE_WORKSHOP_RESTORED",
    "np-gate-lake": "NORTH_POLE_FOREST_DONE",
    "np-gate-stables": "NORTH_POLE_LAKE_DONE",
    "np-gate-gingerbread": "NORTH_POLE_SNOWBALL_HOME",
    "np-gate-mountain": "NORTH_POLE_GINGER_REPAIRED",
    "np-gate-observatory": "NORTH_POLE_MOUNTAIN_SUMMIT",
    "np-gate-north-road": "NORTH_POLE_MOUNTAIN_SUMMIT",
    "np-gate-ice-cave": "NORTH_POLE_CHRISTMAS_EVE",
}
CONTRACT_CHECKPOINTS = {
    "np-cp-landing": None,
    "np-cp-workshop": "NORTH_POLE_WELCOME_LOOKED",
    "np-cp-forest": "NORTH_POLE_WORKSHOP_RESTORED",
    "np-cp-lake": "NORTH_POLE_FOREST_DONE",
    "np-cp-stables": "NORTH_POLE_LAKE_DONE",
    "np-cp-gingerbread": "NORTH_POLE_SNOWBALL_HOME",
    "np-cp-mountain": "NORTH_POLE_GINGER_REPAIRED",
    "np-cp-observatory": "NORTH_POLE_MOUNTAIN_SUMMIT",
    "np-cp-finale": "NORTH_POLE_STAR_RESTORED",
}
PUZZLES = (
    "np-welcome-look np-workshop-count np-workshop-sort np-workshop-pattern np-workshop-assemble "
    "np-forest-sequence np-forest-signs np-forest-stripes np-lake-sums np-lake-order np-lake-shapes "
    "np-stables-facts np-stables-tracks np-stables-supplies np-stables-return np-ginger-shapes "
    "np-ginger-symmetry np-ginger-recipe np-ginger-measure np-ginger-build np-mountain-weather "
    "np-obs-stars np-obs-constellation np-obs-sequence np-obs-fragments np-obs-final np-eve-sleigh-bell"
).split()
NPC_ENTITIES = {
    "np-santa": "santa-claus",
    "np-mrs-claus": "mrs-claus",
    "np-jingle": "jingle",
    "np-jingle-mountain": "jingle",
    "np-tinker": "tinker",
    "np-peppermint": "peppermint",
    "np-frosty": "frosty",
    "np-noel": "noel",
    "np-ginger": "ginger",
    "np-polaris": "polaris",
    "np-snowball": "snowball",
}
STAND_IN_SHAPES = {
    "BOX", "TENT", "TELESCOPE", "PIPE", "PEDESTAL", "CRYSTAL", "PORTAL", "STONE", "VALVE", "MARKER",
    "FIGURE", "TREE", "LOG", "GEAR", "SWITCH", "ROCK", "ARCH",
    "PINE", "STAR", "GIFT", "SNOWMAN", "CANE", "LANTERN", "HOUSE", "DOME", "SLEIGH", "ANIMAL", "SIGN",
}  # fmt: skip
BY_ID = {p["entity_id"]: p for p in L.PLACEMENTS}


# --- geometry helpers -------------------------------------------------------------------------


def rect_of(item: dict) -> tuple[float, float, float, float]:
    r = item["rect"] if "rect" in item else item
    return r["minX"], r["maxX"], r["minZ"], r["maxZ"]


def inside(rect, x, z, margin=0.0) -> bool:
    x0, x1, z0, z1 = rect
    return x0 - margin <= x <= x1 + margin and z0 - margin <= z <= z1 + margin


def platform_rect(p: dict):
    s, q = p["size"], p["position"]
    return q["x"] - s["width"] / 2, q["x"] + s["width"] / 2, q["z"] - s["depth"] / 2, q["z"] + s["depth"] / 2


def rect_gap(a, b) -> float:
    dx = max(a[0] - b[1], b[0] - a[1], 0.0)
    dz = max(a[2] - b[3], b[2] - a[3], 0.0)
    return math.hypot(dx, dz)


SOLID = [c for c in LAYOUT["colliders"] if not c.get("jumpable")]
LEDGES = [c for c in LAYOUT["colliders"] if c.get("jumpable")]
GATE_RECTS = {c["id"]: rect_of(c) for c in SCENE["colliders"]}
BRIDGES = [
    p for p in PLATFORMING["platforms"]
    if (p.get("activation") or {}).get("hiddenUntilActive") and (p.get("activation") or {}).get("trigger") == "SIGNAL"
]  # fmt: skip
OTHER_PLATFORMS = [p for p in PLATFORMING["platforms"] if p not in BRIDGES]
HAZARDS = [rect_of(h) for h in PLATFORMING["hazards"]]

RES = 0.5
NX = int(2 * BOUNDS["halfExtentX"] / RES)
NZ = int(2 * BOUNDS["halfExtentZ"] / RES)


def cell(x: float, z: float) -> tuple[int, int]:
    return int((x + BOUNDS["halfExtentX"]) / RES), int((z + BOUNDS["halfExtentZ"]) / RES)


def centre(i: int, j: int) -> tuple[float, float]:
    return -BOUNDS["halfExtentX"] + (i + 0.5) * RES, -BOUNDS["halfExtentZ"] + (j + 0.5) * RES


def cells_in(rect, margin=0.0):
    x0, x1, z0, z1 = rect
    i0, j0 = cell(max(x0 - margin, -BOUNDS["halfExtentX"]), max(z0 - margin, -BOUNDS["halfExtentZ"]))
    i1, j1 = cell(min(x1 + margin, BOUNDS["halfExtentX"] - 1e-6), min(z1 + margin, BOUNDS["halfExtentZ"] - 1e-6))
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            cx, cz = centre(i, j)
            if x0 - margin <= cx <= x1 + margin and z0 - margin <= cz <= z1 + margin:
                yield i, j


class Grid:
    """Blocked cells and ground heights, with the gates open or closed."""

    def __init__(self, gates_open: bool):
        self.blocked = [[False] * NZ for _ in range(NX)]
        self.height = [[0.0] * NZ for _ in range(NX)]
        for c in SOLID:
            for i, j in cells_in(rect_of(c), PLAYER_RADIUS):
                self.blocked[i][j] = True
        if not gates_open:
            for rect in GATE_RECTS.values():
                for i, j in cells_in(rect, PLAYER_RADIUS):
                    self.blocked[i][j] = True
        for c in LEDGES:
            for i, j in cells_in(rect_of(c)):
                self.height[i][j] = max(self.height[i][j], c["maxY"])
        for p in OTHER_PLATFORMS:
            for i, j in cells_in(platform_rect(p), PLAYER_RADIUS):
                self.blocked[i][j] = True
        for rect in HAZARDS:
            for i, j in cells_in(rect):
                self.blocked[i][j] = True
        for p in BRIDGES:  # a raised bridge is ground at its top
            top = p["position"]["y"] + p["size"]["height"]
            for i, j in cells_in(platform_rect(p)):
                self.blocked[i][j] = False
                self.height[i][j] = max(self.height[i][j], top)

    def flood(self, start: tuple[float, float]) -> set[tuple[int, int]]:
        si, sj = cell(*start)
        seen = {(si, sj)}
        queue = deque([(si, sj)])
        while queue:
            i, j = queue.popleft()
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ni, nj = i + di, j + dj
                if not (0 <= ni < NX and 0 <= nj < NZ) or (ni, nj) in seen or self.blocked[ni][nj]:
                    continue
                if self.height[ni][nj] - self.height[i][j] > STEP_UP + 1e-9:
                    continue
                seen.add((ni, nj))
                queue.append((ni, nj))
        return seen

    def reaches(self, reachable, x: float, z: float, elevation: float = 0.0, half: float = 0.0) -> bool:
        """A reachable spot within `REACH` of the entity's edge (`half` is half its footprint)."""
        reach = REACH + half
        for i, j in cells_in((x - reach, x + reach, z - reach, z + reach)):
            cx, cz = centre(i, j)
            if (i, j) in reachable and math.hypot(cx - x, cz - z) <= reach and abs(self.height[i][j] - elevation) <= 0.61:
                return True
        return False


@pytest.fixture(scope="module")
def open_grid():
    grid = Grid(gates_open=True)
    return grid, grid.flood((L.SPAWN["x"], L.SPAWN["z"]))


@pytest.fixture(scope="module")
def closed_grid():
    grid = Grid(gates_open=False)
    return grid, grid.flood((L.SPAWN["x"], L.SPAWN["z"]))


# --- contract ---------------------------------------------------------------------------------


def test_platforming_layout_is_valid_and_within_limits():
    assert platforming.layout_problems(PLATFORMING, bounds=BOUNDS) == []
    assert len(PLATFORMING["platforms"]) <= 64
    for p in PLATFORMING["platforms"]:
        assert p["size"]["width"] >= 1.2 and p["size"]["depth"] >= 1.2, p["id"]


def test_the_scene_has_the_contract_shell():
    assert L.REGION_ID == "north-pole-village"
    assert BOUNDS == {"halfExtentX": 66, "halfExtentZ": 100, "wallThickness": 1}
    assert SCENE["bounds"] == BOUNDS
    assert SCENE["northPoleVersion"] == L.LAYOUT_VERSION == 1
    assert SCENE["environment"] == {
        "backgroundColor": 1979224,
        "lighting": {"ambientColor": 13623551, "ambientIntensity": 0.9, "sunColor": 16773856, "sunIntensity": 0.9},
    }
    assert SCENE["atmosphere"] == {
        "fog": {"color": 14543093, "near": 40, "far": 170},
        "precipitation": {"kind": "SNOW", "density": 0.6},
        "skyRibbons": [
            {"id": "np-aurora-1", "colors": [6222512, 9075954], "x": 0, "y": 60, "z": -140, "width": 220, "height": 30}
        ],
    }
    assert set(SCENE["copy"]) == {"loading", "instructions", "calmStop", "altNavLabel"}
    assert L.SPAWN == {"checkpoint_id": "np-cp-landing", "x": 0, "z": 92, "yaw": math.pi, "label": "Santa's Landing"}


def test_no_em_dashes_in_child_facing_copy():
    text = json.dumps(L.snapshot(), ensure_ascii=False)
    assert "—" not in text and "–" not in text


def test_zones_are_the_ten_contract_zones():
    zones = {z["rect"]["id"]: rect_of(z) for z in PLATFORMING["zones"]}
    assert set(zones) == set(CONTRACT_ZONES)
    for zone_id, (x0, x1, z0, z1) in CONTRACT_ZONES.items():
        a, b, c, d = zones[zone_id]
        assert x0 <= a < b <= x1 and z0 <= c < d <= z1, zone_id
    for zone in PLATFORMING["zones"]:
        assert zone["enterMessage"].strip()
        assert len(zone["enterMessage"]) < 200


def test_every_gate_is_a_collider_with_its_opening():
    assert set(GATE_RECTS) == set(CONTRACT_GATES)
    openings = {o["colliderId"]: o["whenChangeKey"] for o in EFFECTS["openings"]}
    assert openings == CONTRACT_GATES
    for gate_id, rect in GATE_RECTS.items():
        assert inside((-66, 66, -100, 100), rect[0], rect[2]) and inside((-66, 66, -100, 100), rect[1], rect[3]), gate_id


def test_effects_checkpoints_match_the_contract():
    got = {c["id"]: c.get("whenChangeKey") for c in EFFECTS["checkpoints"]}
    assert got == CONTRACT_CHECKPOINTS
    assert EFFECTS["returns"] == [
        {
            "entityId": "np-observatory-sled",
            "toCheckpoint": "np-cp-finale",
            "whenChangeKey": "NORTH_POLE_STAR_RESTORED",
            "label": "Ride the sled back to Santa's Landing",
        }
    ]
    assert "np-observatory-sled" in BY_ID


def test_spawn_and_every_checkpoint_stand_on_free_ground():
    points = [(L.SPAWN["x"], L.SPAWN["z"], "spawn")]
    points += [(c["x"], c["z"], c["id"]) for c in EFFECTS["checkpoints"]]
    points += [(c["x"], c["z"], c["id"]) for c in PLATFORMING["checkpoints"]]
    for x, z, name in points:
        assert abs(x) < BOUNDS["halfExtentX"] and abs(z) < BOUNDS["halfExtentZ"], name
        for c in LAYOUT["colliders"]:
            assert not inside(rect_of(c), x, z, PLAYER_RADIUS), (name, c["rect"]["id"])
        for p in PLATFORMING["platforms"]:
            assert not inside(platform_rect(p), x, z, PLAYER_RADIUS), (name, p["id"])
        for rect in GATE_RECTS.values():
            assert not inside(rect, x, z, PLAYER_RADIUS), name
        for rect in HAZARDS:
            assert not inside(rect, x, z), name


def test_every_checkpoint_sits_in_the_zone_of_its_gate():
    zone_of = {
        "np-cp-landing": "santas-landing", "np-cp-workshop": "santas-workshop", "np-cp-forest": "candy-cane-forest",
        "np-cp-lake": "frozen-lake", "np-cp-stables": "reindeer-stables", "np-cp-gingerbread": "gingerbread-village",
        "np-cp-mountain": "snowflake-mountain", "np-cp-observatory": "north-pole-observatory", "np-cp-finale": "santas-landing",
    }  # fmt: skip
    for c in EFFECTS["checkpoints"]:
        assert inside(CONTRACT_ZONES[zone_of[c["id"]]], c["x"], c["z"]), c["id"]


def test_asset_ids_are_north_pole_ids_and_listed():
    used = set(L.ASSET_IDS_USED)
    assert all(a.startswith("north-pole-") for a in used)
    seen = {p["asset_id"] for p in L.PLACEMENTS if p["asset_id"]}
    seen |= {p["assetId"] for p in PLATFORMING["platforms"] if "assetId" in p}
    seen |= {s["assetId"] for s in LAYOUT["scenery"] if "assetId" in s}
    assert seen <= used, seen - used


# --- entities ---------------------------------------------------------------------------------


def test_placements_are_unique_inside_bounds_and_clear_of_solids():
    ids = [p["entity_id"] for p in L.PLACEMENTS]
    assert len(ids) == len(set(ids))
    for p in L.PLACEMENTS:
        assert p["kind"] in {"NPC", "PROP", "SCENERY", "COLLECTIBLE"}
        assert abs(p["x"]) < BOUNDS["halfExtentX"] and abs(p["z"]) < BOUNDS["halfExtentZ"], p["entity_id"]
        own = f"np-col-{p['entity_id']}"
        for c in SOLID:
            if c["rect"]["id"] == own or p["entity_id"].startswith("np-drift-"):
                continue
            assert not inside(rect_of(c), p["x"], p["z"], 0.2), (p["entity_id"], c["rect"]["id"])
        if p["elevation"] == 0 and p["kind"] != "SCENERY":
            for plat in PLATFORMING["platforms"]:
                assert not inside(platform_rect(plat), p["x"], p["z"]), (p["entity_id"], plat["id"])
            for rect in HAZARDS:
                assert not inside(rect, p["x"], p["z"]), p["entity_id"]


def test_every_npc_pickup_and_chest_of_the_contract_exists():
    for entity_id, npc in NPC_ENTITIES.items():
        assert BY_ID[entity_id]["kind"] == "NPC" and BY_ID[entity_id]["npc_id"] == npc
    pickups = {p["entity_id"]: p["pickup_change_key"] for p in L.PLACEMENTS if p["kind"] == "COLLECTIBLE"}
    expected = {f"np-fragment-{z}": f"NORTH_POLE_FRAGMENT_{z.upper()}" for z in L.FRAGMENT_ZONES}
    expected |= {f"np-snowflake-{i:02d}": f"NORTH_POLE_SNOWFLAKE_{i:02d}" for i in range(1, 11)}
    expected |= {f"np-candy-cane-{i}": f"NORTH_POLE_CANDY_CANE_{i}" for i in range(1, 6)}
    expected |= {f"np-ornament-{i}": f"NORTH_POLE_ORNAMENT_{i}" for i in range(1, 6)}
    expected |= {f"np-cookie-{i}": f"NORTH_POLE_COOKIE_{i}" for i in range(1, 4)}
    expected |= {f"np-golden-bell-{i}": f"NORTH_POLE_GOLDEN_BELL_{i}" for i in range(1, 4)}
    expected["np-snowball-collar"] = "NORTH_POLE_SNOWBALL_FOUND"
    assert pickups == expected
    assert set(L.CHEST_SPOTS) == {
        "np-workshop-gift-chest", "np-mountain-lever-1", "np-mountain-lever-2",
        "np-replay-workshop-sums", "np-replay-lake-count",
    }  # fmt: skip
    for spot in L.CHEST_SPOTS.values():
        assert {"x", "z", "elevation", "rotation_y", "label"} <= set(spot)


def test_every_puzzle_binds_entities_that_exist():
    assert set(L.PUZZLE_ENTITIES) == set(PUZZLES) and len(PUZZLES) == 27
    for puzzle, entities in L.PUZZLE_ENTITIES.items():
        assert entities, puzzle
        for entity_id in entities:
            assert entity_id in BY_ID, (puzzle, entity_id)
    for puzzle, mapping in L.PUZZLE_ENTITY_MAPS.items():
        assert set(mapping.values()) <= set(L.PUZZLE_ENTITIES[puzzle])
    assert set(L.PUZZLE_ENTITY_MAPS["np-obs-fragments"]) == set(L.FRAGMENT_ZONES)
    assert set(L.PUZZLE_ENTITY_MAPS["np-lake-sums"]) == {"a", "b", "c"}


def test_stand_ins_cover_drawn_entities_and_use_known_shapes():
    stand = {s["entityId"]: s for s in EFFECTS["standIns"]}
    assert len(stand) == len(EFFECTS["standIns"])
    for s in stand.values():
        assert s["shape"] in STAND_IN_SHAPES and isinstance(s["color"], int)
        assert s["entityId"] in BY_ID, s["entityId"]
    for p in L.PLACEMENTS:
        if p["kind"] != "NPC":
            assert p["entity_id"] in stand, p["entity_id"]
    star = stand["np-christmas-star"]
    assert star["shownWhenChangeKey"] == "NORTH_POLE_STAR_RESTORED"
    for gate_id, key in CONTRACT_GATES.items():
        assert stand[gate_id.replace("np-gate-", "np-drift-")]["hiddenWhenChangeKey"] == key


def test_point_lights_stay_within_the_medium_render_budget():
    lights = EFFECTS["lights"]
    assert 8 <= len(lights) <= 14
    assert any(light.get("shownWhenChangeKey") == "NORTH_POLE_STAR_RESTORED" for light in lights)
    assert len({light["id"] for light in lights}) == len(lights)


# --- platforms, hazards, jump routes ------------------------------------------------------------


def test_the_course_has_every_platform_type_and_the_contract_signals():
    by_id = {p["id"]: p for p in PLATFORMING["platforms"]}
    assert any("motion" in p for p in by_id.values())
    assert any("vanish" in p for p in by_id.values())
    assert any("bounce" in p for p in by_id.values())
    for pid, key in (
        ("np-lake-bridge", "NORTH_POLE_LAKE_BRIDGE"),
        ("np-mt-bridge-1", "NORTH_POLE_MOUNTAIN_BRIDGE_ONE"),
        ("np-mt-bridge-2", "NORTH_POLE_MOUNTAIN_BRIDGE_TWO"),
    ):
        assert by_id[pid]["activation"] == {"trigger": "SIGNAL", "source": f"world:{key}", "hiddenUntilActive": True}
    sleigh = by_id["np-sleigh"]
    assert sleigh["assetId"] == "north-pole-sleigh"
    assert sleigh["motion"]["mode"] == "ONCE"
    assert sleigh["activation"] == {"trigger": "SIGNAL", "source": "world:NORTH_POLE_CHRISTMAS_EVE"}
    assert by_id["np-plat-lake-thin-ice"]["vanish"]["mode"] == "STAND"


def test_every_hazard_has_a_course_checkpoint_close_by():
    assert HAZARDS
    for hazard in HAZARDS:
        near = [c for c in PLATFORMING["checkpoints"] if rect_gap(hazard, (c["x"], c["x"], c["z"], c["z"])) <= 20]
        assert len(near) >= 2  # both banks
        xs = sorted(c["x"] for c in near)
        assert xs[0] < hazard[0] and xs[-1] > hazard[1]


def _top_and_rect(item_id: str):
    if item_id == "ground":
        return 0.0, None
    for c in LEDGES:
        if c["rect"]["id"] == f"{item_id}:collider":
            return c["maxY"], rect_of(c)
    for p in PLATFORMING["platforms"]:
        if p["id"] == item_id:
            return p["position"]["y"] + p["size"]["height"], platform_rect(p)
    raise AssertionError(item_id)


def test_jump_routes_have_forgiving_gaps_and_rises():
    for name, chain in L.JUMP_ROUTES.items():
        top, rect = 0.0, None
        for item_id in chain:
            next_top, next_rect = _top_and_rect(item_id)
            assert next_top - top <= 0.6 + 1e-9, (name, item_id, next_top - top)
            if rect is not None:
                assert rect_gap(rect, next_rect) <= 1.6 + 1e-9, (name, item_id, rect_gap(rect, next_rect))
            top, rect = next_top, next_rect


def test_the_trampoline_reaches_its_ledge():
    bounce = next(p for p in PLATFORMING["platforms"] if p["id"] == "np-plat-trampoline")["bounce"]["height"]
    ledge_top, _ = _top_and_rect("np-ledge-snow-roof")
    assert bounce >= ledge_top + 0.5


def test_the_mountain_has_no_hazard_and_every_fall_is_one_terrace(open_grid):
    grid, reachable = open_grid
    mountain = CONTRACT_ZONES["snowflake-mountain"]
    for rect in HAZARDS:
        assert rect_gap(rect, mountain) > 0
    worst = 0.0
    for i, j in reachable:
        x, z = centre(i, j)
        if not inside(mountain, x, z):
            continue
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + di, j + dj)
            if n in reachable:
                worst = max(worst, grid.height[i][j] - grid.height[n[0]][n[1]])
    assert worst <= 0.8 + 1e-9, worst
    assert max(c["maxY"] for c in LEDGES if c["rect"]["id"].startswith("np-mt-t")) == pytest.approx(3.2)


# --- walkability (NP-D5) ------------------------------------------------------------------------


def test_spawn_region_is_connected_and_gates_really_seal_the_zones(closed_grid):
    grid, reachable = closed_grid
    sealed = {
        "np-cp-workshop", "np-cp-forest", "np-cp-lake", "np-cp-stables", "np-cp-gingerbread",
        "np-cp-mountain", "np-cp-observatory",
    }  # fmt: skip
    for c in EFFECTS["checkpoints"]:
        assert (cell(c["x"], c["z"]) in reachable) == (c["id"] not in sealed), c["id"]
    # The ice cave is closed until Christmas Eve, so its golden bells are unreachable.
    for i in range(1, 4):
        p = BY_ID[f"np-golden-bell-{i}"]
        assert not grid.reaches(reachable, p["x"], p["z"], p["elevation"])


def test_each_gate_alone_opens_exactly_its_own_zone():
    """Opening one gate must not leak into a zone that has its own gate."""
    zone_cp = {
        "np-gate-workshop": "np-cp-workshop", "np-gate-forest": "np-cp-forest", "np-gate-lake": "np-cp-lake",
        "np-gate-stables": "np-cp-stables", "np-gate-gingerbread": "np-cp-gingerbread",
    }  # fmt: skip
    cps = {c["id"]: c for c in EFFECTS["checkpoints"]}
    for gate_id, cp_id in zone_cp.items():
        grid = Grid(gates_open=False)
        for i, j in cells_in(GATE_RECTS[gate_id], PLAYER_RADIUS):
            grid.blocked[i][j] = any(
                inside(rect_of(c), *centre(i, j), PLAYER_RADIUS) for c in SOLID
            )
        reachable = grid.flood((L.SPAWN["x"], L.SPAWN["z"]))
        assert cell(cps[cp_id]["x"], cps[cp_id]["z"]) in reachable, gate_id
        others = [c for c in zone_cp.values() if c != cp_id]
        for other in others:
            assert cell(cps[other]["x"], cps[other]["z"]) not in reachable, (gate_id, other)


def test_every_required_thing_is_reachable_on_foot_with_the_gates_open(open_grid):
    grid, reachable = open_grid
    assert cell(L.SPAWN["x"], L.SPAWN["z"]) in reachable
    for c in EFFECTS["checkpoints"]:
        assert cell(c["x"], c["z"]) in reachable, c["id"]
    needed: dict[str, tuple[float, float, float, float]] = {}
    for p in L.PLACEMENTS:  # every placed entity: NPCs, pickups, stations, decor
        half = max(p["placeholder_width"], p["placeholder_depth"]) / 2
        needed[p["entity_id"]] = (p["x"], p["z"], p["elevation"], half)
    for chest_id, spot in L.CHEST_SPOTS.items():
        needed[chest_id] = (spot["x"], spot["z"], spot["elevation"], 0.5)
    missing = [
        name for name, (x, z, elevation, half) in needed.items()
        if name not in L.JUMP_ONLY_OPTIONAL
        and not name.startswith("np-drift-")
        and name != "np-christmas-star"  # it hangs in the sky once the Star is restored
        and not grid.reaches(reachable, x, z, elevation, half)
    ]  # fmt: skip
    assert missing == [], missing


def test_only_optional_snowflakes_need_a_jump(open_grid):
    grid, reachable = open_grid
    assert all(entity.startswith("np-snowflake-") for entity in L.JUMP_ONLY_OPTIONAL)
    assert len(L.JUMP_ONLY_OPTIONAL) <= 7
    for name in L.JUMP_ONLY_OPTIONAL:
        p = BY_ID[name]
        assert p["kind"] == "COLLECTIBLE"
        # They are still close enough to a jump route or a bounce to be fair (not on a far island).
        assert abs(p["x"]) < 66 and abs(p["z"]) < 100
    # The three required snowflakes on the mountain are walkable.
    for name in ("np-snowflake-08", "np-snowflake-09", "np-snowflake-10"):
        p = BY_ID[name]
        assert grid.reaches(reachable, p["x"], p["z"], p["elevation"]), name


def test_the_mountain_summit_needs_the_signal_bridges(open_grid):
    """Without the hidden bridges the summit is not walkable: the levers are what raise them."""
    grid = Grid(gates_open=True)
    for plat in BRIDGES:
        if plat["id"].startswith("np-mt-bridge"):
            for i, j in cells_in(platform_rect(plat)):
                grid.height[i][j] = 0.0
    reachable = grid.flood((L.SPAWN["x"], L.SPAWN["z"]))
    summit = BY_ID["np-fragment-mountain"]
    assert not grid.reaches(reachable, summit["x"], summit["z"], summit["elevation"])
    lever1 = L.CHEST_SPOTS["np-mountain-lever-1"]
    assert grid.reaches(reachable, lever1["x"], lever1["z"], lever1["elevation"])


def test_the_island_needs_the_lake_bridge():
    grid = Grid(gates_open=True)
    for plat in BRIDGES:
        if plat["id"] == "np-lake-bridge":
            for i, j in cells_in(platform_rect(plat)):
                grid.blocked[i][j] = True
    reachable = grid.flood((L.SPAWN["x"], L.SPAWN["z"]))
    island = BY_ID["np-fragment-lake"]
    assert not grid.reaches(reachable, island["x"], island["z"], 0.0)


# --- snapshot ------------------------------------------------------------------------------------


def test_the_json_snapshot_equals_the_builders():
    assert json.loads(L.SNAPSHOT_PATH.read_text()) == json.loads(json.dumps(L.snapshot()))
    assert L.SNAPSHOT_PATH.read_text() == json.dumps(L.snapshot(), indent=1, sort_keys=True) + "\n"
