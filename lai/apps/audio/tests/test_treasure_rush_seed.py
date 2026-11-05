"""The Treasure Rush seed command (SM-P3-10): idempotent, never publishes, never substitutes."""

from io import StringIO

import pytest
from django.core.management import call_command

from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.tests.helpers import audio_asset
from apps.audio.treasure_rush_cues import TREASURE_RUSH_CUES

pytestmark = pytest.mark.django_db


def run(*args):
    out = StringIO()
    call_command("seed_treasure_rush_sound", *args, stdout=out)
    return out.getvalue()


def test_cue_table_is_valid_and_unique():
    ids = [spec.cue_id for spec in TREASURE_RUSH_CUES]
    assert len(ids) == len(set(ids))
    for spec in TREASURE_RUSH_CUES:
        assert spec.cue_id.startswith(f"{spec.channel}.")


def test_without_assets_creates_nothing_and_reports_every_requirement():
    report = run()
    assert SoundCue.objects.count() == 0
    for spec in TREASURE_RUSH_CUES:
        assert f"ASSET NEEDED {spec.cue_id}" in report
        assert spec.asset_id in report


def test_creates_only_cues_whose_audio_exists_and_is_published():
    audio_asset("sfx-chest-open")
    audio_asset("ambient-treasure-rush-ocean", category="sound")
    audio_asset("sfx-key-discover", publish=False)
    run()
    assert set(SoundCue.objects.values_list("cue_id", flat=True)) == {
        "sfx.chest.open",
        "ambient.treasure_rush.ocean",
    }
    assert "ASSET NEEDED sfx.key.discover" in run()


def test_is_idempotent_and_leaves_staff_changes_alone():
    audio_asset("sfx-chest-open")
    run()
    SoundCue.objects.filter(cue_id="sfx.chest.open").update(volume=0.2, enabled=False)
    run()
    cue = SoundCue.objects.get(cue_id="sfx.chest.open")
    assert (cue.volume, cue.enabled) == (0.2, False)
    assert SoundCue.objects.count() == 1


def test_dry_run_writes_nothing():
    audio_asset("sfx-chest-open")
    assert "Would create 1" in run("--dry-run")
    assert SoundCue.objects.count() == 0


def test_never_publishes_or_assigns():
    audio_asset("sfx-chest-open")
    run()
    assert SoundRelease.objects.count() == 0
    assert SoundAssignment.objects.count() == 0
    assert SoundCue.objects.get().shared is True
