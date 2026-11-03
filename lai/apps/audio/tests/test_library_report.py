"""SM-P3: the sound library readiness report, the admin page and the read-only command."""

from io import StringIO

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client

from apps.assets import services as asset_services
from apps.audio import reporting, services
from apps.audio.management.commands.ensure_sound_roles import EDITORS
from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.tests.helpers import assign, audio_asset, cue
from apps.audio.treasure_rush_cues import CueSpec
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REPORT = "/admin/audio/soundlibraryreport/"
CHEST = CueSpec("sfx.chest.open", "Chest", "Chest opens")
OCEAN = CueSpec("ambient.treasure_rush.ocean", "Ocean", "Waves", loop=True)
COIN = CueSpec("sfx.coin.collect", "Coin", "No mechanic yet", wired=False)


@pytest.fixture
def small_game(monkeypatch):
    """Treasure Rush reduced to two required cues and one optional, so tests stay quick."""
    spec = reporting.GameSpec(
        "treasure-rush", "Treasure Rush", "treasure-rush-cove", (CHEST, OCEAN, COIN), "seed-cmd"
    )
    monkeypatch.setitem(reporting.GAMES, "treasure-rush", spec)
    return spec


def make_cue(spec, *, shared=True, publish=True):
    asset, _ = audio_asset(spec.asset_id, publish=publish)
    return cue(spec.cue_id, asset, shared=shared)


def run(*args):
    out = StringIO()
    call_command("audio_library_report", *args, stdout=out)
    return out.getvalue()


def check(coverage, cue_id):
    return next(c for c in coverage.checks if c.cue_id == cue_id)


def staff(username, *groups, superuser=False):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
        is_superuser=superuser,
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


# --- empty and complete -------------------------------------------------------------------------


def test_an_empty_library_has_zero_counts_and_says_why_nothing_is_ready(small_game):
    inv = reporting.inventory()
    assert (inv.audio_assets, inv.cues, inv.releases, inv.live_release_number) == (0, 0, 0, None)
    assert inv.last_published_at is None
    coverage = reporting.game_coverage("treasure-rush")
    assert not coverage.area_found and not coverage.ready
    assert check(coverage, "sfx.chest.open").cue_status == "missing"
    codes = {issue.code for issue in reporting.diagnostics().issues}
    assert {"empty-library", "no-live-release", "game-area-missing", "missing-cue"} <= codes


def test_a_complete_library_is_ready_with_correct_counts(small_game, treasure):
    make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    coverage = reporting.game_coverage("treasure-rush")
    assert coverage.area_found and coverage.ready
    assert coverage.ready_count == 2
    assert all(c.manifest_status == "served" for c in coverage.checks)
    inv = reporting.inventory()
    assert (inv.audio_assets, inv.published_assets, inv.draft_assets, inv.retired_assets) == (
        2,
        2,
        0,
        0,
    )
    assert (inv.cues, inv.enabled_cues, inv.cues_in_live_release) == (2, 2, 2)
    assert inv.live_release_number == 1 and inv.last_published_at is not None
    assert not [i for i in reporting.diagnostics().issues if i.severity == reporting.ERROR]


# --- what blocks a cue --------------------------------------------------------------------------


def test_a_cue_whose_audio_is_not_published_is_not_ready_and_says_how_to_fix_it(
    small_game, treasure
):
    make_cue(CHEST)
    make_cue(OCEAN, publish=False)
    result = check(reporting.game_coverage("treasure-rush"), OCEAN.cue_id)
    assert result.asset_status == "unpublished" and not result.ready
    assert any("publish a version" in fix.lower() for fix in result.remediation)
    inv = reporting.inventory()
    assert inv.draft_assets == 1 and inv.cues_with_blocked_audio == 1


def test_a_retired_asset_is_reported_and_dropped_from_the_manifest(small_game, treasure):
    chest = make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    asset_services.retire_asset(chest.asset)
    result = check(reporting.game_coverage("treasure-rush"), CHEST.cue_id)
    assert result.asset_status == "retired" and result.manifest_status == "not served"
    assert not result.ready
    assert reporting.inventory().retired_assets == 1
    assert "retired-asset" in {i.code for i in reporting.diagnostics().issues}


def test_a_cue_added_after_the_last_release_is_not_in_the_live_release(small_game, treasure):
    make_cue(CHEST)
    services.publish(None)
    make_cue(OCEAN)
    result = check(reporting.game_coverage("treasure-rush"), OCEAN.cue_id)
    assert result.release_status == "not in the live release" and not result.ready
    assert any("Publish the sound library" in fix for fix in result.remediation)
    assert "not-in-release" in {i.code for i in reporting.diagnostics().issues}


def test_a_cue_with_no_assignment_that_is_not_shared_is_not_served(small_game, treasure):
    make_cue(CHEST, shared=False)
    make_cue(OCEAN)
    services.publish(None)
    result = check(reporting.game_coverage("treasure-rush"), CHEST.cue_id)
    assert result.assignment_status == "none" and result.manifest_status == "not served"
    assert not result.ready
    unassigned = [i for i in reporting.diagnostics().issues if i.code == "unassigned-cue"]
    assert [i.subject for i in unassigned] == [CHEST.cue_id]
    assert reporting.inventory().unassigned_cues == 1


def test_an_assignment_to_the_games_area_makes_a_non_shared_cue_served(small_game, treasure):
    chest = make_cue(CHEST, shared=False)
    make_cue(OCEAN)
    assign(chest, event="on_enter", region=treasure.region)
    services.publish(None)
    result = check(reporting.game_coverage("treasure-rush"), CHEST.cue_id)
    assert result.ready and result.assignment_status == "1 assignment(s)"
    row = next(r for r in reporting.scope_coverage() if r.kind == "3D Area")
    assert row.assignments == 1 and row.manifest_sounds == 2 and row.problems == 0


def test_a_disabled_cue_is_not_ready(small_game, treasure):
    chest = make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    SoundCue.objects.filter(pk=chest.pk).update(enabled=False)
    result = check(reporting.game_coverage("treasure-rush"), CHEST.cue_id)
    assert result.cue_status == "disabled" and not result.ready
    codes = {i.code for i in reporting.diagnostics().issues}
    assert "orphaned-release-cue" in codes


def test_a_release_cue_that_no_longer_exists_is_an_orphan(small_game, treasure):
    chest = make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    chest.delete()
    orphans = [i for i in reporting.diagnostics().issues if i.code == "orphaned-release-cue"]
    assert [i.subject for i in orphans] == [CHEST.cue_id]


def test_an_invalid_assignment_is_reported_with_a_fix(small_game, treasure):
    chest = make_cue(CHEST)
    obj = assign(chest, event="on_enter", region=treasure.region)
    SoundAssignment.objects.filter(pk=obj.pk).update(target_type="adventure", target_id="gone")
    issue = next(i for i in reporting.diagnostics().issues if i.code == "invalid-assignment")
    assert "Sound assignments" in issue.remediation
    row = next(r for r in reporting.scope_coverage() if r.kind == "3D Area")
    assert row.problems == 1


def test_optional_cues_never_block_readiness(small_game, treasure):
    make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    coverage = reporting.game_coverage("treasure-rush")
    assert coverage.ready
    assert [c.cue_id for c in coverage.optional] == [COIN.cue_id]
    assert not coverage.optional[0].ready


# --- the real Treasure Rush table ---------------------------------------------------------------


def test_the_real_treasure_rush_requirements_are_the_sixteen_wired_cues():
    required = reporting.GAMES["treasure-rush"].required
    assert len(required) == 16
    assert all(spec.wired for spec in required)
    assert "sfx.coin.collect" in {s.cue_id for s in reporting.GAMES["treasure-rush"].optional}


# --- the command --------------------------------------------------------------------------------


def snapshot():
    return (SoundCue.objects.count(), SoundAssignment.objects.count(), SoundRelease.objects.count())


def test_the_command_reports_deterministically_and_changes_nothing(small_game, treasure):
    make_cue(CHEST)
    before = snapshot()
    first, second = run("--game", "treasure-rush"), run("--game", "treasure-rush")
    assert first == second
    assert snapshot() == before
    assert "NOT READY sfx.chest.open" in first
    assert "optional  sfx.coin.collect" in first
    assert "SOUND LIBRARY" in first and "PROBLEMS" in first


def test_strict_mode_fails_with_status_two_when_required_audio_is_missing(small_game, treasure):
    make_cue(CHEST)
    with pytest.raises(CommandError) as failure:
        run("--game", "treasure-rush", "--strict")
    assert failure.value.returncode == 2
    assert "required cue" in str(failure.value)


def test_strict_mode_passes_when_everything_is_ready(small_game, treasure):
    make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    output = run("--game", "treasure-rush", "--strict")
    assert "2 of 2 required cues ready" in output


def test_without_strict_a_missing_library_still_exits_normally(small_game):
    assert "NOT FOUND" in run("--game", "treasure-rush")


def test_the_command_never_publishes(small_game, treasure):
    make_cue(CHEST)
    run()
    assert SoundRelease.objects.count() == 0


def test_scope_filters_narrow_the_scope_table(small_game, treasure):
    place = treasure.region.location
    output = run("--island", place.world.slug, "--place", place.slug)
    assert f"Place: {place.world.slug} / {place.slug}" in output
    assert "Adventure:" not in output


# --- the admin page -----------------------------------------------------------------------------


def test_the_report_page_is_for_sound_editors_and_superusers_only(small_game, treasure):
    assert staff("edith", EDITORS).get(REPORT).status_code == 200
    assert staff("root", superuser=True).get(REPORT).status_code == 200
    assert staff("nobody").get(REPORT).status_code == 403
    assert Client().get(REPORT).status_code in (302, 403)


def test_the_report_page_shows_what_is_missing_and_how_to_fix_it(small_game, treasure):
    make_cue(CHEST)
    page = staff("edith", EDITORS).get(REPORT).content.decode()
    assert "Not ready: 0 of 2 required cues can play" in page
    assert "sfx.chest.open" in page and "ambient.treasure_rush.ocean" in page
    assert "<caption>" in page and 'scope="col"' in page
    assert "Upload an audio asset with id" in page


def test_the_report_page_filters_and_searches(small_game, treasure):
    make_cue(CHEST)
    make_cue(OCEAN)
    services.publish(None)
    client = staff("edith", EDITORS)
    page = client.get(REPORT, {"show": "blocked"}).content.decode()
    assert "No cues match these filters." in page
    page = client.get(REPORT, {"q": "ocean"}).content.decode()
    assert '<th scope="row">ambient.treasure_rush.ocean</th>' in page
    assert '<th scope="row">sfx.chest.open</th>' not in page
    page = client.get(REPORT, {"severity": "error"}).content.decode()
    assert "Nothing to fix." in page


def test_the_report_page_changes_nothing_even_when_posted_to(small_game, treasure):
    make_cue(CHEST)
    before = snapshot()
    client = staff("edith", EDITORS)
    client.get(REPORT)
    client.post(REPORT, {"anything": "x"})
    assert snapshot() == before


def test_the_report_is_listed_under_the_sound_library_for_editors(small_game):
    client = staff("edith", EDITORS)
    assert "Library report" in client.get("/admin/audio/").content.decode()
    assert client.get("/admin/audio/soundlibraryreport/add/").status_code == 403
