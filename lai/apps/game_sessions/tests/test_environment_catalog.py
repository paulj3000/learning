"""The play API's catalog lists the cove's library palms, barrels and logs (TR-PALM-05, TR-ENV-06).

The client draws a palm or a prop from its model only when this catalog says the model can be
delivered now; otherwise it keeps the primitive palm and the bundled barrels and logs.
"""

import pytest

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.importer import import_content
from apps.catalog.models import ContentAsset
from apps.game_sessions.play_state import region_catalog
from apps.regions import north_pole_seed, treasure_rush_seed
from apps.regions.dependencies import scene_asset_ids
from apps.regions.models import WorldRegion
from apps.regions.north_pole_seed import REGION_ID as NORTH_POLE
from apps.regions.north_pole_seed import seed_north_pole
from apps.regions.treasure_rush_seed import REGION_ID, seed_treasure_rush

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_the_catalog_names_the_library_models_and_whether_each_can_be_delivered():
    import_content()
    seed_treasure_rush()
    published = make_definition("prop-wooden-barrel", kind="prop", category="prop")
    version = make_version(published, status=VersionStatus.PUBLISHED, clips=[])
    published.default_version = version
    published.save(update_fields=["default_version"])
    make_definition("nature-palm-tree-tall", kind="kit-piece", category="scenery")  # unpublished
    make_definition("nature-grass-tall", kind="kit-piece", category="scenery")  # ENV-2

    catalog = region_catalog(WorldRegion.objects.get(region_id=REGION_ID))
    by_id = {asset["assetId"]: asset for asset in catalog["assets"]}
    assert by_id["prop-wooden-barrel"]["deliverable"] is True
    assert by_id["nature-palm-tree-tall"]["deliverable"] is False
    assert by_id["nature-grass-tall"]["deliverable"] is False  # vegetation is listed too
    # Ids with no definition at all are simply absent: the client then keeps its stand-ins.
    assert "nature-wood-log-moss" not in by_id


def test_a_region_without_a_layout_still_has_a_catalog():
    import_content()
    seed_treasure_rush()
    region = WorldRegion.objects.get(region_id=REGION_ID)
    region.scene = {"layout": {"procedural": [{"assetId": 7}], "props": "nonsense"}}
    catalog = region_catalog(region)
    assert isinstance(catalog["assets"], list)


# --- every scene id, by the dependency registry's rule (MVP realm asset support, #98) --------


def test_a_scenery_only_id_is_listed_so_the_client_can_validate_the_area():
    """North Pole's pines, lanterns and candy canes appear only in `layout.scenery`. The client
    validates every scenery id against its bundled manifest plus this catalog, so leaving them
    out refused the whole Area with UNKNOWN_ASSET."""
    import_content()
    seed_north_pole()
    region = WorldRegion.objects.get(region_id=NORTH_POLE)
    scenery = {
        item["assetId"]
        for item in region.scene["layout"]["scenery"]
        if isinstance(item, dict) and item.get("assetId")
    }
    assert {"north-pole-snowy-pine", "north-pole-lantern", "north-pole-candy-cane"} <= scenery
    listed = {asset["assetId"] for asset in region_catalog(region)["assets"]}
    assert scenery <= listed


@pytest.mark.parametrize("seed", ["treasure_rush", "north_pole"])
def test_the_catalog_lists_every_scene_id_the_dependency_registry_sees(seed):
    """One rule for both: whatever retirement would protect in a scene, the client is told about
    (when a definition exists)."""
    module = {"treasure_rush": treasure_rush_seed, "north_pole": north_pole_seed}[seed]
    import_content()
    getattr(module, f"seed_{seed}")()
    region = WorldRegion.objects.get(region_id=module.REGION_ID)
    named = set(scene_asset_ids(region.scene))
    defined = set(
        ContentAsset.objects.filter(asset_id__in=named).values_list("asset_id", flat=True)
    )
    listed = {asset["assetId"] for asset in region_catalog(region)["assets"]}
    assert defined <= listed


def test_scenery_platform_and_building_ids_are_listed_and_unknown_ids_are_not():
    import_content()
    seed_treasure_rush()
    region = WorldRegion.objects.get(region_id=REGION_ID)
    for asset_id in ("np-test-pine", "np-test-step", "np-test-wall", "np-test-flag"):
        make_definition(asset_id, kind="prop", category="prop")
    region.scene = {
        "layout": {"scenery": [{"kind": "CLUSTER", "assetId": "np-test-pine"}]},
        "platforming": {"platforms": [{"assetId": "np-test-step"}]},
        "buildings": [{"wallAssetId": "np-test-wall"}],
        "extensions": {"flags": {"assetIds": ["np-test-flag", ""]}},
        "groundAssetId": "no-such-asset",
    }
    listed = {asset["assetId"] for asset in region_catalog(region)["assets"]}
    assert {"np-test-pine", "np-test-step", "np-test-wall", "np-test-flag"} <= listed
    assert "no-such-asset" not in listed  # no definition: the client keeps its stand-in
