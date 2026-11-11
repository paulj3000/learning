"""Retirement guards (LAI-NPC-036 hook): another app can veto retiring an asset or version.

The asset library never imports the app that registers a guard; these tests use a stand-in guard
so they hold whatever apps are installed.
"""

import pytest

from apps.assets import services
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import AssetStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def calls(monkeypatch):
    """Replace the registered guards with one that refuses and records what it was asked."""
    seen: list[tuple[str, int | None]] = []

    def refuse(asset, version):
        seen.append((asset.asset_id, version.number if version is not None else None))
        raise AssetActionRefused("in_use", "Something still uses this.")

    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [refuse])
    return seen


def test_a_guard_refusal_leaves_the_asset_active(calls):
    asset = make_definition("guarded")
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "in_use"
    asset.refresh_from_db()
    assert asset.status == AssetStatus.ACTIVE
    assert calls == [("guarded", None)]


def test_a_guard_refusal_leaves_the_version_published(calls):
    asset = make_definition("guarded")
    make_version(asset, 1, status=VersionStatus.PUBLISHED)
    spare = make_version(asset, 2, status=VersionStatus.PUBLISHED)
    with pytest.raises(AssetActionRefused):
        services.retire_version(spare)
    spare.refresh_from_db()
    assert spare.status == VersionStatus.PUBLISHED
    assert calls == [("guarded", 2)]


def test_without_an_objection_retirement_proceeds(monkeypatch):
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [lambda asset, version: None])
    asset = make_definition("free")
    services.retire_asset(asset)
    asset.refresh_from_db()
    assert asset.status == AssetStatus.RETIRED


def test_registering_the_same_guard_twice_keeps_one(monkeypatch):
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [])

    def guard(asset, version):
        return None

    services.register_retirement_guard(guard)
    services.register_retirement_guard(guard)
    assert services.RETIREMENT_GUARDS == [guard]
