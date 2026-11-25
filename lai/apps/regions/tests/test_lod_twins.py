"""Low-detail twins and retirement (LAI-07 W2; ASSET_LIBRARY.md s. 25.3; agreed with LAI 04).

Owner decision 2026-11-25: a low-detail asset that a PUBLISHED region actually needs blocks
retiring it. LAI 04 (Game Engine Core) confirmed on main 8f3a7b3c that no published region needs
one today:

- the engine pairs a model with its twin only through the bundled manifest's `lod`
  (`instantiateWithLod` -> `getAssetManifestEntry`); the resolver sends no lod, and
  `ContentAsset.low_detail` is only the importer's copy of it;
- only `LOD_PLACEMENTS` scene items draw the twin, and a Django region's layout refuses that kind
  (`region-play/regionLayout.ts`); MODEL, CLUSTER, SCATTER, placements and chests never draw it.

So the regions provider follows no twin, and twins are listed only, by the catalog provider (the
shipped scenes). These tests pin that, so a future blocker is a deliberate change: whoever lets a
region hold `LOD_PLACEMENTS` adds the blocking twin rule in the same change.
"""

import pytest

from apps.assets import resolver, services
from apps.assets.dependencies import usages_for
from apps.catalog.importer import DEFAULT_EXPORT_DIR, import_content
from apps.catalog.models import AssetStatus, ContentAsset
from apps.regions.tests.test_dependencies import area

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BASE, TWIN = "foliage-tree", "foliage-tree-lod1"

#: The scene item kinds a Django region can hold that name a model (regionLayout.ts).
SCENE = {
    "layout": {
        "scenery": [
            {"id": "grove", "kind": "MODEL", "assetId": BASE},
            {"id": "copse", "kind": "CLUSTER", "assetId": BASE, "positions": [{"x": 1, "z": 2}]},
            {"id": "wild", "kind": "SCATTER", "assetId": BASE, "count": 4},
        ]
    }
}


@pytest.fixture
def shipped():
    """The shipped export, which pairs foliage-tree with its twin (the only pair today)."""
    import_content(DEFAULT_EXPORT_DIR)
    base = ContentAsset.objects.get(asset_id=BASE)
    assert base.low_detail is not None and base.low_detail.asset_id == TWIN
    return base, base.low_detail


def by_source(asset, source):
    return [usage for usage in usages_for(asset) if usage.source == source]


def test_a_published_region_drawing_the_base_model_does_not_use_its_twin(shipped):
    """D1: MODEL, CLUSTER and SCATTER never draw the twin, so the region neither lists nor
    protects it, while the base model itself stays protected."""
    base, twin = shipped
    area("lod-grove", scene=SCENE)

    assert by_source(twin, "regions") == []
    base_usages = by_source(base, "regions")
    assert base_usages and all(usage.blocks_retirement for usage in base_usages)


def test_the_twin_is_listed_by_the_shipped_scene_never_blocking(shipped):
    """D2: the catalog lists the twin under Welcome Harbor (it is drawn there by LOD_PLACEMENTS in
    the bundled manifest) and never blocks."""
    _, twin = shipped
    usages = by_source(twin, "catalog")
    assert "welcome-harbor" in {usage.details["scene"] for usage in usages}
    assert not any(usage.blocks_retirement for usage in usages)


def test_retiring_the_twin_succeeds_and_keeps_the_shipped_collision_rule(shipped):
    """D3: retiring the twin is allowed; as a model the app ships, the resolver keeps treating it
    by the #75 rule (a retired shipped model keeps its collision profile)."""
    base, twin = shipped
    area("lod-grove", scene=SCENE)

    services.retire_asset(twin)

    twin.refresh_from_db()
    assert twin.status == AssetStatus.RETIRED
    assert twin.bundled_path  # every twin is a bundled file (manifest.test.ts)
    assert resolver._retired_but_shipped_model(twin)
    base.refresh_from_db()
    assert base.status != AssetStatus.RETIRED
