"""SM-P2-05: draft isolation, version pinning, atomic publish, retirement and rollback."""

from unittest import mock

import pytest
from django.db import IntegrityError, transaction

from apps.assets import services as asset_services
from apps.audio import services
from apps.audio.models import ImmutableRelease, ReleaseStatus, SoundCue, SoundRelease
from apps.audio.tests.helpers import asset_upload, assign, audio_asset, cue

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def library(treasure):
    coin_asset, coin_v1 = audio_asset("coin-clink")
    theme_asset, _ = audio_asset("cove-theme", category="music", seconds=2)
    return {
        "region": treasure.region,
        "coin": cue("sfx.coin.collect", coin_asset, volume=0.8),
        "theme": cue("music.cove.explore", theme_asset, loop=True, stream=True),
        "coin_asset": coin_asset,
        "coin_v1": coin_v1,
    }


def live_cue(release, cue_id):
    return next(item for item in release.snapshot["cues"] if item["id"] == cue_id)


# --- publishing ----------------------------


def test_publishing_freezes_enabled_cues_with_exact_asset_versions(library):
    release = services.publish(None, "first")
    assert (release.number, release.status) == (1, ReleaseStatus.LIVE)
    assert len(release.revision) == 64 and release.note == "first"
    coin = live_cue(release, "sfx.coin.collect")
    assert coin["asset"] == "coin-clink" and coin["version"] == 1
    assert coin["versionId"] == str(library["coin_v1"].version_id)
    assert services.live_release() == release


def test_nothing_is_live_until_a_release_is_published(library):
    assert services.live_release() is None
    assert services.cue_status(library["coin"], None) == "Not published"


def test_an_empty_library_is_refused(db):
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert "no enabled sound cues" in refused.value.problems[0]


def test_disabled_cues_are_left_out(library):
    library["theme"].enabled = False
    library["theme"].save()
    release = services.publish(None)
    assert [item["id"] for item in release.snapshot["cues"]] == ["sfx.coin.collect"]
    assert services.cue_status(library["theme"], release) == "Disabled"


def test_an_assignment_of_a_disabled_cue_is_a_warning_not_a_blocker(library):
    assign(library["theme"], event="on_enter", region=library["region"])
    library["theme"].enabled = False
    library["theme"].save()
    report = services.library_report()
    assert not report.problems and any("is disabled" in w for w in report.warnings)
    release = services.publish(None)
    assert release.snapshot["assignments"] == []


# --- draft isolation and version consistency ----------------------------


def test_editing_a_cue_does_not_change_the_live_release(library):
    release = services.publish(None)
    library["coin"].volume = 0.1
    library["coin"].loop = True
    library["coin"].save()
    live = services.live_release()
    assert live_cue(live, "sfx.coin.collect")["volume"] == 0.8
    assert services.cue_status(library["coin"], live) == "Changes not yet published"
    assert live.revision == release.revision


def test_a_new_cue_or_assignment_is_not_live_until_published(library):
    services.publish(None)
    new_asset, _ = audio_asset("door-creak", seconds=3)
    newcomer = cue("sfx.door.creak", new_asset)
    assign(newcomer, event="on_enter", region=library["region"])
    live = services.live_release()
    assert "sfx.door.creak" not in {item["id"] for item in live.snapshot["cues"]}
    assert live.snapshot["assignments"] == []
    assert services.cue_status(newcomer, live) == "Not published"


def test_a_published_release_keeps_its_version_when_the_assets_default_moves(library):
    release = services.publish(None)
    v2 = asset_services.publish_version(asset_upload(library["coin_asset"], seconds=2))
    asset_services.set_default_version(v2)
    assert live_cue(services.live_release(), "sfx.coin.collect")["version"] == 1
    fresh = SoundCue.objects.get(pk=library["coin"].pk)
    assert services.cue_status(fresh, release) == "Changes not yet published"
    second = services.publish(None)
    assert live_cue(second, "sfx.coin.collect")["version"] == 2


def test_a_pinned_cue_ignores_the_assets_default(library):
    v2 = asset_services.publish_version(asset_upload(library["coin_asset"], seconds=2))
    asset_services.set_default_version(v2)
    library["coin"].pinned_version = library["coin_v1"]
    library["coin"].save()
    release = services.publish(None)
    assert live_cue(release, "sfx.coin.collect")["version"] == 1


# --- invalid configurations are rejected, all or nothing ----------------------------


def test_an_asset_with_no_published_version_blocks_the_whole_publish(library):
    services.publish(None)
    from apps.assets.tests.helpers import make_definition

    draft_only = make_definition("not-ready", kind="audio", category="sound")
    asset_upload(draft_only, seconds=4)
    cue("sfx.not.ready", draft_only)
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert any("no published default version" in p for p in refused.value.problems)
    assert SoundRelease.objects.count() == 1  # nothing new, and the live one is untouched
    assert services.live_release().number == 1


def test_every_problem_is_reported_not_just_the_first(library):
    from apps.assets.tests.helpers import make_definition

    for name in ("one", "two"):
        cue(f"sfx.bad.{name}", make_definition(f"bad-{name}", kind="audio", category="sound"))
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert len(refused.value.problems) == 2


def test_a_retired_asset_or_version_blocks_publication(library):
    asset_services.retire_asset(library["coin_asset"])
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert any("retired" in p for p in refused.value.problems)


def test_a_cue_pinned_to_a_since_retired_version_blocks_publication(library):
    v2 = asset_services.publish_version(asset_upload(library["coin_asset"], seconds=2))
    library["coin"].pinned_version = v2
    library["coin"].save()
    asset_services.retire_version(v2)
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert any("retired" in p for p in refused.value.problems)


def test_an_assignment_gone_stale_blocks_publication(library):
    obj = assign(library["theme"], event="on_enter", region=library["region"])
    obj.target_type, obj.target_id, obj.event = "adventure", "gone", "on_enter"
    obj.save()  # bypasses clean, like a deleted target would
    with pytest.raises(services.PublishRefused) as refused:
        services.publish(None)
    assert any("Unknown adventure" in p for p in refused.value.problems)


def test_a_failure_while_creating_the_release_leaves_the_live_release_in_place(library):
    first = services.publish(None)
    library["coin"].volume = 0.2
    library["coin"].save()
    with mock.patch.object(SoundRelease.objects, "create", side_effect=IntegrityError):
        with pytest.raises(services.PublishRefused):
            services.publish(None)
    live = services.live_release()
    assert live == first and live.status == ReleaseStatus.LIVE


def test_only_one_release_can_be_live(library):
    services.publish(None)
    with pytest.raises(IntegrityError), transaction.atomic():
        SoundRelease.objects.create(
            number=99, status="LIVE", revision="a" * 64, snapshot={"cues": [], "assignments": []}
        )


def test_publishing_again_supersedes_the_previous_release(library):
    first = services.publish(None)
    library["coin"].volume = 0.3
    library["coin"].save()
    second = services.publish(None)
    first.refresh_from_db()
    assert (first.status, second.status) == (ReleaseStatus.SUPERSEDED, ReleaseStatus.LIVE)
    assert second.number == 2 and second.revision != first.revision


# --- immutability ----------------------------


def test_a_release_cannot_be_edited_or_deleted(library):
    release = services.publish(None)
    release = SoundRelease.objects.get(pk=release.pk)
    release.snapshot = {"cues": [], "assignments": []}
    with pytest.raises(ImmutableRelease):
        release.save()
    release = SoundRelease.objects.get(pk=release.pk)
    with pytest.raises(ImmutableRelease):
        release.delete()


# --- rollback ----------------------------


def test_rollback_makes_an_earlier_release_live_as_a_new_release(library):
    first = services.publish(None)
    library["coin"].volume = 0.2
    library["coin"].save()
    second = services.publish(None)
    third = services.rollback_to(first, None)
    first.refresh_from_db()
    second.refresh_from_db()
    assert third.number == 3 and third.status == ReleaseStatus.LIVE
    assert third.snapshot == first.snapshot and third.revision == first.revision
    assert third.rolled_back_from == first
    assert (first.status, second.status) == (ReleaseStatus.SUPERSEDED, ReleaseStatus.SUPERSEDED)
    assert SoundRelease.objects.filter(status=ReleaseStatus.LIVE).count() == 1


def test_rollback_to_the_live_release_is_refused(library):
    release = services.publish(None)
    with pytest.raises(services.PublishRefused):
        services.rollback_to(release, None)


def test_rollback_is_refused_when_a_pinned_version_has_been_retired(library):
    first = services.publish(None)
    v2 = asset_services.publish_version(asset_upload(library["coin_asset"], seconds=2))
    asset_services.set_default_version(v2)
    second = services.publish(None)
    asset_services.retire_version(library["coin_v1"])
    with pytest.raises(services.PublishRefused) as refused:
        services.rollback_to(first, None)
    assert "no longer published" in refused.value.problems[0]
    assert services.live_release() == second


def test_the_cue_list_reports_a_cue_blocked_by_retirement(library):
    release = services.publish(None)
    assert services.cue_status(library["coin"], release) == "Published"
