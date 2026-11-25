"""The default ground tile is a region usage (LAI-07 W2; ASSET_LIBRARY.md s. 25.3).

LAI 01 found (2026-11-25) that a region whose scene names no `groundAssetId` still tiles
`ground-tile`: the client falls back to `DEFAULT_GROUND_ASSET_ID` (`regionManifest.ts`, `ground()`).
The regions provider mirrors that rule, so a PUBLISHED area protects the ground it draws, a DRAFT
lists it and a RETIRED one keeps it as history. Any change to the client constant is LAI 04's
(Game Engine Core) and must change `DEFAULT_GROUND_ASSET_ID` here with it.
"""

import re
from pathlib import Path

import pytest

from apps.assets import services
from apps.assets.dependencies import usages_for
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.core.content_status import ContentStatus
from apps.regions.dependencies import (
    DEFAULT_GROUND_ASSET_ID,
    DEFAULT_GROUND_PATH,
    REFUSAL_CODE,
    _draws_default_ground,
)
from apps.regions.tests.test_dependencies import area

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CLIENT = Path(__file__).resolve().parents[4] / "react/src/features/region-play/regionManifest.ts"


@pytest.fixture
def ground():
    asset = make_definition(DEFAULT_GROUND_ASSET_ID, kind="prop", category="prop")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    asset.default_version = v1
    asset.save()
    return asset


def regions(asset, version=None):
    return [usage for usage in usages_for(asset, version) if usage.source == "regions"]


def test_the_default_matches_the_client_constant():
    """Drift guard: a rename or new value in the client must change the mirror with it."""
    match = re.search(r"DEFAULT_GROUND_ASSET_ID\s*=\s*'([^']+)'", CLIENT.read_text())
    assert match, "regionManifest.ts no longer declares DEFAULT_GROUND_ASSET_ID"
    assert match.group(1) == DEFAULT_GROUND_ASSET_ID


@pytest.mark.parametrize(
    "scene", [{}, {"groundAssetId": ""}, {"groundAssetId": None}, {"groundAssetId": 7}]
)
def test_a_published_area_without_a_ground_protects_the_default(ground, scene):
    area("cove", scene=scene)

    [usage] = regions(ground)
    assert usage.blocks_retirement and not usage.historical
    assert usage.code == REFUSAL_CODE
    assert usage.details == {"region": "cove", "scene": DEFAULT_GROUND_PATH}
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(ground)
    assert refused.value.code == REFUSAL_CODE
    assert DEFAULT_GROUND_PATH in refused.value.message


def test_an_area_naming_its_own_ground_does_not_use_the_default(ground):
    area("dunes", scene={"groundAssetId": "sand-tile"})

    assert regions(ground) == []
    services.retire_asset(ground)  # allowed


def test_an_area_naming_the_default_explicitly_is_reported_once(ground):
    area("cove", scene={"groundAssetId": DEFAULT_GROUND_ASSET_ID})

    [usage] = regions(ground)
    assert usage.details == {"region": "cove", "scene": "groundAssetId"}


def test_draft_areas_list_the_default_and_retired_ones_keep_it_as_history(ground):
    area("draft-cove", status=ContentStatus.DRAFT)
    area("old-cove", status=ContentStatus.RETIRED)

    flags = {u.details["region"]: (u.blocks_retirement, u.historical) for u in regions(ground)}
    assert flags == {"draft-cove": (False, False), "old-cove": (False, True)}
    services.retire_asset(ground)  # allowed: no published area draws it


def test_retiring_a_version_of_the_default_ground_is_unchanged(ground):
    """Regions are served the default version; retiring it needs a replacement, as before."""
    area("cove")
    v2 = make_version(ground, 2, status=VersionStatus.PUBLISHED)

    assert not any(usage.blocks_retirement for usage in regions(ground, ground.default_version))
    services.retire_version(ground.default_version, replacement=v2)


@pytest.mark.parametrize(
    ("scene", "default"),
    [
        (None, True),
        ([], True),
        ("cove", True),
        ({"groundAssetId": " "}, False),  # used as-is by the client (`typeof v === 'string' && v`)
        ({"groundAssetId": "sand-tile"}, False),
    ],
)
def test_the_client_rule_is_mirrored_exactly(scene, default):
    assert _draws_default_ground(scene) is default
