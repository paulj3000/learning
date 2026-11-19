"""The Storykeeper Castle seed command (SC-R06-01): idempotent, never publishes, never substitutes."""

import re
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.audio.castle_cues import CASTLE_CUES
from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.tests.helpers import audio_asset
from apps.audio.treasure_rush_cues import TREASURE_RUSH_CUES

pytestmark = pytest.mark.django_db

SHARED_REUSED = {
    "sfx.learning.correct",
    "sfx.learning.retry",
    "sfx.quest.complete",
    "sfx.treasure.reveal",
    "sfx.reward.collect",
}


def run(*args):
    out = StringIO()
    call_command("seed_castle_sound", *args, stdout=out)
    return out.getvalue()


def test_cue_table_is_valid_unique_and_never_duplicates_a_shared_cue():
    ids = [spec.cue_id for spec in CASTLE_CUES]
    assert len(ids) == len(set(ids))
    for spec in CASTLE_CUES:
        assert spec.cue_id.startswith(f"{spec.channel}.")
        assert ".castle." in spec.cue_id
        assert "—" not in spec.description
    shared = {spec.cue_id for spec in TREASURE_RUSH_CUES}
    assert not set(ids) & shared
    # The shared cues the castle plays exist in the shared table, so they are seeded once.
    assert SHARED_REUSED <= shared


def test_every_room_bed_and_both_themes_loop_and_stream():
    beds = [spec for spec in CASTLE_CUES if spec.channel in {"ambient", "music"}]
    assert {spec.cue_id for spec in beds} >= {
        "ambient.castle.hall",
        "ambient.castle.secret",
        "music.castle.explore",
        "music.castle.story",
    }
    assert all(spec.loop and spec.stream for spec in beds)


def test_without_assets_creates_nothing_and_reports_every_requirement():
    report = run()
    assert SoundCue.objects.count() == 0
    for spec in CASTLE_CUES:
        assert f"ASSET NEEDED {spec.cue_id}" in report
        assert spec.asset_id in report


def test_creates_only_cues_whose_audio_exists_and_is_published():
    audio_asset("sfx-castle-book-open")
    audio_asset("ambient-castle-hall", category="sound")
    audio_asset("sfx-castle-page-restore", publish=False)
    run()
    assert set(SoundCue.objects.values_list("cue_id", flat=True)) == {
        "sfx.castle.book_open",
        "ambient.castle.hall",
    }
    assert "ASSET NEEDED sfx.castle.page_restore" in run()


def test_is_idempotent_and_leaves_staff_changes_alone():
    audio_asset("sfx-castle-book-open")
    run()
    SoundCue.objects.filter(cue_id="sfx.castle.book_open").update(volume=0.2, enabled=False)
    run()
    cue = SoundCue.objects.get(cue_id="sfx.castle.book_open")
    assert (cue.volume, cue.enabled) == (0.2, False)
    assert SoundCue.objects.count() == 1


def test_dry_run_writes_nothing():
    audio_asset("sfx-castle-book-open")
    assert "Would create 1" in run("--dry-run")
    assert SoundCue.objects.count() == 0


def test_never_publishes_or_assigns_and_never_seeds_another_games_cue():
    audio_asset("sfx-castle-book-open")
    audio_asset("sfx-chest-open")
    run()
    assert SoundRelease.objects.count() == 0
    assert SoundAssignment.objects.count() == 0
    assert list(SoundCue.objects.values_list("cue_id", "shared")) == [
        ("sfx.castle.book_open", True)
    ]


def test_the_table_matches_the_castle_s_react_cue_ids():
    """The React castle asks for exactly the cues this table seeds (`castleSounds.ts`)."""
    source = (
        Path(__file__).resolve().parents[4]
        / "react/src/features/island-map/three/extensions/castleTale/castleSounds.ts"
    ).read_text("utf-8")
    react_ids = set(re.findall(r"'((?:ambient|music|sfx|ui)\.castle\.[a-z_]+)'", source))
    assert react_ids == {spec.cue_id for spec in CASTLE_CUES}
