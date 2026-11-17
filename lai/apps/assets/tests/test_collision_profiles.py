"""Asset Manager collision profiles (`apps/assets/collision.py`, `docs/ASSET_COLLISION_PROFILES.md`)."""

import io
import json
import math

import pytest
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.assets import collision, services
from apps.assets.models import (
    CollisionAxis,
    CollisionBehavior,
    CollisionProfile,
    CollisionShape,
)
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.assets.tests.test_admin import staff
from apps.assets.validation import validate_model

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

PROFILES = "/admin/assets/collisionprofile/"


def published(asset, half_size=(0.5, 1.0, 0.25)):
    data = glb_bytes(half_size=half_size)
    version = services.upload_version(asset, io.BytesIO(data), original_filename="m.glb")
    return services.publish_version(version)


def profile(asset, **fields):
    return CollisionProfile.objects.create(asset=asset, **fields)


def span(boxes, axis):
    low = min(b[f"min{axis}"] for b in boxes)
    high = max(b[f"max{axis}"] for b in boxes)
    return round(high - low, 4)


# --- measuring -----------------------------------------------------------------------------


def test_validation_records_the_bounding_corners_for_collision():
    data = glb_bytes(half_size=(0.5, 1.0, 0.25))
    result = validate_model(io.BytesIO(data), size=len(data))
    assert result.metadata["bounds"] == {"min": [-0.5, -1.0, -0.25], "max": [0.5, 1.0, 0.25]}
    assert result.dimensions == {"x": 1.0, "y": 2.0, "z": 0.5}


def test_bounds_fall_back_to_a_ground_pivoted_size_for_older_versions():
    asset = make_definition("crate", kind="prop", category="prop")
    version = published(asset)
    version.metadata = {k: v for k, v in version.metadata.items() if k != "bounds"}
    bounds = collision.version_bounds(version)
    assert bounds.source == "dimensions"
    assert bounds.low == (-0.5, 0.0, -0.25) and bounds.high == (0.5, 2.0, 0.25)


# --- shapes --------------------------------------------------------------------------------


def test_an_empty_box_is_the_automatic_bounding_box():
    asset = make_definition("crate", kind="prop", category="prop")
    version = published(asset)
    result = collision.runtime_collision(profile(asset), version)
    assert result["shape"] == "BOX"
    assert result["boxes"] == [
        {"minX": -0.5, "minY": -1.0, "minZ": -0.25, "maxX": 0.5, "maxY": 1.0, "maxZ": 0.25}
    ]
    # 2 m tall, so automatic behaviour is solid.
    assert result["behavior"] == "SOLID"


def test_manual_sizes_and_offsets_override_the_measured_ones():
    asset = make_definition("crate", kind="prop", category="prop")
    version = published(asset)
    row = profile(asset, width=0.8, height=0.8, depth=0.6, offset_x=0.1, offset_y=0, offset_z=0)
    [box] = collision.runtime_collision(row, version)["boxes"]
    assert box == {"minX": -0.3, "minY": 0, "minZ": -0.3, "maxX": 0.5, "maxY": 0.8, "maxZ": 0.3}
    assert collision.runtime_collision(row, version)["behavior"] == "JUMPABLE"


def test_an_upright_cylinder_is_an_octagon_of_three_boxes():
    asset = make_definition("foliage-tree", kind="kit-piece", category="scenery")
    version = published(asset)
    row = profile(asset, shape=CollisionShape.CYLINDER, radius=0.25, offset_y=0)
    boxes = collision.runtime_collision(row, version)["boxes"]
    assert len(boxes) == 3
    assert span(boxes, "X") == 0.5 and span(boxes, "Z") == 0.5
    # A corner of the square is outside the octagon: the trunk is round, not square.
    corner = 0.25 * 0.95
    assert not any(
        b["minX"] <= corner <= b["maxX"] and b["minZ"] <= corner <= b["maxZ"] for b in boxes
    )
    flat = 0.25 * math.tan(math.pi / 8)
    assert any(b["maxZ"] == pytest.approx(flat, abs=1e-3) for b in boxes)


def test_a_lying_cylinder_is_one_box_along_its_axis():
    asset = make_definition("log-fallen", kind="kit-piece", category="scenery")
    version = published(asset, half_size=(0.2, 0.2, 1.1))
    row = profile(asset, shape=CollisionShape.CYLINDER, axis=CollisionAxis.Z, offset_y=0)
    [box] = collision.runtime_collision(row, version)["boxes"]
    assert box["maxZ"] - box["minZ"] == pytest.approx(2.2)
    assert box["maxX"] - box["minX"] == pytest.approx(0.4)
    assert box["maxY"] == pytest.approx(0.4)


def test_a_lying_capsule_has_rounded_ends():
    asset = make_definition("log-fallen", kind="kit-piece", category="scenery")
    version = published(asset, half_size=(0.2, 0.2, 1.1))
    row = profile(asset, shape=CollisionShape.CAPSULE, axis=CollisionAxis.Z, radius=0.2, offset_y=0)
    boxes = collision.runtime_collision(row, version)["boxes"]
    assert len(boxes) == 7  # a middle box and two octagon ends
    assert span(boxes, "Z") == pytest.approx(2.2)


def test_compound_boxes_describe_a_building():
    asset = make_definition("hut", kind="prop", category="prop")
    version = published(asset)
    walls = [
        {"x": 0, "z": -2, "y": 0, "width": 4, "height": 3, "depth": 0.2},
        {"x": -2, "z": 0, "y": 0, "width": 0.2, "height": 3, "depth": 4},
        {"x": 2, "z": 0, "y": 0, "width": 0.2, "height": 3, "depth": 4},
    ]
    row = profile(asset, shape=CollisionShape.COMPOUND, boxes=walls, behavior=CollisionBehavior.SOLID)
    result = collision.runtime_collision(row, version)
    assert len(result["boxes"]) == 3 and result["behavior"] == "SOLID"
    assert result["boxes"][0] == {
        "minX": -2.0, "minY": 0.0, "minZ": -2.1, "maxX": 2.0, "maxY": 3.0, "maxZ": -1.9
    }


@pytest.mark.parametrize(
    "fields",
    [
        {"shape": CollisionShape.NONE},
        {"behavior": CollisionBehavior.WALKABLE},
        {"behavior": CollisionBehavior.DECORATIVE},
    ],
)
def test_none_walkable_and_decorative_mean_deliberately_no_collider(fields):
    asset = make_definition("path", kind="kit-piece", category="scenery")
    version = published(asset)
    result = collision.runtime_collision(profile(asset, **fields), version)
    # An empty list (not None): the client must not put its own default back.
    assert result["boxes"] == []


def test_an_unsizeable_profile_keeps_the_client_defaults():
    asset = make_definition("crate", kind="prop", category="prop")  # nothing published
    assert collision.runtime_collision(profile(asset), None) is None


# --- precedence ----------------------------------------------------------------------------


def test_a_version_profile_overrides_the_asset_default():
    asset = make_definition("barrel", kind="kit-piece", category="prop")
    v1 = published(asset)
    v2 = published(asset, half_size=(0.4, 0.5, 0.4))
    default = profile(asset, behavior=CollisionBehavior.JUMPABLE)
    override = profile(asset, version=v2, shape=CollisionShape.NONE)
    assert collision.profile_for(asset, v1) == default
    assert collision.profile_for(asset, v2) == override
    assert collision.profile_for(asset, None) == default


def test_one_default_and_one_override_per_version_at_most():
    asset = make_definition("barrel", kind="kit-piece", category="prop")
    v1 = published(asset)
    profile(asset)
    with pytest.raises(IntegrityError), transaction.atomic():
        profile(asset)
    profile(asset, version=v1)
    with pytest.raises(IntegrityError), transaction.atomic():
        profile(asset, version=v1)
    rock = make_definition("rock", kind="kit-piece", category="scenery")
    with pytest.raises(IntegrityError), transaction.atomic():
        profile(rock, width=-1)


# --- validation ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"shape": CollisionShape.COMPOUND, "boxes": []}, "boxes"),
        ({"shape": CollisionShape.COMPOUND, "boxes": [{"x": 0, "width": 1}]}, "boxes"),
        ({"shape": CollisionShape.COMPOUND, "boxes": [{"x": 0, "width": 1, "height": 1, "depth": 1, "colour": 1}]}, "boxes"),
        ({"boxes": [{"x": 0, "width": 1, "height": 1, "depth": 1}]}, "boxes"),
        ({"radius": 0.3}, "radius"),
        ({"width": 500}, "width"),
    ],
)
def test_clean_refuses_unbuildable_profiles(fields, field):
    asset = make_definition("crate", kind="prop", category="prop")
    published(asset)
    asset.refresh_from_db()
    with pytest.raises(ValidationError) as error:
        collision.clean_profile(CollisionProfile(asset=asset, **fields))
    assert field in error.value.message_dict


def test_clean_refuses_another_assets_version_and_an_unmeasured_automatic_box():
    crate = make_definition("crate", kind="prop", category="prop")
    other = published(make_definition("rock", kind="kit-piece", category="scenery"))
    with pytest.raises(ValidationError) as error:
        collision.clean_profile(CollisionProfile(asset=crate, version=other))
    assert "version" in error.value.message_dict
    with pytest.raises(ValidationError) as error:
        collision.clean_profile(CollisionProfile(asset=crate))  # no version, no sizes
    assert "shape" in error.value.message_dict
    collision.clean_profile(CollisionProfile(asset=crate, width=1, height=1, depth=1))


# --- the resolver ----------------------------------------------------------------------------


def test_the_resolver_sends_the_profile_and_nothing_without_one(api, families, cognito):
    cache.clear()
    barrel = make_definition("barrel", kind="kit-piece", category="prop")
    published(barrel, half_size=(0.32, 0.45, 0.32))
    services.set_default_version(barrel.versions.get())
    profile(barrel, shape=CollisionShape.CYLINDER, offset_y=0)
    make_definition("rock", kind="kit-piece", category="scenery")  # no profile, nothing published
    rope = make_definition("rope-coil", kind="kit-piece", category="prop")
    profile(rope, behavior=CollisionBehavior.WALKABLE)

    response = api(families.a).get(
        f"/api/v1/children/{families.a1.pk}/assets/", {"ids": "barrel,rock,rope-coil"}
    )
    found = {entry["ref"]: entry for entry in response.json()["assets"]}
    assert found["barrel"]["status"] == "resolved"
    assert found["barrel"]["collision"]["behavior"] == "JUMPABLE"
    assert len(found["barrel"]["collision"]["boxes"]) == 3
    assert "collision" not in found["rock"]
    # An unpublished asset still tells a bundled scene not to block on it.
    assert found["rope-coil"]["status"] == "unavailable"
    assert found["rope-coil"]["collision"] == {"behavior": "WALKABLE", "shape": "BOX", "boxes": []}
    assert "notes" not in json.dumps(found)


# --- Django Admin ----------------------------------------------------------------------------


@pytest.fixture
def roles():
    call_command("ensure_asset_roles", verbosity=0)


def test_publishers_configure_profiles_and_editors_only_read_them(roles):
    asset = make_definition("crate", kind="prop", category="prop")
    published(asset)
    publisher = staff("pub", "Asset publishers")
    editor = staff("ed", "Asset editors")

    assert editor.get(PROFILES).status_code == 200
    assert editor.get(f"{PROFILES}add/").status_code == 403

    response = publisher.post(
        f"{PROFILES}add/",
        {
            "asset": asset.pk,
            "version": "",
            "shape": "BOX",
            "behavior": "JUMPABLE",
            "axis": "Y",
            "width": "0.8",
            "height": "0.8",
            "depth": "0.8",
            "offset_y": "0",
            "boxes": "[]",
            "notes": "",
        },
    )
    assert response.status_code == 302, response.content.decode()[:2000]
    row = CollisionProfile.objects.get()
    assert row.updated_by.admin_username == "pub" and row.behavior == "JUMPABLE"
    page = publisher.get(f"{PROFILES}{row.pk}/change/").content.decode()
    assert "Runtime collision" in page and "&quot;maxY&quot;: 0.8" in page


def test_the_admin_form_reports_an_unbuildable_compound(roles):
    asset = make_definition("hut", kind="prop", category="prop")
    published(asset)
    response = staff("pub", "Asset publishers").post(
        f"{PROFILES}add/",
        {"asset": asset.pk, "version": "", "shape": "COMPOUND", "behavior": "SOLID", "axis": "Y",
         "boxes": "[]", "notes": ""},
    )
    assert response.status_code == 200
    assert "A compound profile needs at least one box." in response.content.decode()
    assert not CollisionProfile.objects.exists()


def test_the_preview_page_carries_the_runtime_collision(roles):
    asset = make_definition("crate", kind="prop", category="prop")
    version = published(asset)
    profile(asset, width=0.8, height=0.8, depth=0.8, offset_y=0)
    page = staff("pub", "Asset publishers").get(
        f"/admin/assets/assetversion/{version.pk}/preview/"
    ).content.decode()
    assert 'data-asset-id="crate"' in page
    assert "data-collision=" in page and "JUMPABLE" in page
    assert 'data-preview-action="collision"' in page
