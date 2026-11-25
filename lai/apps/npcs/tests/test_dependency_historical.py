"""LAI-07 W2-5: NPC usages are never marked historical.

A SUPERSEDED release still blocks retirement (it is a rollback target), so it is not "past use";
a RETIRED release is never listed; draft rows are informational. Nothing here is historical."""

import pytest

from apps.assets.models import VersionStatus
from apps.assets.tests.helpers import make_definition, make_version
from apps.npcs import dependencies
from apps.npcs.publishing import publish

from .helpers import make_character, make_staff, make_variant

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def test_no_npc_usage_is_historical():
    asset = make_definition("pip-glb")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=["Idle"])
    v2 = make_version(asset, 2, status=VersionStatus.PUBLISHED, clips=["Idle"])
    asset.default_version = v1
    asset.save()
    character = make_character("hist", with_variant=False)
    make_variant(character, model_asset=asset, animation_map={"idle": "Idle"})
    staff = make_staff()
    publish(staff)
    variant = character.variants.get()
    variant.pinned_version = v2
    variant.save()
    publish(staff)  # the first release is now SUPERSEDED
    found = dependencies.usages(asset)
    assert len([u for u in found if u.blocks_retirement]) == 2
    assert any(not u.blocks_retirement for u in found)
    assert [u.historical for u in found] == [False] * len(found)
