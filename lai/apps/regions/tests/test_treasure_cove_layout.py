"""Treasure Cove's four-zone layout (TR-13): its shape, its snapshot, how the seed applies it."""

import json
import math

import pytest

from apps.assets.model_packs import PACKS
from apps.catalog.importer import import_content
from apps.regions.models import WorldRegion
from apps.regions import treasure_cove_vegetation as VEG
from apps.regions.treasure_cove_layout import (
    BARREL,
    BOUNDS,
    KEEP_CLEAR,
    LAYOUT_VERSION,
    LOG,
    MOSS_LOG,
    PALM_HEIGHTS,
    PALM_TRUNK_HALF,
    PATHS,
    PROP_SIZES,
    SNAPSHOT_PATH,
    SPOTS,
    UNLOCK,
    WOOD_PILE,
    _prop,
    cove_layout,
)
from apps.regions.treasure_rush_seed import LANDING_YAW, REGION_ID, seed_treasure_rush

PROCEDURAL_SHAPES = {
    "PALM",
    "TENT",
    "CAMPFIRE",
    "TORCH",
    "FLAG",
    "ROWBOAT",
    "PILLAR",
    "PEDESTAL",
    "GATE",
    "BROKEN_PLANKS",
    "BRIDGE",
    "LANTERNS",
    "SPYGLASS",
}
ZONE_FOR_SPOT = {
    "landing-chest": None,  # on the path just south of the yard, in sight of the spawn point
    "grove-hidden-chest": "cove-zone-grove",
    "beach-key": "cove-zone-beach",
    "beach-locked-chest": "cove-zone-beach",
    "ruins-final-chest": "cove-zone-ruins",
}


def inside(rect: dict, x: float, z: float) -> bool:
    return rect["minX"] <= x <= rect["maxX"] and rect["minZ"] <= z <= rect["maxZ"]


@pytest.fixture(scope="module")
def layout():
    return cove_layout()


def test_the_snapshot_the_frontend_tests_load_is_current(layout):
    stored = json.loads(SNAPSHOT_PATH.read_text())
    assert stored == json.loads(json.dumps(layout)), (
        "Run `python -m apps.regions.treasure_cove_layout` from lai/ to rewrite the snapshot."
    )


def test_every_id_is_unique(layout):
    ids = [
        item["id"] for key in ("scenery", "ambient", "lights", "procedural") for item in layout[key]
    ]
    ids += [item["rect"]["id"] for key in ("colliders", "zones") for item in layout[key]]
    ids += [item["area"]["id"] for item in layout["scenery"] if "area" in item]
    assert len(ids) == len(set(ids))


def test_five_zones_inside_the_bounds_that_do_not_overlap(layout):
    zones = [zone["rect"] for zone in layout["zones"]]
    assert [zone["id"] for zone in zones] == [
        "cove-zone-landing",
        "cove-zone-grove",
        "cove-zone-beach",
        "cove-zone-ruins",
        "cove-zone-lookout",  # SM-P7: a trigger volume only; the gate still holds the way
    ]
    for zone in zones:
        assert -BOUNDS["halfExtentX"] <= zone["minX"] < zone["maxX"] <= BOUNDS["halfExtentX"]
        assert -BOUNDS["halfExtentZ"] <= zone["minZ"] < zone["maxZ"] <= BOUNDS["halfExtentZ"]
        assert zone_message(layout, zone["id"]) and "—" not in zone_message(layout, zone["id"])
    for a in zones:
        for b in zones:
            if a is b:
                continue
            overlap_x = min(a["maxX"], b["maxX"]) - max(a["minX"], b["minX"])
            overlap_z = min(a["maxZ"], b["maxZ"]) - max(a["minZ"], b["minZ"])
            assert overlap_x <= 0 or overlap_z <= 0, (a["id"], b["id"])


def zone_message(layout, zone_id):
    return next(zone["enterMessage"] for zone in layout["zones"] if zone["rect"]["id"] == zone_id)


@pytest.mark.parametrize("spot", sorted(ZONE_FOR_SPOT))
def test_every_encounter_spot_is_reachable_ground_in_its_zone(layout, spot):
    x, z = SPOTS[spot]
    for collider in layout["colliders"]:
        assert not inside(collider["rect"], x, z), (spot, collider["rect"]["id"])
    zone = ZONE_FOR_SPOT[spot]
    if zone:
        rect = next(item["rect"] for item in layout["zones"] if item["rect"]["id"] == zone)
        assert inside(rect, x, z)


def colliders_by_id(layout):
    return {c["rect"]["id"]: c["rect"] for c in layout["colliders"]}


def test_lookout_point_is_shut_off_until_the_gate_opens(layout):
    # Closed: the gate and the whole channel (west + gap + east) block every crossing.
    colliders = colliders_by_id(layout)
    west = colliders["cove-channel-west:collider"]
    gap = colliders["cove-channel-gap:collider"]
    east = colliders["cove-channel-east:collider"]
    assert west["minX"] <= -BOUNDS["halfExtentX"] and east["maxX"] >= BOUNDS["halfExtentX"]
    assert west["maxX"] == gap["minX"] and gap["maxX"] == east["minX"]  # no crack between them
    assert west["minZ"] == gap["minZ"] == east["minZ"]
    assert west["maxZ"] == gap["maxZ"] == east["maxZ"]
    assert gap["minZ"] < SPOTS["ruins-gate"][1] - 1 < gap["maxZ"]  # just past the gate
    assert SPOTS["lookout-point"][1] < gap["minZ"]


def test_unlock_opens_exactly_the_gate_and_the_gap_so_the_bridge_is_the_only_way(layout):
    unlock = layout["unlock"]
    colliders = colliders_by_id(layout)
    assert unlock["changeKey"] == "TREASURE_COVE_QUEST_COMPLETE"
    assert sorted(unlock["openColliders"]) == [
        "cove-channel-gap:collider",
        "cove-ruins-gate:collider",
    ]
    for collider_id in unlock["openColliders"]:
        assert collider_id in colliders
    # Once open, the sides still hold: the walkable gap is the bridge's width and no wider.
    gap = colliders["cove-channel-gap:collider"]
    bridge = next(p for p in layout["procedural"] if p["id"] == "cove-bridge")
    assert gap["minX"] < bridge["x"] < gap["maxX"]
    # The deck spans the channel and the gate's threshold, so the walkable gap is always bridged.
    half_length = bridge["height"] / 2
    assert bridge["z"] + half_length >= colliders["cove-ruins-gate:collider"]["minZ"]
    assert bridge["z"] - half_length <= gap["minZ"]
    procedural = {p["id"] for p in layout["procedural"]}
    for placeholder in unlock["showWhenOpen"] + unlock["hideWhenOpen"] + unlock["liftGates"]:
        assert placeholder in procedural, placeholder


def test_lookout_point_is_inside_the_bounds_and_reachable_from_the_bridge(layout):
    colliders = colliders_by_id(layout)
    gap = colliders["cove-channel-gap:collider"]
    for spot in ("lookout-point", "lookout-spyglass"):
        x, z = SPOTS[spot]
        assert abs(x) < BOUNDS["halfExtentX"] and abs(z) < BOUNDS["halfExtentZ"]
        assert z < gap["minZ"]  # beyond the channel
        for collider in layout["colliders"]:
            assert not inside(collider["rect"], x, z), (spot, collider["rect"]["id"])
    # Walking straight from the bridge to the flag meets nothing (no pillar or palm collider).
    for z in (gap["minZ"] - 0.5, SPOTS["lookout-spyglass"][1], SPOTS["lookout-point"][1]):
        for collider in layout["colliders"]:
            if collider["rect"]["id"].startswith("cove-channel"):
                continue
            assert not inside(collider["rect"], 0.0, z), (z, collider["rect"]["id"])


def test_procedural_placeholders_use_known_shapes(layout):
    assert {item["shape"] for item in layout["procedural"]} <= PROCEDURAL_SHAPES
    shapes = {item["shape"] for item in layout["procedural"]}
    assert shapes == PROCEDURAL_SHAPES  # every placeholder shape is used, so none is dead code


@pytest.mark.postgres
@pytest.mark.django_db
class TestSeedAppliesTheLayout:
    def test_a_new_region_gets_the_layout_and_faces_inland(self):
        import_content()
        seed_treasure_rush()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        assert region.scene["layoutVersion"] == LAYOUT_VERSION
        assert region.scene["bounds"] == BOUNDS
        assert region.scene["layout"] == json.loads(json.dumps(cove_layout()))
        assert region.spawn_points.get().yaw == pytest.approx(LANDING_YAW)
        assert seed_treasure_rush() == []

    def test_an_older_region_is_upgraded_once_and_keeps_admin_edits(self):
        import_content()
        seed_treasure_rush()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        old_scene = {
            "bounds": {"halfExtentX": 18, "halfExtentZ": 18, "wallThickness": 1},
            "copy": {"instructions": "An admin's words."},
            "adventureVersion": 1,  # only the layout is behind
        }
        WorldRegion.objects.filter(pk=region.pk).update(
            scene=old_scene, title="Pirate Cove", version=3
        )
        region.spawn_points.update(yaw=0.0)

        # The cove layout is upgraded; a scene from before Pirate's Leap also gets the course, once
        # (LAI-JMP-03 keeps its own version, so neither ever replaces the other).
        assert seed_treasure_rush() == [
            f"WorldRegion {REGION_ID} layout v{LAYOUT_VERSION}",
            "Pirate's Leap course v1",
        ]
        region.refresh_from_db()
        assert region.title == "Pirate Cove"
        assert region.version == 5  # the layout upgrade and the Pirate's Leap course, one each
        assert region.scene["copy"] == {"instructions": "An admin's words."}
        assert region.scene["adventureVersion"] == 1
        assert region.scene["bounds"] == BOUNDS
        assert region.scene["layoutVersion"] == LAYOUT_VERSION
        assert region.spawn_points.get().yaw == pytest.approx(math.pi)
        assert seed_treasure_rush() == []

    def test_a_spawn_point_an_admin_turned_is_left_alone(self):
        import_content()
        seed_treasure_rush()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        WorldRegion.objects.filter(pk=region.pk).update(scene={})
        region.spawn_points.update(yaw=1.0)
        seed_treasure_rush()
        assert region.spawn_points.get().yaw == pytest.approx(1.0)


def test_gates_and_walls_are_never_jumpable_and_props_carry_their_height():
    """LAI-JMP-01 with the library props: low props (barrels, logs) are hopped onto or over on the
    client from their drawn height (layout v8); the gate, channel and walls stay solid at any height."""
    layout = cove_layout()
    jumpable = {c["rect"]["id"] for c in layout["colliders"] if c.get("jumpable")}
    assert not set(UNLOCK["openColliders"]) & jumpable
    assert not any(c.get("requirements") and c.get("jumpable") for c in layout["colliders"])
    for prop in layout["props"]:
        assert 0 < prop["height"] <= 1.2, prop["id"]  # every barrel, log and pile is low


# Pirate's Leap (LAI-JMP-03) lives in its own scene block (`pirates_leap_seed.py`), in this corner.
PIRATES_LEAP_AREA = {"minX": -35.5, "maxX": -14.4, "minZ": -36.0, "maxZ": -16.4}


def test_nothing_in_the_cove_layout_stands_in_the_pirates_leap_course(layout):
    points = [(p["id"], p["x"], p["z"]) for p in layout["props"]]
    points += [(p["id"], p["x"], p["z"]) for p in layout["vegetation"]]
    points += [(p["id"], p["x"], p["z"]) for p in layout["procedural"]]
    for item in layout["scenery"]:
        for position in item.get("positions", []):
            points.append((item["id"], position["x"], position["z"]))
        if "position" in item:
            points.append((item["id"], item["position"]["x"], item["position"]["z"]))
    for item_id, x, z in points:
        assert not inside(PIRATES_LEAP_AREA, x, z), item_id
    for collider in layout["colliders"]:
        assert rect_gap(collider["rect"], PIRATES_LEAP_AREA) > 0, collider["rect"]["id"]


# --- Palms (TR-PALM-05) ------------------------------------------------------------------------

PALM_MODELS = {
    "nature-palm-tree-small",
    "nature-palm-tree-standard",
    "nature-palm-tree-tall",
    "nature-palm-tree-curved",
}
# How many palms each zone has: the owner's guideline ranges.
PALM_COUNTS = {
    "cove-landing-palm": (4, 6),
    "cove-beach-palm": (8, 12),
    "cove-grove-palm": (15, 20),
    "cove-ruins-palm": (4, 6),
    "cove-lookout-palm": (2, 4),
}


def palms(layout):
    return [item for item in layout["procedural"] if item["shape"] == "PALM"]


def distance_to_segment(px, pz, a, b):
    (ax, az), (bx, bz) = a, b
    dx, dz = bx - ax, bz - az
    length = dx * dx + dz * dz
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / length))
    return math.hypot(px - ax - t * dx, pz - az - t * dz)


def distance_to_rect(px, pz, rect):
    dx = max(rect["minX"] - px, 0.0, px - rect["maxX"])
    dz = max(rect["minZ"] - pz, 0.0, pz - rect["maxZ"])
    return math.hypot(dx, dz)


def test_each_zone_has_its_share_of_palms(layout):
    for prefix, (low, high) in PALM_COUNTS.items():
        count = sum(1 for palm in palms(layout) if palm["id"].startswith(f"{prefix}-"))
        assert low <= count <= high, (prefix, count)
    assert sum(PALM_COUNTS[p][0] for p in PALM_COUNTS) <= len(palms(layout))


def test_every_palm_names_a_library_model_and_uses_all_four(layout):
    used = set()
    for palm in palms(layout):
        assert palm["assetId"] in PALM_MODELS, palm["id"]
        assert PALM_HEIGHTS[palm["assetId"]] * 0.9 <= palm["height"] <= PALM_HEIGHTS[
            palm["assetId"]
        ] * 1.1
        assert 0 <= palm["rotationY"] < 2 * math.pi
        used.add(palm["assetId"])
    assert used == PALM_MODELS


def test_the_placement_is_authored_so_every_visit_is_the_same(layout):
    assert cove_layout()["procedural"] == layout["procedural"]
    assert json.dumps(cove_layout(), sort_keys=True) == json.dumps(layout, sort_keys=True)


def test_every_trunk_has_a_small_collider_and_nothing_else_does(layout):
    colliders = colliders_by_id(layout)
    for palm in palms(layout):
        rect = colliders[f"{palm['id']}:collider"]
        assert rect["maxX"] - rect["minX"] == pytest.approx(2 * PALM_TRUNK_HALF)
        assert rect["maxZ"] - rect["minZ"] == pytest.approx(2 * PALM_TRUNK_HALF)
        assert inside(rect, palm["x"], palm["z"])


def test_palms_keep_the_paths_open(layout):
    for palm in palms(layout):
        nearest = min(
            distance_to_segment(palm["x"], palm["z"], a, b)
            for path in PATHS
            for a, b in zip(path, path[1:], strict=False)
        )
        assert nearest >= 2.0, (palm["id"], round(nearest, 2))


def test_palms_keep_people_and_encounters_clear(layout):
    for palm in palms(layout):
        for x, z in KEEP_CLEAR:
            assert math.hypot(palm["x"] - x, palm["z"] - z) >= 2.5, (palm["id"], (x, z))


def test_palm_trunks_do_not_crowd_other_colliders(layout):
    others = [c["rect"] for c in layout["colliders"] if "-palm-" not in c["rect"]["id"]]
    for palm in palms(layout):
        for rect in others:
            assert distance_to_rect(palm["x"], palm["z"], rect) >= 0.9, (palm["id"], rect["id"])


def test_palms_stand_apart_from_each_other_and_the_other_scenery(layout):
    trees = palms(layout)
    for a in trees:
        for b in trees:
            if a is not b:
                assert math.hypot(a["x"] - b["x"], a["z"] - b["z"]) >= 3.0, (a["id"], b["id"])
    placed = [
        (item["id"], p["x"], p["z"])
        for item in layout["scenery"]
        if item["kind"] == "CLUSTER" and item["assetId"] not in ("path", "path-forest")
        for p in item["positions"]
    ]
    placed += [
        (item["id"], item["position"]["x"], item["position"]["z"])
        for item in layout["scenery"]
        if item["kind"] == "MODEL"
    ]
    placed += [(p["id"], p["x"], p["z"]) for p in layout["procedural"] if p["shape"] != "PALM"]
    for palm in trees:
        for item_id, x, z in placed:
            assert math.hypot(palm["x"] - x, palm["z"] - z) >= 1.5, (palm["id"], item_id)


def test_palms_stand_inside_the_cove(layout):
    for palm in palms(layout):
        assert abs(palm["x"]) <= BOUNDS["halfExtentX"] - 1
        assert abs(palm["z"]) <= BOUNDS["halfExtentZ"] - 1
        assert not inside({"minX": -2, "maxX": 2, "minZ": -40.4, "maxZ": -35.4}, palm["x"], palm["z"])


# --- Barrels and logs (TR-ENV-06) --------------------------------------------------------------

PROP_COUNTS = {  # zone prefix: (barrels, logs and wood piles)
    "cove-landing-": (4, 2),
    "cove-beach-": (8, 4),
    "cove-grove-": (2, 8),
    "cove-ruins-": (4, 3),
    "cove-lookout-": (1, 1),
}


def rect_gap(a, b):
    dx = max(a["minX"] - b["maxX"], b["minX"] - a["maxX"], 0.0)
    dz = max(a["minZ"] - b["maxZ"], b["minZ"] - a["maxZ"], 0.0)
    return math.hypot(dx, dz)


def rects_overlap(a, b):
    return (
        a["minX"] < b["maxX"]
        and b["minX"] < a["maxX"]
        and a["minZ"] < b["maxZ"]
        and b["minZ"] < a["maxZ"]
    )


def test_each_zone_has_its_barrels_and_logs(layout):
    for prefix, (barrels, logs) in PROP_COUNTS.items():
        props = [p for p in layout["props"] if p["id"].startswith(prefix)]
        assert sum(p["assetId"] == BARREL for p in props) == barrels, prefix
        assert sum(p["assetId"] != BARREL for p in props) == logs, prefix
    assert {p["assetId"] for p in layout["props"]} == set(PROP_SIZES)


def test_prop_sizes_match_what_the_import_prepares():
    fits = {
        model.asset_id: model.fit
        for pack in PACKS.values()
        for model in pack.models
        if model.asset_id in PROP_SIZES
    }
    assert set(fits) == set(PROP_SIZES)
    for asset_id, (axis, metres) in fits.items():
        length, _width, height = PROP_SIZES[asset_id]
        assert {"x": length, "y": height}[axis] == pytest.approx(metres)


@pytest.mark.parametrize(
    ("asset_id", "yaw", "options"),
    [
        (BARREL, 0.0, {}),
        (BARREL, 0.0, {"lying": True}),
        (LOG, 0.0, {}),
        (LOG, math.pi / 2, {"scale": 0.8}),
        (MOSS_LOG, 0.0, {}),
        (WOOD_PILE, 0.0, {}),
    ],
)
def test_colliders_cover_exactly_the_footprint(asset_id, yaw, options):
    prop = _prop("p", asset_id, 3.0, -2.0, yaw, **options)
    length, width, height = PROP_SIZES[asset_id]
    if options.get("lying"):
        length = height
    scale = options.get("scale", 1.0)
    rects = prop["colliders"]
    span_x = max(r["maxX"] for r in rects) - min(r["minX"] for r in rects)
    span_z = max(r["maxZ"] for r in rects) - min(r["minZ"] for r in rects)
    along, across = (span_x, span_z) if abs(math.cos(yaw)) > 0.5 else (span_z, span_x)
    assert along == pytest.approx(length * scale, abs=0.02)
    assert across == pytest.approx(width * scale, abs=0.02)
    for a, b in zip(rects, rects[1:], strict=False):
        assert rects_overlap(a, b) or rect_gap(a, b) == 0  # one solid shape, no cracks


def test_a_turned_log_never_grows_an_invisible_corner():
    prop = _prop("p", LOG, 0.0, 0.0, math.pi / 4)
    length, width, _ = PROP_SIZES[LOG]
    for rect in prop["colliders"]:
        cx, cz = (rect["minX"] + rect["maxX"]) / 2, (rect["minZ"] + rect["maxZ"]) / 2
        # Every square's centre is on the log's axis and inside its length.
        assert abs(cx + cz) < 0.02
        assert math.hypot(cx, cz) <= (length - width) / 2 + 0.02


def test_barrels_and_logs_keep_paths_people_and_encounters_clear(layout):
    for prop in layout["props"]:
        for rect in prop["colliders"]:
            cx, cz = (rect["minX"] + rect["maxX"]) / 2, (rect["minZ"] + rect["maxZ"]) / 2
            half = (rect["maxX"] - rect["minX"]) / 2
            nearest = min(
                distance_to_segment(cx, cz, a, b)
                for path in PATHS
                for a, b in zip(path, path[1:], strict=False)
            )
            assert nearest - half >= 1.0, (prop["id"], round(nearest - half, 2))
            for x, z in KEEP_CLEAR:
                assert distance_to_rect(x, z, rect) >= 1.5, (prop["id"], (x, z))


def test_no_cracks_and_no_traps_between_props_walls_and_trunks(layout):
    rects = [(p["id"], r) for p in layout["props"] for r in p["colliders"]]
    walls = [(c["rect"]["id"], c["rect"]) for c in layout["colliders"]]
    for prop_id, rect in rects:
        for other_id, other in rects + walls:
            if other_id == prop_id:
                continue
            gap = rect_gap(rect, other)
            # Touching things are one solid shape; anything else leaves a child-sized way through.
            assert gap == 0 or gap >= 0.6, (prop_id, other_id, round(gap, 2))
            if other_id.endswith(":collider") or "-palm-" in other_id:
                assert not rects_overlap(rect, other), (prop_id, other_id)


def test_props_stand_clear_of_the_scenery_that_stays(layout):
    replaced = {item for ids in layout["propReplaces"].values() for item in ids}
    staying = [
        (item["id"], p["x"], p["z"])
        for item in layout["scenery"]
        if item["kind"] == "CLUSTER"
        and item["assetId"] not in ("path", "path-forest")
        and item["id"] not in replaced
        for p in item["positions"]
    ]
    staying += [(p["id"], p["x"], p["z"]) for p in layout["procedural"]]
    for prop in layout["props"]:
        for rect in prop["colliders"]:
            assert abs(rect["minX"]) <= BOUNDS["halfExtentX"] and abs(rect["maxX"]) <= 36
            assert rect["minZ"] >= -BOUNDS["halfExtentZ"] and rect["maxZ"] <= 44
            for item_id, x, z in staying:
                limit = 0.9 if item_id.startswith("cove-") and "-palm-" in item_id else 0.6
                assert distance_to_rect(x, z, rect) >= limit, (prop["id"], item_id)


def test_what_the_props_replace_is_bundled_scenery_that_exists(layout):
    scenery = {item["id"] for item in layout["scenery"]}
    assert set(layout["propReplaces"]) <= set(PROP_SIZES)
    for ids in layout["propReplaces"].values():
        assert ids and set(ids) <= scenery


def test_lying_barrels_and_turned_props_are_authored(layout):
    lying = [p for p in layout["props"] if "rotationZ" in p]
    assert lying and all(p["assetId"] == BARREL for p in lying)
    assert all(p["rotationZ"] == pytest.approx(math.pi / 2, abs=0.01) for p in lying)
    assert cove_layout()["props"] == layout["props"]


# --- Bushes, flowers and grass (ENV-2, TR-NAT-10/11) -------------------------------------------

VEGETATION_MODELS = {
    model.asset_id
    for pack in PACKS.values()
    if pack.group in ("bushes", "flowers", "grass")
    for model in pack.models
}


def plants(layout):
    return layout["vegetation"]


def test_every_zone_gets_its_planned_vegetation_from_library_models(layout):
    for zone, plan in VEG.PLAN.items():
        for category, count in plan.items():
            made = [p for p in plants(layout) if p["id"].startswith(f"cove-{zone}-{category}-")]
            assert len(made) == count, (zone, category)
    assert {p["assetId"] for p in plants(layout)} == VEGETATION_MODELS
    ids = [p["id"] for p in plants(layout)]
    assert len(ids) == len(set(ids))


def test_vegetation_is_walk_through_and_the_same_every_time(layout):
    assert all(p["colliders"] == [] for p in plants(layout))
    assert cove_layout()["vegetation"] == plants(layout)
    for plant in plants(layout):
        assert 0.85 <= plant["scale"] <= 1.2 and 0 <= plant["rotationY"] < 2 * math.pi


def test_vegetation_keeps_paths_spots_and_solids_clear(layout):
    solids = [c["rect"] for c in layout["colliders"]] + [
        rect for prop in layout["props"] for rect in prop["colliders"]
    ]
    for plant in plants(layout):
        category = plant["id"].split("-")[2]
        x, z = plant["x"], plant["z"]
        nearest = min(
            distance_to_segment(x, z, a, b)
            for path in PATHS
            for a, b in zip(path, path[1:], strict=False)
        )
        assert nearest >= VEG.PATH_CLEARANCE[category], (plant["id"], round(nearest, 2))
        for kx, kz in KEEP_CLEAR:
            assert math.hypot(x - kx, z - kz) >= VEG.SPOT_CLEARANCE[category], plant["id"]
        for rect in solids:
            assert not inside(rect, x, z), (plant["id"], rect["id"])
        for water in VEG.NO_GROW:
            assert not inside(water, x, z), plant["id"]


def test_vegetation_stands_in_its_zone_and_does_not_pile_up(layout):
    zones = {zone["rect"]["id"]: zone["rect"] for zone in layout["zones"]}
    radius = {**VEG.BUSHES, **VEG.FLOWERS, **VEG.GRASS}
    for plant in plants(layout):
        zone = zones[VEG.ZONE_RECTS[plant["id"].split("-")[1]]]
        assert inside(zone, plant["x"], plant["z"]), plant["id"]
    for i, a in enumerate(plants(layout)):
        for b in plants(layout)[i + 1 :]:
            gap = math.hypot(a["x"] - b["x"], a["z"] - b["z"])
            least = radius[a["assetId"]] * a["scale"] + radius[b["assetId"]] * b["scale"]
            assert gap >= least, (a["id"], b["id"])


def test_bushes_never_hide_a_chest_or_crowd_the_yard(layout):
    for plant in plants(layout):
        if "-bush-" not in plant["id"]:
            continue
        assert not inside(VEG.OPEN_YARD, plant["x"], plant["z"]), plant["id"]
        for spot in ("landing-chest", "grove-hidden-chest", "beach-locked-chest",
                     "ruins-final-chest", "lookout-spyglass"):
            sx, sz = SPOTS[spot]
            assert math.hypot(plant["x"] - sx, plant["z"] - sz) >= 3.0, (plant["id"], spot)
