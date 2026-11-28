"""A served 3D Area never names an asset the client cannot find (MVP realm asset support).

The client validates every asset id in a served Area against its bundled manifest plus the
`catalog` the play API sends (`validateLocationManifest.ts`, `UNKNOWN_ASSET`); one unknown id
refuses the whole Area. These tests apply that rule on the server for the realms that are being
made enterable in the November 26 cycle (#98 North Pole, #100 Firepeak), so a gap shows up here
and not as a child seeing "couldn't be loaded".
"""

import json
from pathlib import Path

import pytest

from apps.catalog.importer import import_content
from apps.catalog.models import Location
from apps.core.content_status import ContentStatus
from apps.game_sessions.play_state import region_catalog
from apps.regions import firepeak_heart_seed, firepeak_seed, north_pole_seed
from apps.regions.dependencies import scene_asset_ids
from apps.regions.models import AreaPuzzle, WorldRegion

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.django_db,
    # One content import for the module (lai/conftest.py, "Module content baseline").
    pytest.mark.usefixtures("module_content"),
]

#: The client's bundled manifest, as exported (`content/exported/assets.json`).
EXPORT = Path(__file__).resolve().parents[4] / "content" / "exported" / "assets.json"
BUNDLED = {row["id"] for row in json.loads(EXPORT.read_text(encoding="utf-8"))["assets"]}


def unknown_to_the_client(scene: dict, catalog: dict, placement_ids=()) -> set[str]:
    named = set(scene_asset_ids(scene)) | {asset_id for asset_id in placement_ids if asset_id}
    return named - BUNDLED - {asset["assetId"] for asset in catalog["assets"]}


def post(client, url):
    return client.post(url, "{}", content_type="application/json")


@pytest.fixture
def north_pole(families):
    import_content()
    north_pole_seed.seed_north_pole()
    region_id = north_pole_seed.REGION_ID
    WorldRegion.objects.filter(region_id=region_id).update(status=ContentStatus.PUBLISHED)
    AreaPuzzle.objects.filter(region__region_id=region_id).update(status=ContentStatus.PUBLISHED)
    return families


@pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
def test_north_pole_is_served_to_every_band_with_no_unknown_asset(north_pole, api, band):
    child = north_pole.a1
    child.age_band = band
    child.save()
    client = api(north_pole.a)
    base = f"/api/v1/children/{child.pk}/regions/{north_pole_seed.REGION_ID}/"
    assert post(client, f"{base}session/").status_code in (200, 201)
    response = client.get(base)
    assert response.status_code == 200, response.content[:500]
    body = response.json()
    objects = [entry.get("assetId", "") for entry in [*body["objects"], *body["npcs"]]]
    assert unknown_to_the_client(body["region"]["scene"], body["catalog"], objects) == set()
    listed = {asset["assetId"] for asset in body["catalog"]["assets"]}
    assert {"north-pole-snowy-pine", "north-pole-lantern", "north-pole-candy-cane"} <= listed


@pytest.mark.parametrize(
    "module",
    [firepeak_seed, firepeak_heart_seed],
    ids=["firepeak-volcano", "firepeak-heart"],
)
def test_firepeak_areas_name_no_asset_unknown_to_the_client(module):
    import_content()
    if not Location.objects.filter(slug=module.PLACE_SLUG).exists():
        pytest.skip(f"Place {module.PLACE_SLUG} is not in the content export")
    seed = module.seed_firepeak if module is firepeak_seed else module.seed_firepeak_heart
    seed()
    region = WorldRegion.objects.get(region_id=module.REGION_ID)
    placements = region.placements.values_list("asset_id", flat=True)
    assert unknown_to_the_client(region.scene, region_catalog(region), placements) == set()
