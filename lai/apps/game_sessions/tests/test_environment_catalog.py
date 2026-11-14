"""The play API's catalog lists the cove's library palms, barrels and logs (TR-PALM-05, TR-ENV-06).

The client draws a palm or a prop from its model only when this catalog says the model can be
delivered now; otherwise it keeps the primitive palm and the bundled barrels and logs.
"""

import pytest

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.importer import import_content
from apps.game_sessions.play_state import region_catalog
from apps.regions.models import WorldRegion
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
