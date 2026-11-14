"""Treasure Cove's four-zone layout (TR-13): its shape, its snapshot, how the seed applies it."""

import json
import math

import pytest

from apps.catalog.importer import import_content
from apps.regions.models import WorldRegion
from apps.regions.treasure_cove_layout import (
    BOUNDS,
    LAYOUT_VERSION,
    SNAPSHOT_PATH,
    SPOTS,
    UNLOCK,
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


def test_only_low_ungated_scenery_is_jumpable():
    """LAI-JMP-01: barrels can be hopped; the gate, channel and walls stay solid at any height."""
    layout = cove_layout()
    jumpable = [c for c in layout["colliders"] if c.get("jumpable")]
    assert [c["rect"]["id"] for c in jumpable] == [
        f"cove-landing-barrel-{i}:collider" for i in range(4)
    ]
    for collider in jumpable:
        assert collider["minY"] == 0
        assert 0 < collider["maxY"] <= 1.0
        assert "requirements" not in collider
    unlock_colliders = set(UNLOCK["openColliders"])
    assert not unlock_colliders & {c["rect"]["id"] for c in jumpable}
