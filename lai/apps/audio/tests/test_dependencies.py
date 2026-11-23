"""LAI-07 W2-2: the LIVE sound release blocks retiring what it pins; the rest is reported."""

import pytest

from apps.assets import dependencies as registry
from apps.assets import services as asset_services
from apps.assets.models import VersionStatus
from apps.assets.services import AssetActionRefused
from apps.audio import dependencies, services
from apps.audio.models import ReleaseStatus
from apps.audio.tests.helpers import asset_upload, audio_asset, cue

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def coin(treasure):
    asset, v1 = audio_asset("coin-clink")
    return {"asset": asset, "v1": v1, "cue": cue("sfx.coin.collect", asset)}


def audio_usages(asset, version=None):
    return [u for u in registry.usages_for(asset, version) if u.source == "audio"]


def blocking(asset, version=None):
    return [u.label for u in audio_usages(asset, version) if u.blocks_retirement]


def second_version(asset):
    v2 = asset_services.publish_version(asset_upload(asset, seconds=2))
    asset_services.set_default_version(v2)
    asset.refresh_from_db()
    return v2


def test_the_provider_is_registered():
    assert "audio" in registry.registered_sources()


def test_working_cues_are_reported_and_never_block(coin):
    assert [(u.label, u.blocks_retirement) for u in audio_usages(coin["asset"])] == [
        ("Sound cue sfx.coin.collect (working copy)", False)
    ]
    asset_services.retire_asset(coin["asset"])  # nothing published: retires


def test_the_live_release_blocks_retiring_the_asset(coin):
    release = services.publish(None)
    assert blocking(coin["asset"]) == [
        f"Sound release {release.number} (live), cue(s) sfx.coin.collect"
    ]
    with pytest.raises(AssetActionRefused) as refused:
        asset_services.retire_asset(coin["asset"])
    assert refused.value.code == "sound_release_dependency"
    assert refused.value.details == {"releases": [release.number], "cues": ["sfx.coin.collect"]}
    assert "coin-clink" in refused.value.message


def test_the_live_release_blocks_its_exact_version_even_with_a_replacement_default(coin):
    services.publish(None)  # pins v1
    v2 = second_version(coin["asset"])
    with pytest.raises(AssetActionRefused) as refused:
        asset_services.retire_version(coin["v1"])
    assert refused.value.code == "sound_release_dependency"
    assert "coin-clink v1" in refused.value.message
    coin["v1"].refresh_from_db()
    assert coin["v1"].status == VersionStatus.PUBLISHED
    assert blocking(coin["asset"], v2) == []  # the default is pinned by the cue, not the release


def test_retiring_the_default_with_a_replacement_is_refused_while_live(coin):
    services.publish(None)
    v2 = asset_services.publish_version(asset_upload(coin["asset"], seconds=2))
    with pytest.raises(AssetActionRefused) as refused:
        asset_services.retire_version(coin["v1"], replacement=v2)
    assert refused.value.code == "sound_release_dependency"


def test_a_superseded_release_is_reported_only(coin):
    first = services.publish(None)  # v1
    v2 = second_version(coin["asset"])
    second = services.publish(None)  # v2; first is SUPERSEDED
    first.refresh_from_db()
    assert first.status == ReleaseStatus.SUPERSEDED
    labels = [(u.label, u.blocks_retirement) for u in audio_usages(coin["asset"], coin["v1"])]
    assert labels == [
        (f"Sound release {first.number} (superseded), cue(s) sfx.coin.collect", False)
    ]
    asset_services.retire_version(coin["v1"])  # only the superseded release pinned it
    assert blocking(coin["asset"], v2) == [
        f"Sound release {second.number} (live), cue(s) sfx.coin.collect"
    ]


def test_republishing_without_the_cue_releases_the_asset(coin):
    services.publish(None)
    other, _ = audio_asset("chime")
    cue("sfx.chime.ring", other)
    coin["cue"].enabled = False
    coin["cue"].save()
    services.publish(None)
    assert blocking(coin["asset"]) == []
    asset_services.retire_asset(coin["asset"])


def test_an_asset_no_cue_uses_has_no_audio_usages(coin):
    services.publish(None)
    unused, v1 = audio_asset("unused-sound")
    assert audio_usages(unused) == [] and audio_usages(unused, v1) == []


def test_a_provider_failure_refuses_retirement(coin, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(dependencies, "_pinned", broken)
    services.publish(None)
    with pytest.raises(AssetActionRefused) as refused:
        asset_services.retire_asset(coin["asset"])
    assert refused.value.code == "dependency_check_failed"
    assert refused.value.details == {"source": "audio"}


def test_audio_and_another_blocker_are_named_together(coin, monkeypatch):
    services.publish(None)

    def avatar(asset, version):
        return [
            registry.Usage(
                "avatars", "avatar_dependency", "Fox player avatar", blocks_retirement=True
            )
        ]

    monkeypatch.setitem(registry._PROVIDERS, "zz-test", registry._Registration(avatar, None))
    with pytest.raises(AssetActionRefused) as refused:
        asset_services.retire_asset(coin["asset"])
    assert refused.value.code == "asset_in_use"
    assert set(refused.value.details["blockers"]) == {"audio", "zz-test"}
