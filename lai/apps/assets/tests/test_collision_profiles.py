"""Asset Manager collision profiles (`apps/assets/collision.py`,
`docs/ASSET_COLLISION_PROFILES.md`)."""

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
    row = profile(
        asset, shape=CollisionShape.COMPOUND, boxes=walls, behavior=CollisionBehavior.SOLID
    )
    result = collision.runtime_collision(row, version)
    assert len(result["boxes"]) == 3 and result["behavior"] == "SOLID"
    assert result["boxes"][0] == {
        "minX": -2.0,
        "minY": 0.0,
        "minZ": -2.1,
        "maxX": 2.0,
        "maxY": 3.0,
        "maxZ": -1.9,
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
        (
            {
                "shape": CollisionShape.COMPOUND,
                "boxes": [{"x": 0, "width": 1, "height": 1, "depth": 1, "colour": 1}],
            },
            "boxes",
        ),
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


def resolve_one(api, families, asset_id):
    cache.clear()
    response = api(families.a).get(f"/api/v1/children/{families.a1.pk}/assets/", {"ids": asset_id})
    (entry,) = response.json()["assets"]
    return entry


def test_a_retired_asset_the_app_still_ships_keeps_its_collision(api, families, cognito):
    crate = make_definition(
        "crate", kind="kit-piece", category="prop", bundled_path="models/crate.glb"
    )
    published(crate, half_size=(0.5, 0.5, 0.5))
    version = crate.versions.get()
    services.set_default_version(version)
    profile(crate, behavior=CollisionBehavior.DECORATIVE)
    profile(crate, version=version, shape=CollisionShape.BOX, behavior=CollisionBehavior.SOLID)
    expected = collision.runtime_collision(collision.profile_for(crate, version), version)
    services.retire_asset(crate)

    entry = resolve_one(api, families, "crate")
    assert entry["status"] == "retired"
    # The default version's own profile wins over the asset default, as for a live asset.
    assert entry["collision"] == expected
    assert entry["collision"]["behavior"] == "SOLID"
    assert set(entry) == {"ref", "id", "status", "collision"}


def test_a_retired_shipped_asset_with_no_version_keeps_its_manual_collision(api, families, cognito):
    # The common case for shipped scenes: a bundled file and a profile, no uploaded version.
    rock = make_definition(
        "rock",
        kind="kit-piece",
        category="scenery",
        bundled_path="models/rock.glb",
    )
    profile(rock, shape=CollisionShape.BOX, width=1.2, height=0.9, depth=1.0, offset_y=0)
    before = resolve_one(api, families, "rock")
    assert before["status"] == "unavailable"
    services.retire_asset(rock)

    after = resolve_one(api, families, "rock")
    assert after["status"] == "retired"
    assert after["collision"] == before["collision"]
    assert span(after["collision"]["boxes"], "X") == 1.2


def test_a_retired_asset_that_is_not_shipped_has_no_collision(api, families, cognito):
    crate = make_definition("crate", kind="kit-piece", category="prop")
    published(crate)
    services.set_default_version(crate.versions.get())
    profile(crate, shape=CollisionShape.BOX)
    services.retire_asset(crate)

    entry = resolve_one(api, families, "crate")
    assert entry["status"] == "retired"
    assert "collision" not in entry


def test_a_retired_shipped_asset_that_is_not_a_model_has_no_collision(api, families, cognito):
    sound = make_definition("bell", kind="audio", category="sound", bundled_path="audio/bell.ogg")
    profile(sound, behavior=CollisionBehavior.WALKABLE)
    services.retire_asset(sound)

    entry = resolve_one(api, families, "bell")
    assert entry["status"] == "retired"
    assert "collision" not in entry


def test_a_retired_version_of_a_live_shipped_asset_keeps_no_collision(api, families, cognito):
    crate = make_definition(
        "crate", kind="kit-piece", category="prop", bundled_path="models/crate.glb"
    )
    first = published(crate)
    services.set_default_version(first)
    second = published(crate, half_size=(0.6, 1.0, 0.25))
    profile(crate, shape=CollisionShape.BOX)
    services.retire_version(first, replacement=second)

    entry = resolve_one(api, families, "crate@1")
    assert entry["status"] == "retired"
    assert "collision" not in entry
    assert resolve_one(api, families, "crate")["collision"]["shape"] == "BOX"


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
        {
            "asset": asset.pk,
            "version": "",
            "shape": "COMPOUND",
            "behavior": "SOLID",
            "axis": "Y",
            "boxes": "[]",
            "notes": "",
        },
    )
    assert response.status_code == 200
    assert "A compound profile needs at least one box." in response.content.decode()
    assert not CollisionProfile.objects.exists()


def test_the_preview_page_carries_the_runtime_collision(roles):
    asset = make_definition("crate", kind="prop", category="prop")
    version = published(asset)
    profile(asset, width=0.8, height=0.8, depth=0.8, offset_y=0)
    page = (
        staff("pub", "Asset publishers")
        .get(f"/admin/assets/assetversion/{version.pk}/preview/")
        .content.decode()
    )
    assert 'data-asset-id="crate"' in page
    assert "data-collision=" in page and "JUMPABLE" in page
    assert 'data-preview-action="collision"' in page


# --- raised Solid parts (GE-L16) -----------------------------------------------------------


GATEWAY = [
    {"x": -1.4, "z": 0, "y": 0, "width": 1.2, "height": 3, "depth": 0.4},  # post
    {"x": 1.4, "z": 0, "y": 0, "width": 1.2, "height": 3, "depth": 0.4},  # post
    {"x": 0, "z": 0, "y": 2.2, "width": 4, "height": 0.6, "depth": 0.4},  # lintel
    {"x": 4, "z": 0, "y": 0.05, "width": 2, "height": 0.85, "depth": 0.4},  # rail, a cm up
    {"x": 0, "z": 3, "y": 1.7, "width": 1, "height": 0.2, "depth": 1},  # exactly 1.7 m
]


def test_raised_solid_parts_are_classified_by_walk_under_clearance():
    asset = make_definition("gateway", kind="prop", category="prop")
    version = published(asset)
    row = profile(
        asset, shape=CollisionShape.COMPOUND, boxes=GATEWAY, behavior=CollisionBehavior.SOLID
    )
    parts = collision.solid_clearance(collision.runtime_collision(row, version))
    # Ground-level posts are ordinary walls: not listed.
    assert [(p["index"], p["minY"], p["passage"]) for p in parts] == [
        (2, 2.2, True),
        (3, 0.05, False),
        (4, 1.7, True),
    ]
    assert collision.WALK_UNDER_CLEARANCE == 1.7


def test_only_solid_answers_have_raised_solid_parts():
    asset = make_definition("deck", kind="prop", category="prop")
    version = published(asset)
    deck = [{"x": 0, "z": 0, "y": 2, "width": 2, "height": 0.2, "depth": 2}]
    row = profile(
        asset, shape=CollisionShape.COMPOUND, boxes=deck, behavior=CollisionBehavior.JUMPABLE
    )
    assert collision.solid_clearance(collision.runtime_collision(row, version)) == []
    assert collision.solid_clearance(None) == []


def test_automatic_taller_than_the_jump_is_solid_and_gets_the_same_evaluation():
    asset = make_definition("sign", kind="prop", category="prop")
    version = published(asset)
    sign = [
        {"x": 0, "z": 0, "y": 0, "width": 0.2, "height": 1.0, "depth": 0.2},  # post
        {"x": 0, "z": 0, "y": 1.0, "width": 1.5, "height": 0.8, "depth": 0.1},  # board
    ]
    row = profile(asset, shape=CollisionShape.COMPOUND, boxes=sign)  # AUTO by default
    runtime = collision.runtime_collision(row, version)
    assert runtime["behavior"] == "SOLID"  # 1.8 m in all: above the 1.2 m jump
    assert collision.solid_clearance(runtime) == [
        {"index": 1, "minY": 1.0, "maxY": 1.8, "passage": False}
    ]


def test_the_clearance_audit_command_lists_raised_solid_parts_read_only():
    gateway = make_definition("gateway", kind="prop", category="prop")
    published(gateway)
    profile(gateway, shape=CollisionShape.COMPOUND, boxes=GATEWAY, behavior=CollisionBehavior.SOLID)
    crate = make_definition("crate", kind="prop", category="prop")
    published(crate)
    profile(crate, behavior=CollisionBehavior.SOLID)  # standing on its pivot: not listed
    before = list(CollisionProfile.objects.values_list("pk", "updated_at"))

    out = io.StringIO()
    call_command("collision_clearance_audit", stdout=out)
    text = out.getvalue()

    assert "walk-under clearance 1.7 m, model space): 1 profile(s)" in text
    assert "gateway (default, COMPOUND)" in text
    assert "box 3: 2.2 to 2.8 m, walk-under passage" in text
    assert "box 4: 0.05 to 0.9 m, blocks at every height" in text
    assert "crate" not in text
    assert list(CollisionProfile.objects.values_list("pk", "updated_at")) == before


def test_the_admin_explains_each_raised_solid_part(roles):
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset)
    row = profile(
        asset, shape=CollisionShape.COMPOUND, boxes=GATEWAY, behavior=CollisionBehavior.SOLID
    )
    page = staff("pub", "Asset publishers").get(f"{PROFILES}{row.pk}/change/").content.decode()
    assert "Raised Solid parts (walk-under clearance 1.7 m" in page
    assert "Box 3: bottom 2.2 m, walk-under passage (blocks from its underside up)" in page
    assert "Box 4: bottom 0.05 m, blocks at every height, down to the ground" in page


def test_the_admin_help_text_states_the_raised_solid_rule():
    solid = dict(CollisionBehavior.choices)[CollisionBehavior.SOLID]
    assert "a part raised 1.7 m or more leaves a walk-under passage" in solid
    assert "taller is Solid" in dict(CollisionBehavior.choices)[CollisionBehavior.AUTO]
    offset_y = CollisionProfile._meta.get_field("offset_y").help_text
    assert "1.7 m" in offset_y and "never makes it jumpable" in offset_y
    assert "Jumpable profile for a surface to stand on" in (
        CollisionProfile._meta.get_field("boxes").help_text
    )


# --- passage pieces: archways (GE-247; raised-solid-clearance.md s. 5) ----------------------


def test_the_profile_form_explains_walk_under_jumping_and_openings(roles):
    page = staff("pub", "Asset publishers").get(f"{PROFILES}add/").content.decode()
    assert "collision body is 1.7 m tall and about 0.74 m wide" in page
    assert "and jumps 1.2 m by default." in page
    assert "A Solid part 1.7 m or more above the ground is something to walk under" in page
    assert "Only Jumpable parts can be jumped onto" in page
    assert "use one box per side and, if wanted, one box over the opening at 1.7 m" in page
    assert "a single box over the whole model closes the opening" in page
    assert "The engine always keeps an archway" in page


def test_the_help_numbers_come_from_the_engine_mirrors():
    from apps.assets import admin as assets_admin

    assert f"collision body is {collision.WALK_UNDER_CLEARANCE:g} m tall" in (
        assets_admin.PROFILE_HELP
    )
    assert f"jumps {collision.JUMPABLE_MAX_HEIGHT:g} m by default" in assets_admin.PROFILE_HELP


def test_an_archway_profile_says_the_engine_carves_its_opening(roles):
    asset = make_definition("archway", kind="kit-piece", category="prop")
    published(asset, half_size=(1.6, 1.6, 0.3))
    row = profile(asset, shape=CollisionShape.BOX, behavior=CollisionBehavior.SOLID)
    page = staff("pub", "Asset publishers").get(f"{PROFILES}{row.pk}/change/").content.decode()
    assert "carves this piece&#x27;s opening (2 m wide and 2.6 m high, model space)" in page
    assert "lower than 1.7 m, the piece is a wall" in page


def test_other_pieces_with_an_opening_get_no_carving_note(roles):
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset)
    row = profile(
        asset, shape=CollisionShape.COMPOUND, boxes=GATEWAY, behavior=CollisionBehavior.SOLID
    )
    page = staff("pub", "Asset publishers").get(f"{PROFILES}{row.pk}/change/").content.decode()
    assert "carves this piece" not in page
    assert collision.PASSAGE_OPENINGS == {"archway": "2 m wide and 2.6 m high"}


TALL = (1.0, 2.0, 0.3)  # test models are centred on the pivot: 2 m above the ground


def solid_box(asset, **fields):
    return profile(asset, shape=CollisionShape.BOX, behavior=CollisionBehavior.SOLID, **fields)


def check(row):
    row.asset.refresh_from_db()  # publishing set the default version after the row was made
    version = row.asset.default_version
    result = collision.runtime_collision(row, version)
    return collision.opening_check(row.asset.asset_id, result, collision.version_bounds(version))


def test_one_solid_box_over_a_tall_model_may_seal_an_opening():
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=TALL)
    assert check(solid_box(asset)) == "sealed"


def test_automatic_over_a_tall_model_is_solid_and_warned_too():
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=TALL)
    row = profile(asset, shape=CollisionShape.BOX, behavior=CollisionBehavior.AUTO)
    assert check(row) == "sealed"


@pytest.mark.parametrize(
    ("half_size", "fields"),
    [
        (TALL, {"behavior": CollisionBehavior.JUMPABLE}),  # not Solid
        ((1.0, 0.6, 0.3), {}),  # 1.2 m tall: nothing to walk through
        (TALL, {"width": 0.5, "offset_x": -0.75}),  # one jamb, not the whole model
    ],
)
def test_no_warning_where_nothing_can_be_sealed(half_size, fields):
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=half_size)
    fields = {"behavior": CollisionBehavior.SOLID, **fields}
    assert check(profile(asset, shape=CollisionShape.BOX, **fields)) is None


def test_a_jamb_compound_is_not_warned():
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=TALL)
    row = profile(asset, shape=CollisionShape.COMPOUND, boxes=GATEWAY, behavior="SOLID")
    assert check(row) is None


def test_an_archway_is_never_warned_because_the_engine_carves_it():
    asset = make_definition("archway", kind="kit-piece", category="prop")
    published(asset, half_size=(1.6, 1.6, 0.3))
    assert check(solid_box(asset)) == "carved"


def test_saving_a_sealing_profile_warns_and_still_saves(roles):
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=TALL)
    response = staff("pub", "Asset publishers").post(
        f"{PROFILES}add/",
        {
            "asset": asset.pk,
            "version": "",
            "shape": "BOX",
            "behavior": "SOLID",
            "axis": "Y",
            "boxes": "[]",
            "notes": "",
        },
        follow=True,
    )
    page = response.content.decode()
    assert response.status_code == 200 and CollisionProfile.objects.count() == 1
    assert "One Solid box covers this whole model." in page
    assert "Saved: this is a warning, not a refusal." in page


def test_the_change_page_keeps_showing_the_warning(roles):
    asset = make_definition("gateway", kind="prop", category="prop")
    published(asset, half_size=TALL)
    row = solid_box(asset)
    page = staff("pub", "Asset publishers").get(f"{PROFILES}{row.pk}/change/").content.decode()
    assert "Warning: One Solid box covers this whole model." in page


def test_saving_an_archway_box_explains_the_carving_instead(roles):
    asset = make_definition("archway", kind="kit-piece", category="prop")
    published(asset, half_size=(1.6, 1.6, 0.3))
    response = staff("pub", "Asset publishers").post(
        f"{PROFILES}add/",
        {
            "asset": asset.pk,
            "version": "",
            "shape": "BOX",
            "behavior": "SOLID",
            "axis": "Y",
            "boxes": "[]",
            "notes": "",
        },
        follow=True,
    )
    page = response.content.decode()
    assert CollisionProfile.objects.count() == 1
    assert "carves this piece&#x27;s opening" in page
    assert "One Solid box covers this whole model." not in page


# --- W3a: model assets only, and only the chosen asset's versions ------------------------------


@pytest.mark.parametrize(
    ("kind", "category"), [("image", "image"), ("texture", "texture"), ("audio", "sound")]
)
def test_clean_refuses_a_profile_on_an_asset_that_is_not_a_3d_model(kind, category):
    asset = make_definition("splash", kind=kind, category=category)
    with pytest.raises(ValidationError) as error:
        collision.clean_profile(CollisionProfile(asset=asset, width=1, height=1, depth=1))
    assert "3D models only" in error.value.message_dict["asset"][0]


def test_the_form_offers_only_the_chosen_assets_model_versions():
    from apps.assets.admin import CollisionProfileForm

    crate = make_definition("crate", kind="prop", category="prop")
    crate_v1 = published(crate)
    rock_v1 = published(make_definition("rock", kind="kit-piece", category="scenery"))

    unbound = CollisionProfileForm()
    assert set(unbound.fields["version"].queryset) == {crate_v1, rock_v1}

    bound = CollisionProfileForm(data={"asset": crate.pk})
    assert list(bound.fields["version"].queryset) == [crate_v1]

    row = profile(crate, width=1, height=1, depth=1)
    assert list(CollisionProfileForm(instance=row).fields["version"].queryset) == [crate_v1]

    garbage = CollisionProfileForm(data={"asset": "not-a-key"})
    assert set(garbage.fields["version"].queryset) == {crate_v1, rock_v1}


def test_the_admin_refuses_another_assets_version_and_a_non_model_asset(roles):
    crate = make_definition("crate", kind="prop", category="prop")
    published(crate)
    rock_v1 = published(make_definition("rock", kind="kit-piece", category="scenery"))
    splash = make_definition("splash", kind="image", category="image")
    publisher = staff("pub", "Asset publishers")
    form = {
        "version": "",
        "shape": "BOX",
        "behavior": "SOLID",
        "axis": "Y",
        "width": "1",
        "height": "1",
        "depth": "1",
        "offset_y": "0",
        "boxes": "[]",
        "notes": "",
    }

    wrong_version = publisher.post(
        f"{PROFILES}add/", {**form, "asset": crate.pk, "version": rock_v1.pk}
    )
    assert wrong_version.status_code == 200
    assert "Select a valid choice" in wrong_version.content.decode()

    not_a_model = publisher.post(f"{PROFILES}add/", {**form, "asset": splash.pk})
    assert not_a_model.status_code == 200
    assert "Collision profiles are for 3D models only." in not_a_model.content.decode()
    assert not CollisionProfile.objects.exists()
