"""LAI-07 W2-4: the NPC usage provider behaves exactly like the registered NPC retirement guard.

The guard (`dependencies.retirement_guard`) stays registered; these tests prove the provider
would refuse the same retirements with the same code, message and details, before anyone
approves switching to it.
"""

import pytest

from apps.assets import dependencies as registry
from apps.assets import services
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.catalog.models import ContentAsset
from apps.npcs import dependencies
from apps.npcs.publishing import publish, retire

from .helpers import make_character, make_staff, make_variant

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def outcome(guard, asset, version):
    try:
        guard(asset, version)
    except AssetActionRefused as refused:
        return (refused.code, refused.message, refused.details)
    return None


@pytest.fixture
def only_npcs(monkeypatch):
    """The registry with nothing but the NPC provider."""
    monkeypatch.setattr(registry, "_PROVIDERS", {})
    # The registry alone: no legacy guard may run first, or parity would be trivially true.
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [registry.retirement_guard])
    dependencies.register_usage_provider()
    return registry.retirement_guard


@pytest.fixture
def staff():
    return make_staff()


def versioned(npc_id="parity"):
    asset = make_definition(f"{npc_id}-glb")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED, clips=["Idle"])
    v2 = make_version(asset, 2, status=VersionStatus.PUBLISHED, clips=["Idle"])
    asset.default_version = v1
    asset.save()
    character = make_character(npc_id, with_variant=False)
    make_variant(character, model_asset=asset, animation_map={"idle": "Idle"})
    return character, asset, v1, v2


def assert_parity(only_npcs, asset, *versions):
    for version in (None, *versions):
        old = outcome(dependencies.retirement_guard, asset, version)
        new = outcome(only_npcs, asset, version)
        assert new == old, (asset.asset_id, version and version.number)
        blocks = any(u.blocks_retirement for u in dependencies.usages(asset, version))
        assert blocks == (old is not None)


def test_the_guard_is_still_the_registered_one():  # no fixture: the real registrations
    assert dependencies.retirement_guard in services.RETIREMENT_GUARDS
    assert "npcs" not in registry.registered_sources()


def test_parity_with_drafts_only(only_npcs):
    _, asset, v1, v2 = versioned()
    assert_parity(only_npcs, asset, v1, v2)
    assert [u.label for u in dependencies.usages(asset)] == ["parity variant classic (model)"]


def test_parity_with_an_active_release(only_npcs, staff):
    _, asset, v1, v2 = versioned()
    release = publish(staff)
    assert_parity(only_npcs, asset, v1, v2)
    blocking = [u for u in dependencies.usages(asset, v1) if u.blocks_retirement]
    assert [(u.label, u.details) for u in blocking] == [
        (f"NPC release {release.number} (active)", {"release": release.number})
    ]


def test_parity_with_superseded_active_and_retired_releases(only_npcs, staff):
    character, asset, v1, v2 = versioned()
    first = publish(staff)
    variant = character.variants.get()
    variant.pinned_version = v2
    variant.save()
    publish(staff)  # first is now SUPERSEDED (v1), the new one ACTIVE (v2)
    assert_parity(only_npcs, asset, v1, v2)
    retire(first, staff)  # RETIRED never blocks
    assert_parity(only_npcs, asset, v1, v2)


def test_parity_for_a_bundled_asset_without_versions(only_npcs, staff):
    make_character("bundled")
    release = publish(staff)
    asset = ContentAsset.objects.get(asset_id="bundled-model")
    assert_parity(only_npcs, asset)
    retire(release, staff)
    assert_parity(only_npcs, asset)


def test_switched_on_the_provider_refuses_a_retirement_with_a_replacement_default(
    only_npcs, staff, monkeypatch
):
    _, asset, v1, v2 = versioned()
    publish(staff)
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [registry.retirement_guard])
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(v1, replacement=v2)
    assert refused.value.code == "npc_release_dependency"
    assert "parity-glb v1 is used by NPC release(s) 1 (active)" in refused.value.message
    v1.refresh_from_db()
    assert v1.status == VersionStatus.PUBLISHED
    services.retire_version(v2)  # unused by any release: retires
    v2.refresh_from_db()
    assert v2.status == VersionStatus.RETIRED


def test_a_provider_failure_refuses_retirement(only_npcs, monkeypatch):
    _, asset, _, _ = versioned()

    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(dependencies, "release_dependents", broken)
    refused = outcome(only_npcs, asset, None)
    assert refused[0] == "dependency_check_failed" and refused[2] == {"source": "npcs"}
