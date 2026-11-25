"""3D Area usages of library assets (LAI-07 W2-3; ASSET_LIBRARY.md s. 25.3).

Owner decision 2026-11-22 (#246), engine advice Agent 4: a PUBLISHED 3D Area that names an asset (a
placement, a chest, or its scene JSON) blocks retiring that asset; DRAFT and RETIRED areas are
reported only; version retirement is unchanged.
"""

import pytest

from apps.assets import dependencies as registry
from apps.assets import services
from apps.assets.dependencies import Usage, register_usage_provider, usages_for
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.importer import import_content
from apps.catalog.models import AssetStatus, ContentRelease, Location, World
from apps.core.content_status import ContentStatus
from apps.regions import dependencies
from apps.regions.dependencies import REFUSAL_CODE, scene_asset_ids
from apps.regions.models import PlacementKind, TreasureChest, WorldObjectPlacement, WorldRegion

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def _place(slug):
    release = ContentRelease.objects.first() or ContentRelease.objects.create(
        content_digest="0" * 64, schema_version=1, export_tool="tests", files=[], report={}
    )
    world, _ = World.objects.get_or_create(
        slug="dep-island",
        defaults={
            "title": "Dep Island",
            "supported_age_bands": ["SPROUT", "PATHFINDER", "EXPLORER"],
            "pack_version": 1,
            "source": {},
            "last_seen_release": release,
        },
    )
    return Location.objects.create(
        slug=slug, world=world, title=slug.title(), source={}, last_seen_release=release
    )


def area(region_id, status=ContentStatus.PUBLISHED, scene=None):
    return WorldRegion.objects.create(
        region_id=region_id,
        location=_place(f"{region_id}-place"),
        title=region_id.title(),
        status=status,
        scene=scene or {},
    )


def place(region, entity_id, asset_id, kind=PlacementKind.PROP):
    return WorldObjectPlacement.objects.create(
        region=region, entity_id=entity_id, kind=kind, asset_id=asset_id, x=0, z=0
    )


def chest(region, entity_id, asset_id):
    return TreasureChest.objects.create(
        region=region, entity_id=entity_id, asset_id=asset_id, x=1, z=1
    )


def crate(asset_id="crate"):
    asset = make_definition(asset_id, kind="prop", category="prop")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    v2 = make_version(asset, 2, status=VersionStatus.PUBLISHED)
    asset.default_version = v1
    asset.save()
    return asset, v1, v2


def test_the_provider_is_registered():
    assert "regions" in registry.registered_sources()


# --- the scene walk ---------------------------------------------------------------------------


def test_the_scene_walk_finds_ids_at_any_depth_and_ignores_non_ids():
    scene = {
        "groundAssetId": "sand",
        "effects": {"backdrop": {"assetId": "volcano"}},
        "layout": {"props": [{"assetId": "barrel"}, {"assetId": ""}, {"assetId": 7}]},
        "engineBridge": [{"config": {"platforms": [{"id": "p1", "assetId": "barrel"}]}}],
        "assetIdNote": "not an asset key",
    }
    assert scene_asset_ids(scene) == {
        "sand": ["groundAssetId"],
        "volcano": ["effects.backdrop.assetId"],
        "barrel": ["layout.props[0].assetId", "engineBridge[0].config.platforms[0].assetId"],
    }
    assert scene_asset_ids(None) == {} and scene_asset_ids([]) == {}


def test_the_scene_walk_matches_every_asset_id_key_and_list():
    scene = {
        "buildings": [{"wallAssetId": "wall", "roofAssetId": "roof", "doorAssetId": "door"}],
        "extension": {"assetIds": ["tide", "", 3], "declaredAssetIds": ["gear"]},
        "assetIdea": "not an id key",
    }
    assert scene_asset_ids(scene) == {
        "wall": ["buildings[0].wallAssetId"],
        "roof": ["buildings[0].roofAssetId"],
        "door": ["buildings[0].doorAssetId"],
        "tide": ["extension.assetIds[0]"],
        "gear": ["extension.declaredAssetIds[0]"],
    }


def test_the_scene_walk_covers_every_key_the_seeds_write():
    """Agent 4: backdrop, ground, layout props/vegetation/procedural/scenery, jump platforms."""
    from apps.regions.firepeak_seed import REGION_ID as FIREPEAK
    from apps.regions.firepeak_seed import seed_firepeak
    from apps.regions.treasure_rush_seed import REGION_ID as COVE
    from apps.regions.treasure_rush_seed import seed_treasure_rush

    import_content()
    seed_treasure_rush()
    seed_firepeak()
    cove = scene_asset_ids(WorldRegion.objects.get(region_id=COVE).scene)
    paths = [path for found in cove.values() for path in found]
    for prefix in ("layout.props[", "layout.vegetation[", "layout.scenery[", "engineBridge"):
        assert any(path.startswith(prefix) for path in paths), prefix
    assert "barrel" in cove  # a Pirate's Leap platform model (engineBridge gameplay.platforms)
    firepeak = scene_asset_ids(WorldRegion.objects.get(region_id=FIREPEAK).scene)
    assert "firepeak-volcano-main" in firepeak


# --- blocking -----------------------------------------------------------------------------


def test_a_published_placement_blocks_retiring_the_asset():
    asset, _, _ = crate()
    place(area("cove"), "crate-1", "crate")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == REFUSAL_CODE
    assert "3D Area cove (published), placement crate-1" in refused.value.message
    assert "bundled model or a placeholder" in refused.value.message
    assert refused.value.details == {
        "regions": ["cove"],
        "placements": [{"region": "cove", "placement": "crate-1"}],
    }
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE


def test_a_published_chest_and_a_scene_id_block_and_every_one_is_named():
    asset, _, _ = crate("chest-model")
    chest(area("cove"), "gold", "chest-model")
    area("peak", scene={"layout": {"scenery": [{"id": "s1", "assetId": "chest-model"}]}})
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == REFUSAL_CODE
    assert "3D Area cove (published), chest gold" in refused.value.message
    assert "3D Area peak (published), scene layout.scenery[0].assetId" in refused.value.message
    assert refused.value.details["regions"] == ["cove", "peak"]


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_draft_and_retired_areas_are_reported_but_never_block(status):
    asset, _, _ = crate()
    region = area("cove", status=status)
    place(region, "crate-1", "crate")
    found = usages_for(asset)
    assert [(u.source, u.blocks_retirement) for u in found if u.source == "regions"] == [
        ("regions", False)
    ]
    services.retire_asset(asset)
    asset.refresh_from_db()
    assert asset.status == AssetStatus.RETIRED


def test_missing_and_other_references_never_match():
    asset, _, _ = crate()
    region = area("cove")
    place(region, "empty", "")  # a placeholder on purpose
    place(region, "other", "barrel")  # another asset
    place(region, "ghost", "no-such-asset")  # an id the library does not hold
    assert [u for u in usages_for(asset) if u.source == "regions"] == []
    services.retire_asset(asset)


def test_an_npc_placement_is_matched_only_by_its_asset_id():
    asset, _, _ = crate()
    place(area("cove"), "npc-spot", "", kind=PlacementKind.NPC)  # drawn via its NPC definition
    assert [u for u in usages_for(asset) if u.source == "regions"] == []


# --- versions -----------------------------------------------------------------------------


def test_retiring_a_version_is_unchanged_by_published_placements():
    asset, v1, v2 = crate()
    place(area("cove"), "crate-1", "crate")
    services.retire_version(v2)  # not the default: placements never see it
    v2.refresh_from_db()
    assert v2.status == VersionStatus.RETIRED
    assert [u for u in usages_for(asset, v2) if u.source == "regions"] == []


def test_the_default_version_retires_with_a_replacement_and_placements_follow_it():
    asset, v1, v2 = crate()
    place(area("cove"), "crate-1", "crate")
    listed = [u for u in usages_for(asset, v1) if u.source == "regions"]
    assert [(u.label, u.blocks_retirement) for u in listed] == [
        ("3D Area cove (published), placement crate-1", False)
    ]
    services.retire_version(v1, replacement=v2)
    asset.refresh_from_db()
    v1.refresh_from_db()
    assert v1.status == VersionStatus.RETIRED and asset.default_version_id == v2.pk


# --- with other sources, and failures ------------------------------------------------------


def test_regions_and_another_blocking_source_are_named_in_one_refusal(monkeypatch):
    monkeypatch.setattr(registry, "_PROVIDERS", dict(registry._PROVIDERS))
    register_usage_provider(
        "stand-in",
        lambda asset, version: [Usage("stand-in", "stand_in", "Stand-in use", True)],
    )
    asset, _, _ = crate()
    place(area("cove"), "crate-1", "crate")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "asset_in_use"
    assert "3D Area cove (published), placement crate-1" in refused.value.message
    assert "Stand-in use" in refused.value.message
    assert set(refused.value.details["blockers"]) == {"regions", "stand-in"}


def test_a_regions_failure_refuses_retirement(monkeypatch):
    def broken(asset):
        raise RuntimeError("database went away")

    monkeypatch.setattr(dependencies, "_rows", broken)
    asset, _, _ = crate()
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "regions"}
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE
