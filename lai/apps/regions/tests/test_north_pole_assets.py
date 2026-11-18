"""North Pole asset definitions (NP-021, NP-050): the list is valid against the real vocabularies
and every entry makes a valid Django-origin `ContentAsset`."""

import re

import pytest

from apps.assets.models import CollisionBehavior, CollisionShape
from apps.assets.validation import CLIP_VOCABULARY
from apps.catalog.models import ASSET_KINDS, KIND_CATEGORIES, AssetOrigin, ContentAsset
from apps.npcs.vocabulary import ANIMATION_STATES
from apps.regions.north_pole_assets import (
    ASSETS,
    ASSETS_BY_ID,
    NPC_MODEL_ASSETS,
    PLACEHOLDER_STATUS,
    REGION_TAG,
    STAND_IN_SHAPES,
    content_asset_defaults,
)

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
MODEL_KINDS = {"character", "prop", "collectible", "kit-piece"}
REQUIRED = [
    "north-pole-santa", "north-pole-mrs-claus", "north-pole-elf-jingle", "north-pole-elf-tinker",
    "north-pole-elf-peppermint", "north-pole-elf-frosty", "north-pole-elf-noel",
    "north-pole-elf-ginger", "north-pole-elf-polaris", "north-pole-reindeer",
    "north-pole-reindeer-calf", "north-pole-snowman", "north-pole-christmas-tree",
    "north-pole-snowy-pine", "north-pole-candy-cane", "north-pole-gingerbread-house",
    "north-pole-workshop", "north-pole-workshop-machine", "north-pole-toy-train",
    "north-pole-toy-blocks", "north-pole-present", "north-pole-sleigh", "north-pole-ice-platform",
    "north-pole-snow-platform", "north-pole-cookie-platform", "north-pole-peppermint-platform",
    "north-pole-bridge", "north-pole-lantern", "north-pole-ornament", "north-pole-star-fragment",
    "north-pole-christmas-star", "north-pole-observatory", "north-pole-telescope",
    "north-pole-snowflake", "north-pole-golden-bell", "north-pole-cottage", "north-pole-stable",
    "north-pole-signpost", "north-pole-snowbank", "north-pole-ice-formation",
    "north-pole-christmas-lights", "ground-tile-snow",
]  # fmt: skip


def test_ids_are_unique_slugs_and_cover_the_required_list():
    ids = [asset.asset_id for asset in ASSETS]
    assert len(ids) == len(set(ids))
    for asset_id in ids:
        assert SLUG.match(asset_id) and len(asset_id) <= 100, asset_id
    assert set(REQUIRED) <= set(ids)
    assert any(asset.kind == "texture" for asset in ASSETS)
    assert all(asset.kind != "audio" for asset in ASSETS)  # the audio inventory is separate


def test_kind_and_category_pairs_are_allowed():
    for asset in ASSETS:
        assert asset.kind in ASSET_KINDS, asset.asset_id
        assert asset.category in KIND_CATEGORIES[asset.kind], asset.asset_id


def test_dimensions_are_positive_for_models_and_absent_for_images():
    for asset in ASSETS:
        if asset.kind in MODEL_KINDS:
            width, height, depth = asset.dimensions_m
            assert width > 0 and depth > 0 and height >= 0, asset.asset_id
            assert height > 0 or asset.asset_id == "ground-tile-snow"
            assert asset.triangle_budget and asset.triangle_budget > 0
            assert "glTF 2.0 binary" in asset.model_format
        else:
            assert asset.dimensions_m is None and asset.triangle_budget is None


def test_characters_have_idle_walk_talk_from_the_closed_states():
    characters = [asset for asset in ASSETS if asset.kind == "character"]
    assert len(characters) == 11
    for asset in characters:
        assert set(asset.animations) <= set(ANIMATION_STATES), asset.asset_id
        assert {"idle", "walk", "talk"} <= set(asset.animations), asset.asset_id
        # Each state the asset wants has a clip name the validator recognises.
        assert all(state.capitalize() in CLIP_VOCABULARY for state in asset.animations)


def test_prop_clips_come_from_the_clip_vocabulary():
    for asset in ASSETS:
        if asset.kind != "character":
            assert set(asset.animations) <= CLIP_VOCABULARY, asset.asset_id


def test_stand_in_shapes_are_in_the_allowed_list():
    for asset in ASSETS:
        if asset.stand_in_shape is None:
            assert asset.kind == "texture" or asset.asset_id == "ground-tile-snow"
        else:
            assert asset.stand_in_shape in STAND_IN_SHAPES, asset.asset_id
    assert ASSETS_BY_ID["north-pole-snowman"].stand_in_shape == "SNOWMAN"
    assert ASSETS_BY_ID["north-pole-sleigh"].stand_in_shape == "SLEIGH"


def test_collision_uses_the_profile_vocabulary():
    for asset in ASSETS:
        if asset.kind not in MODEL_KINDS:
            assert asset.collision is None
            continue
        collision = asset.collision
        assert collision.shape in CollisionShape.values, asset.asset_id
        assert collision.behavior in CollisionBehavior.values, asset.asset_id
        if collision.radius is not None:
            assert collision.radius > 0 and collision.shape in {"CYLINDER", "CAPSULE"}
        if asset.kind == "collectible":
            assert (collision.shape, collision.behavior) == ("NONE", "DECORATIVE")
    # The follower must never trap the child; required bridges are kept clear.
    assert ASSETS_BY_ID["north-pole-reindeer-calf"].collision.shape == "NONE"
    assert ASSETS_BY_ID["north-pole-bridge"].collision.behavior == "WALKABLE"


def test_placeholder_status_and_npc_mapping():
    assert {asset.placeholder_status for asset in ASSETS} == {PLACEHOLDER_STATUS}
    for asset_id in NPC_MODEL_ASSETS.values():
        assert ASSETS_BY_ID[asset_id].kind == "character"


def test_content_asset_defaults_shape():
    defaults = content_asset_defaults(ASSETS_BY_ID["north-pole-elf-jingle"])
    assert defaults["origin"] == AssetOrigin.DJANGO
    assert defaults["kind"] == "character" and defaults["category"] == "npc"
    assert defaults["tags"][0] == REGION_TAG and "elf" in defaults["tags"]
    assert "clips" not in defaults and "bundled_path" not in defaults


@pytest.mark.postgres
@pytest.mark.django_db
def test_every_asset_makes_a_valid_content_asset():
    for asset in ASSETS:
        ContentAsset(**content_asset_defaults(asset)).full_clean()
    for asset in ASSETS:
        ContentAsset.objects.create(**content_asset_defaults(asset))
    assert ContentAsset.objects.filter(tags__contains=[REGION_TAG]).count() == len(ASSETS)
    assert not ContentAsset.objects.filter(tags__contains=[REGION_TAG]).exclude(
        default_version=None
    ).exists()
