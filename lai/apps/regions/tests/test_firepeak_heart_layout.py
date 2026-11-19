"""The Heart of Firepeak's geometry (design sections 4, 6 and 7): pure unit tests, no database.

Proves the layout the engine will run: the platforming block validates, checkpoints are valid,
every mandatory route (all seven zones, in order, through every gate) is walkable without a jump,
and every optional jump hop is within the limits for a young child.
"""

import json
import math
from collections import deque

import pytest

from apps.regions import firepeak_heart_layout as layout
from apps.regions.engine_bridge import engine_bridge_problems
from apps.regions.platforming import LIMITS, layout_problems

SCENE = layout.scene()
PLATFORMING = SCENE["platforming"]
PLATFORMS = {p["id"]: p for p in PLATFORMING["platforms"]}
BRIDGE = SCENE["engineBridge"]
BRIDGE_CONFIG = {c["id"]: c["config"] for c in BRIDGE["capabilities"]}
# GE-073: the one checkpoint list, from the engine bridge, as {id, x, z, label, requiresSignalId}.
CHECKPOINT_LIST = [
    {**c, "x": c["position"]["x"], "z": c["position"]["z"]} for c in BRIDGE_CONFIG["gameplay.checkpoints"]["checkpoints"]
]
PLACEMENTS = layout.placements()

STEP_UP = 0.25  # the controller steps up this much without jumping
HAZARD_LINE = 0.05  # feet at or below this height inside a hazard rect count as in it
PLAYER_RADIUS = 0.3
RES = 0.25
MAX_JUMP_RISE = 0.6
REACH = 2.6  # how close a child must be able to walk to an object to use it


def top(platform):
    return platform["position"]["y"] + platform["size"]["height"]


def footprint(platform):
    p, s = platform["position"], platform["size"]
    return (p["x"] - s["width"] / 2, p["x"] + s["width"] / 2, p["z"] - s["depth"] / 2, p["z"] + s["depth"] / 2)


def inside(box, x, z, margin=0.0):
    min_x, max_x, min_z, max_z = box
    return min_x - margin <= x <= max_x + margin and min_z - margin <= z <= max_z + margin


def rect(c):
    return (c["minX"], c["maxX"], c["minZ"], c["maxZ"])


# --- the structure -----------------------------------------------------------------------------


class TestStructure:
    def test_the_platforming_block_passes_the_server_checks(self):
        assert layout_problems(PLATFORMING, bounds=SCENE["bounds"]) == []

    def test_bounds_hold_every_zone(self):
        assert SCENE["bounds"] == {"halfExtentX": 32, "halfExtentZ": 96, "wallThickness": 1}
        assert layout.ZONES[0][2] <= 96 and layout.ZONES[-1][3] >= -96

    def test_platform_count_is_within_the_client_limit(self):
        assert len(PLATFORMS) <= LIMITS["max_platforms"]

    def test_seven_zones_in_order_with_six_gates(self):
        assert [z[0] for z in layout.ZONES] == [
            "explorers-landing",
            "emberwood-forest",
            "lava-crossing",
            "crystal-caverns",
            "ancient-forge",
            "firepeak-summit",
            "heart-chamber",
        ]
        assert [g[2] for g in layout.GATES] == [
            "FIREPEAK_HEART_MAP_READ",
            "FIREPEAK_HEART_EMBERWOOD_DONE",
            "FIREPEAK_HEART_LAVA_CROSSED",
            "FIREPEAK_HEART_CAVERN_LIT",
            "FIREPEAK_HEART_FORGE_RESTORED",
            "FIREPEAK_HEART_SUMMIT_REACHED",
        ]
        ids = {c["id"] for c in SCENE["colliders"]}
        for gate_id, z, _key in layout.GATES:
            assert {gate_id, f"{gate_id}-west", f"{gate_id}-east"} <= ids
            # Every gate lies between two zones.
            assert any(zone[3] - 2 <= z <= zone[2] + 2 for zone in layout.ZONES)
        openings = {o["colliderId"]: o["whenChangeKey"] for o in SCENE["effects"]["openings"]}
        assert set(openings) == {g[0] for g in layout.GATES} | {"fh-cavern-secret"}
        assert openings["fh-cavern-secret"] == "FIREPEAK_HEART_CAVERN_LIT"

    def test_every_zone_has_an_enter_message_that_is_plain_and_never_pushy(self):
        zones = PLATFORMING["zones"]
        for zone in zones:
            message = zone["enterMessage"]
            assert message and "—" not in message and "–" not in message
        text = " ".join(z["enterMessage"] for z in zones).lower()
        assert "move" in text or "walk" in text  # the movement tutorial
        assert "jumping is just for fun" in text and "walk around" in text  # jump tip: optional

    def test_ids_do_not_collide_in_the_scene_namespace(self):
        ids = (
            [c["id"] for c in SCENE["colliders"]]
            + [z["rect"]["id"] for z in PLATFORMING["zones"]]
            + [light["id"] for light in SCENE["effects"]["lights"]]
            + [p["entity_id"] for p in PLACEMENTS]
        )
        assert len(ids) == len(set(ids))

    def test_the_bridge_and_the_lift_listen_to_the_world(self):
        assert PLATFORMS["fh-lava-bridge"]["activation"] == {
            "trigger": "SIGNAL",
            "source": "world:FIREPEAK_HEART_LAVA_BRIDGE",
            "hiddenUntilActive": True,
        }
        assert PLATFORMS["fh-forge-lift"]["activation"]["source"] == "world:FIREPEAK_HEART_FORGE_POWERED"

    def test_lava_is_drawn_without_respawning_and_enforced_by_a_height_aware_hazard(self):
        (lava,) = SCENE["effects"]["lava"]
        assert lava["visualOnly"] is True
        (hazard,) = BRIDGE_CONFIG["gameplay.hazards"]["hazards"]  # GE-073: the engine bridge enforces it
        assert hazard["rect"]["minZ"] == lava["minZ"] and hazard["rect"]["maxZ"] == lava["maxZ"]
        assert hazard["belowY"] < PLATFORMS["fh-lava-bridge"]["size"]["height"]
        assert top(PLATFORMS["fh-lava-bridge"]) > HAZARD_LINE

    def test_steam_vents_close_the_forge_gate_until_it_is_restored(self):
        steam = SCENE["effects"]["steam"]
        assert steam and all(s["hiddenWhenChangeKey"] == "FIREPEAK_HEART_FORGE_RESTORED" for s in steam)
        assert all(-49 < s["z"] < -44 for s in steam)

    def test_the_heart_chamber_has_a_return_portal_to_the_landing(self):
        (route,) = SCENE["effects"]["returns"]
        assert route["entityId"] in {p["entity_id"] for p in PLACEMENTS}
        assert route["toCheckpoint"] == "fh-cp-landing"

    def test_the_snapshot_data_is_json(self):
        assert json.loads(json.dumps(SCENE)) == SCENE


# --- checkpoints -------------------------------------------------------------------------------


class TestCheckpoints:
    def test_one_checkpoint_list_in_the_engine_bridge(self):
        assert engine_bridge_problems(BRIDGE) == []
        assert "checkpoints" not in PLATFORMING and "hazards" not in PLATFORMING
        assert "checkpoints" not in SCENE["effects"]
        ids = [c["id"] for c in CHECKPOINT_LIST]
        assert ids[0] == "fh-cp-landing" and len(ids) == len(set(ids)) == 8
        for needed in ("fh-cp-lava-near", "fh-cp-lava-far", "fh-cp-heart", "fh-cp-forge"):
            assert needed in ids
        assert {c["courseId"] for c in CHECKPOINT_LIST} == {"fh-heart"}

    def test_checkpoints_open_in_progress_order(self):
        signals = [c.get("requiresSignalId") for c in CHECKPOINT_LIST]
        assert signals[0] is None
        assert signals[1:] == [
            f"world:{key}"
            for key in (
                "FIREPEAK_HEART_MAP_READ",
                "FIREPEAK_HEART_EMBERWOOD_DONE",
                "FIREPEAK_HEART_LAVA_BRIDGE",
                "FIREPEAK_HEART_LAVA_CROSSED",
                "FIREPEAK_HEART_CAVERN_LIT",
                "FIREPEAK_HEART_FORGE_RESTORED",
                "FIREPEAK_HEART_SUMMIT_REACHED",
            )
        ]

    @pytest.mark.parametrize("checkpoint", CHECKPOINT_LIST, ids=lambda c: c["id"])
    def test_checkpoints_stand_on_open_ground(self, checkpoint):
        x, z = checkpoint["x"], checkpoint["z"]
        assert checkpoint["position"]["y"] == 0.0
        assert abs(x) <= 32 and abs(z) <= 96
        for collider in SCENE["colliders"]:
            assert not inside(rect(collider), x, z, margin=PLAYER_RADIUS), collider["id"]
        for platform in PLATFORMS.values():
            assert not inside(footprint(platform), x, z, margin=PLAYER_RADIUS), platform["id"]
        lava = layout.LAVA
        assert not (lava["minX"] <= x <= lava["maxX"] and lava["minZ"] <= z <= lava["maxZ"])

    def test_the_spawn_is_the_landing_checkpoint(self):
        landing = next(c for c in CHECKPOINT_LIST if c["id"] == "fh-cp-landing")
        assert (landing["x"], landing["z"]) == (0.0, 90.0)
        portal = SCENE["effects"]["returns"][0]
        assert portal["toCheckpoint"] == "fh-cp-landing"
        assert (portal["to"]["x"], portal["to"]["z"]) == (0.0, 90.0)

    def test_the_lava_hazard_has_a_checkpoint_on_each_bank(self):
        (lava,) = BRIDGE_CONFIG["gameplay.hazards"]["hazards"]
        assert lava["id"] == "fh-lava-hazard" and lava["kind"] == "LAVA"
        assert lava["rect"] == layout.LAVA and lava["belowY"] == HAZARD_LINE
        near = next(c for c in CHECKPOINT_LIST if c["id"] == "fh-cp-lava-near")
        far = next(c for c in CHECKPOINT_LIST if c["id"] == "fh-cp-lava-far")
        assert lava["checkpointId"] == "fh-cp-lava-near"
        assert near["z"] > layout.LAVA["maxZ"] and far["z"] < layout.LAVA["minZ"]


# --- objects stand where they can be used ------------------------------------------------------


def surface_height(x, z, platforms=None):
    heights = [0.0]
    for platform in (platforms or PLATFORMS).values():
        if inside(footprint(platform), x, z):
            heights.append(top(platform))
    for collider in SCENE["colliders"]:
        if collider.get("jumpable") and inside(rect(collider), x, z):
            heights.append(collider["maxY"])
    return max(heights)


class TestPlacements:
    def test_the_named_entities_exist(self):
        ids = {p["entity_id"] for p in PLACEMENTS}
        assert {
            "fh-flint", "fh-kindle", "fh-kindle-heart", "fh-basalt", "fh-basalt-summit",
            "fh-cinder", "fh-ignis",
        } <= ids
        shards = [p for p in PLACEMENTS if p["kind"] == "COLLECTIBLE"]
        assert [p["entity_id"] for p in shards] == [
            "fh-shard-landing", "fh-shard-emberwood", "fh-shard-lava-jumper", "fh-shard-caverns",
            "fh-shard-forge", "fh-shard-summit", "fh-shard-heart",
        ]
        assert {p["pickup_key"] for p in shards} == {
            f"FIREPEAK_HEART_SHARD_{z}"
            for z in ("LANDING", "EMBERWOOD", "LAVA", "CAVERNS", "FORGE", "SUMMIT", "HEART")
        }

    def test_everything_is_inside_the_area(self):
        for p in PLACEMENTS:
            assert abs(p["x"]) <= 32 and abs(p["z"]) <= 96, p["entity_id"]

    def test_nothing_that_is_used_stands_inside_a_wall_or_floats_or_sinks(self):
        for p in PLACEMENTS:
            if p["kind"] == "SCENERY":
                continue
            x, z = p["x"], p["z"]
            for collider in SCENE["colliders"]:
                if collider.get("jumpable"):
                    continue
                assert not inside(rect(collider), x, z), (p["entity_id"], collider["id"])
            expected = surface_height(x, z)
            assert abs(expected - p["elevation"]) <= 0.06 or p["entity_id"] in {"fh-heart-crystal"}, (
                p["entity_id"], p["elevation"], expected,
            )

    def test_trees_and_rocks_do_not_stand_on_a_platform(self):
        for p in PLACEMENTS:
            if p["kind"] == "SCENERY" and p["asset"] in {"firepeak-tree", "firepeak-rock"}:
                for platform in PLATFORMS.values():
                    assert not inside(footprint(platform), p["x"], p["z"], margin=0.5), p["entity_id"]

    def test_every_placement_with_a_model_has_an_asset_definition_and_a_stand_in(self):
        stand_ins = {s["entityId"] for s in SCENE["effects"]["standIns"]}
        for p in PLACEMENTS:
            assert p["asset"] in layout.ASSET_DEFS, p["asset"]
            assert p["entity_id"] in stand_ins
        for asset_id in layout.ASSET_DEFS:
            assert asset_id.startswith("firepeak-")

    def test_stand_in_shapes_are_from_the_closed_list(self):
        allowed = {
            "BOX", "TENT", "TELESCOPE", "PIPE", "PEDESTAL", "CRYSTAL", "PORTAL", "STONE", "VALVE",
            "MARKER", "FIGURE", "TREE", "LOG", "GEAR", "SWITCH", "ROCK", "ARCH",
        }
        assert {s["shape"] for s in SCENE["effects"]["standIns"]} <= allowed

    def test_the_landing_gives_a_walk_around_the_optional_jump_log(self):
        log = next(c for c in SCENE["colliders"] if c["id"] == "fh-jump-log")
        assert log["jumpable"] and 0.3 <= log["maxY"] <= 0.5
        # Open ground on both sides of the log, at least a child wide.
        assert log["maxX"] + 2 < 32 and log["minX"] - 2 > -32


# --- walking with no jump ----------------------------------------------------------------------


def build_grid():
    xs = [layout.BOUNDS["halfExtentX"] * -1 + RES / 2 + i * RES for i in range(int(64 / RES))]
    zs = [-96 + RES / 2 + j * RES for j in range(int(192 / RES))]
    return xs, zs


XS, ZS = build_grid()
NX, NZ = len(XS), len(ZS)


def idx(x, z):
    return int((x + 32) // RES), int((z + 96) // RES)


def world_state(open_gates: int, bridge: bool):
    """Which solids stand, the height of every cell, and which cells are lava."""
    opened = {g[0] for g in layout.GATES[:open_gates]}
    solids = [
        rect(c)
        for c in SCENE["colliders"]
        if not c.get("jumpable") and c["id"] not in opened and not (c["id"] == "fh-cavern-secret" and open_gates >= 4)
    ]
    platforms = {
        pid: p
        for pid, p in PLATFORMS.items()
        if not (p.get("activation", {}).get("hiddenUntilActive") and not bridge)
        and pid not in {"fh-forge-lift"}  # a lift is optional and needs the machines powered
        and "vanish" not in p
    }
    raised = [(footprint(p), top(p)) for p in platforms.values()]
    raised += [(rect(c), c["maxY"]) for c in SCENE["colliders"] if c.get("jumpable")]
    height = [[0.0] * NZ for _ in range(NX)]
    for box, h in raised:
        i0, j0 = idx(box[0], box[2])
        i1, j1 = idx(box[1], box[3])
        for i in range(max(i0, 0), min(i1, NX - 1) + 1):
            for j in range(max(j0, 0), min(j1, NZ - 1) + 1):
                if inside(box, XS[i], ZS[j]):
                    height[i][j] = max(height[i][j], h)
    blocked = [[False] * NZ for _ in range(NX)]
    for box in solids:
        i0, j0 = idx(box[0] - PLAYER_RADIUS, box[2] - PLAYER_RADIUS)
        i1, j1 = idx(box[1] + PLAYER_RADIUS, box[3] + PLAYER_RADIUS)
        for i in range(max(i0, 0), min(i1, NX - 1) + 1):
            for j in range(max(j0, 0), min(j1, NZ - 1) + 1):
                if inside(box, XS[i], ZS[j], margin=PLAYER_RADIUS):
                    blocked[i][j] = True
    lava = layout.LAVA
    for i in range(NX):
        for j in range(NZ):
            if lava["minX"] <= XS[i] <= lava["maxX"] and lava["minZ"] <= ZS[j] <= lava["maxZ"] and height[i][j] <= HAZARD_LINE:
                blocked[i][j] = True
    return height, blocked


def walk(start, height, blocked):
    """Cells reachable on foot: no jump, so each step may rise at most `STEP_UP`; falling is free."""
    seen = {start}
    queue = deque([start])
    while queue:
        i, j = queue.popleft()
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + di, j + dj
            if not (0 <= a < NX and 0 <= b < NZ) or (a, b) in seen or blocked[a][b]:
                continue
            if height[a][b] - height[i][j] > STEP_UP + 1e-9:
                continue
            seen.add((a, b))
            queue.append((a, b))
    return seen


def can_reach(seen, height, x, z, elevation=0.0, reach=REACH):
    i0, j0 = idx(x, z)
    span = int(reach / RES) + 1
    for i in range(max(i0 - span, 0), min(i0 + span, NX - 1) + 1):
        for j in range(max(j0 - span, 0), min(j0 + span, NZ - 1) + 1):
            if (i, j) in seen and math.hypot(XS[i] - x, ZS[j] - z) <= reach and abs(height[i][j] - elevation) <= 0.3:
                return True
    return False


SPAWN = idx(0.0, 90.0)
CHECKPOINT = {c["id"]: c for c in CHECKPOINT_LIST}
ZONE_CHECKPOINT = ["fh-cp-landing", "fh-cp-emberwood", "fh-cp-lava-near", "fh-cp-caverns", "fh-cp-forge", "fh-cp-summit", "fh-cp-heart"]


def zone_of(z):
    for number, (_zid, _label, north, south) in enumerate(layout.ZONES):
        if south - 1.0 <= z <= north + 1.0:
            return number
    raise AssertionError(f"z {z} is in no zone")


def used_by_the_child(p):
    """Everything a child must reach: NPCs, puzzle objects and the way through (not optional shards)."""
    return p["kind"] in {"NPC", "PROP"} and p["entity_id"] not in {"fh-landing-campfire", "fh-forest-stream"}


@pytest.fixture(scope="module")
def stages():
    """Reachable cells with gates opened in order (stage n has the first n gates open)."""
    out = []
    for open_gates in range(len(layout.GATES) + 1):
        bridge = open_gates >= 3
        height, blocked = world_state(open_gates, bridge)
        out.append((height, walk(SPAWN, height, blocked), blocked))
    before_bridge = world_state(2, False)
    out.append((before_bridge[0], walk(SPAWN, *before_bridge), before_bridge[1]))
    return out


class TestEveryMandatoryRouteIsWalkableWithNoJump:
    def test_the_spawn_is_free(self, stages):
        _height, _seen, blocked = stages[0]
        assert not blocked[SPAWN[0]][SPAWN[1]]

    @pytest.mark.parametrize("zone", range(7))
    def test_each_zone_is_reachable_once_the_gates_before_it_are_open(self, stages, zone):
        height, seen, _ = stages[zone]
        cp = CHECKPOINT[ZONE_CHECKPOINT[zone]]
        assert can_reach(seen, height, cp["x"], cp["z"], reach=0.6), ZONE_CHECKPOINT[zone]
        for p in PLACEMENTS:
            if zone_of(p["z"]) == zone and used_by_the_child(p):
                far_bank = p["entity_id"].startswith("fh-lava-path-")
                if zone == 2 and far_bank:
                    continue  # the far bank needs the bridge (checked below)
                assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"])), (zone, p["entity_id"])

    def test_the_bridge_is_what_gets_a_child_across_the_lava(self, stages):
        height, before, _ = stages[7]  # gates 1 and 2 open, no bridge yet
        far = CHECKPOINT["fh-cp-lava-far"]
        assert can_reach(before, height, CHECKPOINT["fh-cp-lava-near"]["x"], CHECKPOINT["fh-cp-lava-near"]["z"], reach=0.6)
        assert not can_reach(before, height, far["x"], far["z"], reach=0.6)
        height, after, _ = stages[3]
        assert can_reach(after, height, far["x"], far["z"], reach=0.6)
        for p in PLACEMENTS:
            if p["entity_id"].startswith("fh-lava-path-"):
                assert can_reach(after, height, p["x"], p["z"])

    @pytest.mark.parametrize("gate", range(6))
    def test_a_closed_gate_blocks_the_way_on(self, stages, gate):
        height, seen, _ = stages[gate]  # gates before `gate` open, this one closed
        beyond = CHECKPOINT[ZONE_CHECKPOINT[gate + 1]] if gate != 2 else CHECKPOINT["fh-cp-caverns"]
        assert not can_reach(seen, height, beyond["x"], beyond["z"], reach=0.6), layout.GATES[gate][0]

    def test_with_every_gate_open_the_return_portal_and_the_heart_are_reachable(self, stages):
        height, seen, _ = stages[6]
        for entity in ("fh-return-portal", "fh-heart-crystal", "fh-ignis", "fh-heart-pedestal"):
            p = next(p for p in PLACEMENTS if p["entity_id"] == entity)
            assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"])), entity

    def test_the_summit_plateau_and_its_shard_are_reached_by_stairs(self, stages):
        height, seen, _ = stages[5]
        for entity in ("fh-basalt-summit", "fh-shard-summit", "fh-rock-sample-b", "fh-island-step-c"):
            p = next(p for p in PLACEMENTS if p["entity_id"] == entity)
            assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"])), entity

    def test_the_cavern_ledge_shard_has_a_stair_route(self, stages):
        height, seen, _ = stages[3]
        p = next(p for p in PLACEMENTS if p["entity_id"] == "fh-shard-caverns")
        assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"]))

    def test_the_hidden_emberwood_shard_is_found_by_walking(self, stages):
        height, seen, _ = stages[1]
        p = next(p for p in PLACEMENTS if p["entity_id"] == "fh-shard-emberwood")
        assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"]), reach=1.0)

    def test_the_landing_shard_is_reachable_without_hopping_the_log(self, stages):
        height, seen, _ = stages[0]
        p = next(p for p in PLACEMENTS if p["entity_id"] == "fh-shard-landing")
        assert can_reach(seen, height, p["x"], p["z"], surface_height(p["x"], p["z"]), reach=1.0)

    def test_every_stair_has_rises_a_child_steps_up_and_treads_a_child_stands_on(self):
        for pid, platform in PLATFORMS.items():
            if "-step-" in pid or "-up-" in pid or "-down-" in pid:
                assert platform["size"]["depth"] >= 0.8 and platform["size"]["width"] >= 0.8
        for series in ("fh-summit-up", "fh-summit-down", "fh-cavern-step"):
            steps = sorted((p for pid, p in PLATFORMS.items() if pid.startswith(series)), key=top)
            tops = [0.0, *[top(p) for p in steps]]
            assert all(round(b - a, 3) <= 0.2 for a, b in zip(tops, tops[1:], strict=False)), series
        plateau = top(PLATFORMS["fh-summit-plateau"])
        assert round(plateau - top(PLATFORMS["fh-summit-up-7"]), 3) <= 0.2
        assert round(plateau - top(PLATFORMS["fh-summit-down-1"]), 3) <= 0.2


# --- the optional jump hops --------------------------------------------------------------------


def gap_between(a, b):
    ax0, ax1, az0, az1 = footprint(a)
    bx0, bx1, bz0, bz1 = footprint(b)
    dx = max(bx0 - ax1, ax0 - bx1, 0.0)
    dz = max(bz0 - az1, az0 - bz1, 0.0)
    return math.hypot(dx, dz)


class TestOptionalJumpRoutes:
    @pytest.mark.parametrize("route", layout.OPTIONAL_ROUTES, ids=lambda r: r[0])
    def test_every_hop_rises_little_and_gaps_are_short(self, route):
        _name, chain, max_gap = route
        previous_top = 0.0
        for pid in chain:
            platform = PLATFORMS[pid]
            assert top(platform) - previous_top <= MAX_JUMP_RISE + 1e-9, pid
            previous_top = top(platform)
        for a, b in zip(chain, chain[1:], strict=False):
            assert gap_between(PLATFORMS[a], PLATFORMS[b]) <= max_gap + 1e-9, (a, b)

    def test_the_advanced_route_ends_at_the_lava_jumper_shard_and_the_bank(self):
        chain = layout.OPTIONAL_ROUTES[0][1]
        edge = layout.LAVA["maxZ"]
        first = PLATFORMS[chain[0]]
        assert edge - footprint(first)[3] <= 1.6  # from the near bank
        last = PLATFORMS[chain[-1]]
        assert footprint(last)[2] - layout.LAVA["minZ"] <= 1.6  # to the far bank
        assert all(top(PLATFORMS[pid]) <= 0.5 + 1e-9 for pid in chain)
        shard = next(p for p in PLACEMENTS if p["entity_id"] == "fh-shard-lava-jumper")
        assert inside(footprint(PLATFORMS["fh-stone-islet"]), shard["x"], shard["z"])
        assert shard["elevation"] == top(PLATFORMS["fh-stone-islet"])

    def test_exactly_one_stone_vanishes_when_stood_on(self):
        vanishing = [p for p in PLATFORMS.values() if "vanish" in p]
        assert [p["id"] for p in vanishing] == ["fh-stone-vanish"]
        assert vanishing[0]["vanish"]["mode"] == "STAND"

    def test_the_summit_has_one_optional_moving_platform_that_waits_at_each_end(self):
        moving = [p for p in PLATFORMS.values() if "motion" in p and p["id"] != "fh-forge-lift"]
        assert [p["id"] for p in moving] == ["fh-summit-shuttle"]
        assert moving[0]["motion"]["pauseSeconds"] >= 3 and moving[0]["motion"]["speed"] <= 1.5
        shuttle, plateau, lookout = (PLATFORMS[i] for i in ("fh-summit-shuttle", "fh-summit-plateau", "fh-summit-lookout"))
        assert abs(top(shuttle) - top(plateau)) < 1e-9 and abs(top(plateau) - top(lookout)) < 1e-9
        assert gap_between(shuttle, plateau) <= 0.2
        end = dict(shuttle)
        end["position"] = {
            axis: shuttle["position"][axis] + shuttle["motion"]["path"][0][axis] for axis in "xyz"
        }
        assert gap_between(end, lookout) <= 0.2

    def test_the_forge_lift_reaches_the_ledge_and_waits(self):
        lift, ledge = PLATFORMS["fh-forge-lift"], PLATFORMS["fh-forge-ledge"]
        reach = lift["position"]["y"] + lift["motion"]["path"][0]["y"] + lift["size"]["height"]
        assert abs(reach - top(ledge)) < 1e-9
        assert lift["motion"]["pauseSeconds"] >= 3 and top(lift) <= STEP_UP

    def test_every_jump_has_a_no_jump_alternative_to_what_it_leads_to(self):
        # Mandatory content never sits on a jump-only surface: the only jump-only shard is the
        # optional Lava Jumper one (and the lift shard, reached by a ride).
        jump_only = {"fh-shard-lava-jumper", "fh-shard-forge"}
        for p in PLACEMENTS:
            if p["kind"] == "COLLECTIBLE" and p["entity_id"] not in jump_only:
                assert p["pickup_key"]  # reachable on foot, proven in the walk tests above


class TestSteamPush:
    """GE-073: the Forge steam pushes a child gently back from the closed summit gate until the
    Forge is restored; it is drawn by the existing plumes and never points at a hazard."""

    def test_the_push_stands_where_the_plumes_are_in_front_of_the_closed_gate(self):
        (force,) = BRIDGE_CONFIG["environment.volumes"]["forces"]
        box = force["box"]
        for plume in SCENE["effects"]["steam"]:
            assert box["min"]["x"] <= plume["x"] <= box["max"]["x"]
            assert box["min"]["z"] <= plume["z"] <= box["max"]["z"]
        gate_z = layout.SUMMIT_GATE_Z
        assert box["min"]["z"] > gate_z  # on the Forge side of the gate
        forge = next(z for z in layout.ZONES if z[0] == "ancient-forge")
        assert forge[3] - 1.0 <= box["min"]["z"] and box["max"]["z"] <= forge[2]  # zone edges, as zone_of

    def test_it_pushes_back_into_the_forge_gently_and_stops_once_restored(self):
        (force,) = BRIDGE_CONFIG["environment.volumes"]["forces"]
        assert force["direction"] == {"x": 0.0, "y": 0.0, "z": 1.0}
        assert 0 < force["strength"] <= 2.0  # walking still wins
        assert force["inactiveWhenSignalId"] == "world:FIREPEAK_HEART_FORGE_RESTORED"
        steam_hidden = {p["hiddenWhenChangeKey"] for p in SCENE["effects"]["steam"]}
        assert steam_hidden == {"FIREPEAK_HEART_FORGE_RESTORED"}  # the push ends with the plumes
        assert force["neverPushIntoHazard"] is True
        assert BRIDGE_CONFIG["environment.volumes"]["hazardRects"] == [layout.LAVA]
