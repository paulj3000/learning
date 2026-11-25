"""LAI-07 W2-4: the avatar usage provider behaves exactly like the registered avatar guard.

The guard stays registered; these tests prove the provider would refuse the same retirements
with the same code, message and details, before anyone approves switching to it. Thumbnails and
non-available avatars are reported only (owner decision, 2026-11-22).
"""

import pytest

from apps.assets import dependencies as registry
from apps.assets import services
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.assets.tests.helpers import make_definition, make_version
from apps.avatars import dependencies
from apps.avatars.models import PlayerAvatar
from apps.avatars.vocabulary import AvatarStatus

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def outcome(guard, asset, version):
    try:
        guard(asset, version)
    except AssetActionRefused as refused:
        return (refused.code, refused.message, refused.details)
    return None


@pytest.fixture
def only_avatars(monkeypatch):
    monkeypatch.setattr(registry, "_PROVIDERS", {})
    # The registry alone: no legacy guard may run first, or parity would be trivially true.
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [registry.retirement_guard])
    dependencies.register_usage_provider()
    return registry.retirement_guard


def model(asset_id="player-fox"):
    asset = make_definition(asset_id, category="character")
    v1 = make_version(asset, 1, status=VersionStatus.PUBLISHED)
    v2 = make_version(asset, 2, status=VersionStatus.PUBLISHED)
    asset.default_version = v1
    asset.save()
    return asset, v1, v2


def fox(asset, status=AvatarStatus.AVAILABLE, pinned=None, thumbnail=None):
    row = PlayerAvatar.objects.get(avatar_key="FOX")
    row.model_asset = asset
    row.status = status
    row.pinned_version = pinned
    row.thumbnail_asset = thumbnail
    row.save()
    return row


def assert_parity(only_avatars, asset, *versions):
    for version in (None, *versions):
        old = outcome(dependencies.retirement_guard, asset, version)
        assert outcome(only_avatars, asset, version) == old, version and version.number
        blocks = any(u.blocks_retirement for u in dependencies.usages(asset, version))
        assert blocks == (old is not None)


def test_the_provider_replaces_the_guard():  # no fixture: the real registrations (W2-4b)
    assert dependencies.retirement_guard not in services.RETIREMENT_GUARDS
    assert "avatars" in registry.registered_sources()


@pytest.mark.parametrize("status", list(AvatarStatus))
@pytest.mark.parametrize("pin", [None, 1, 2])
def test_parity_across_status_and_pinning(only_avatars, status, pin):
    asset, v1, v2 = model()
    fox(asset, status=status, pinned={None: None, 1: v1, 2: v2}[pin])
    assert_parity(only_avatars, asset, v1, v2)


def test_an_unpinned_available_avatar_blocks_retiring_its_default_even_with_a_replacement(
    only_avatars, monkeypatch
):
    asset, v1, v2 = model()
    fox(asset)
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [registry.retirement_guard])
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_version(v1, replacement=v2)
    assert refused.value.code == dependencies.REFUSAL_CODE
    assert refused.value.details == {"avatars": ["FOX"]}
    services.retire_version(v2)  # not served: retires
    v2.refresh_from_db()
    assert v2.status == VersionStatus.RETIRED


def test_thumbnails_and_draft_avatars_are_reported_never_blocking(only_avatars):
    asset, v1, v2 = model()
    face = make_definition("fox-face", kind="image", category="image")
    fox(asset, status=AvatarStatus.DRAFT, thumbnail=face)
    assert [(u.label, u.blocks_retirement) for u in dependencies.usages(asset)] == [
        ("Player avatar FOX (draft, model)", False)
    ]
    assert [(u.label, u.blocks_retirement) for u in dependencies.usages(face)] == [
        ("Player avatar FOX (draft, thumbnail)", False)
    ]
    available = fox(asset, thumbnail=face)
    assert available.status == AvatarStatus.AVAILABLE
    assert outcome(only_avatars, face, None) is None  # a thumbnail never blocks
    assert_parity(only_avatars, face)


def test_an_asset_no_avatar_uses_has_no_usages(only_avatars):
    asset, v1, _ = model("unused-model")
    assert dependencies.usages(asset) == [] and dependencies.usages(asset, v1) == []


def test_npc_and_avatar_blockers_are_named_together(only_avatars, monkeypatch):
    from apps.npcs import dependencies as npcs
    from apps.npcs.publishing import publish
    from apps.npcs.tests.helpers import make_character, make_staff, make_variant

    npcs.register_usage_provider()
    asset, v1, _ = model("shared-model")
    fox(asset)
    character = make_character("sharer", with_variant=False)
    make_variant(character, model_asset=asset, animation_map={"idle": "Idle"})
    publish(make_staff())
    monkeypatch.setattr(services, "RETIREMENT_GUARDS", [registry.retirement_guard])
    with pytest.raises(AssetActionRefused) as refused:
        services.retire_asset(asset)
    assert refused.value.code == "asset_in_use"
    assert "NPC release(s) 1 (active)" in refused.value.message
    assert "Fox player avatar" in refused.value.message
    assert set(refused.value.details["blockers"]) == {"avatars", "npcs"}


def test_a_provider_failure_refuses_retirement(only_avatars, monkeypatch):
    asset, _, _ = model()

    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(dependencies, "avatars_using", broken)
    refused = outcome(only_avatars, asset, None)
    assert refused[0] == "dependency_check_failed" and refused[2] == {"source": "avatars"}
