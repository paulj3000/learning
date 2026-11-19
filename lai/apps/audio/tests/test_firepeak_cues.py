"""Firepeak sound cues and the create-only seed command (design section 9)."""

import re
from io import StringIO

import pytest
from django.core.management import call_command

from apps.audio.firepeak_cues import (
    FIREPEAK_CUE_IDS,
    FIREPEAK_CUES,
    FIREPEAK_REGION_ID,
    FIREPEAK_ZONE_AMBIENCE,
)
from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.tests.helpers import audio_asset
from apps.audio.vocabulary import CUE_ID_PATTERN
from apps.regions.models import WorldRegion

DESIGN_IDS = {
    "music.firepeak.realm",
    "music.firepeak.finale",
    "ambient.firepeak.landing",
    "ambient.firepeak.forest",
    "ambient.firepeak.lava",
    "ambient.firepeak.cave",
    "ambient.firepeak.forge",
    "ambient.firepeak.summit_wind",
    "ambient.firepeak.heart",
    "sfx.firepeak.machinery",
    "sfx.firepeak.crystal_collect",
    "sfx.firepeak.switch",
    "sfx.firepeak.puzzle_complete",
    "sfx.firepeak.checkpoint",
    "sfx.firepeak.lava_respawn",
    "sfx.firepeak.rock_rumble",
    "sfx.firepeak.restore",
    "sfx.firepeak.complete",
    "voice.firepeak.npc_greet",
}
ZONES = {
    "explorers-landing",
    "emberwood-forest",
    "lava-crossing",
    "crystal-caverns",
    "ancient-forge",
    "firepeak-summit",
    "heart-chamber",
}


pytestmark = pytest.mark.django_db


def run(*args):
    out = StringIO()
    call_command("seed_firepeak_sound", *args, stdout=out)
    return out.getvalue()


def test_every_design_cue_is_present_valid_and_unique():
    ids = [spec.cue_id for spec in FIREPEAK_CUES]
    assert len(ids) == len(set(ids))
    assert set(ids) == DESIGN_IDS == set(FIREPEAK_CUE_IDS)
    for spec in FIREPEAK_CUES:
        assert re.match(CUE_ID_PATTERN, spec.cue_id)
        assert spec.cue_id.startswith(f"{spec.channel}.")


def test_loops_and_streams_suit_the_channel():
    for spec in FIREPEAK_CUES:
        if spec.channel == "ambient":
            assert spec.loop and spec.stream
        if spec.channel == "sfx":
            assert not spec.loop
    by_id = {spec.cue_id: spec for spec in FIREPEAK_CUES}
    assert by_id["music.firepeak.realm"].loop
    assert not by_id["music.firepeak.finale"].loop


def test_every_zone_has_an_ambience_cue():
    assert set(FIREPEAK_ZONE_AMBIENCE) == ZONES
    assert set(FIREPEAK_ZONE_AMBIENCE.values()) <= FIREPEAK_CUE_IDS


def _stage_all_audio():
    for spec in FIREPEAK_CUES:
        category = "music" if spec.channel in ("music", "voice") else "sound"
        audio_asset(spec.asset_id, category=category)



def test_without_audio_creates_nothing_and_without_the_area_skips_assignments():
    report = run()
    assert SoundCue.objects.count() == 0
    assert SoundAssignment.objects.count() == 0
    for spec in FIREPEAK_CUES:
        assert f"ASSET NEEDED {spec.cue_id}" in report
    assert "does not exist yet" in report



def test_creates_cues_without_the_area_and_is_idempotent():
    _stage_all_audio()
    run()
    assert set(SoundCue.objects.values_list("cue_id", flat=True)) == DESIGN_IDS
    SoundCue.objects.filter(cue_id="sfx.firepeak.checkpoint").update(volume=0.2, enabled=False)
    report = run()
    cue = SoundCue.objects.get(cue_id="sfx.firepeak.checkpoint")
    assert (cue.volume, cue.enabled) == (0.2, False)
    assert SoundCue.objects.count() == len(DESIGN_IDS)
    assert SoundAssignment.objects.count() == 0
    assert "Created 0 cue" in report
    assert SoundRelease.objects.count() == 0



def test_dry_run_writes_nothing():
    _stage_all_audio()
    assert f"Would create {len(DESIGN_IDS)} cue" in run("--dry-run")
    assert SoundCue.objects.count() == 0



def test_assignments_are_created_once_for_the_area_and_never_overwritten(treasure):
    WorldRegion.objects.filter(pk=treasure.region.pk).update(
        region_id=FIREPEAK_REGION_ID,
        scene={"layout": {"zones": [{"rect": {"id": zone}} for zone in sorted(ZONES)]}},
    )
    _stage_all_audio()
    run()
    zone_rows = SoundAssignment.objects.filter(target_type="zone")
    assert {a.target_id for a in zone_rows} == ZONES
    assert {a.target_id: a.cue.cue_id for a in zone_rows} == FIREPEAK_ZONE_AMBIENCE
    assert SoundAssignment.objects.filter(
        target_type="scope", cue__cue_id="music.firepeak.realm", event="on_enter"
    ).exists()
    SoundAssignment.objects.filter(target_id="lava-crossing").update(priority=7)
    count = SoundAssignment.objects.count()
    report = run()
    assert SoundAssignment.objects.count() == count
    assert SoundAssignment.objects.get(target_id="lava-crossing").priority == 7
    assert "Created 0 assignment" in report
    assert SoundRelease.objects.count() == 0



def test_a_zone_the_layout_does_not_declare_is_skipped_not_fatal(treasure):
    WorldRegion.objects.filter(pk=treasure.region.pk).update(region_id=FIREPEAK_REGION_ID)
    _stage_all_audio()
    report = run()
    assert "ASSIGNMENT SKIPPED" in report
    assert not SoundAssignment.objects.filter(target_type="zone").exists()
    assert SoundCue.objects.count() == len(DESIGN_IDS)


def test_only_cues_the_client_plays_are_marked_wired():
    wired = {spec.cue_id for spec in FIREPEAK_CUES if spec.wired}
    assert wired >= {
        "sfx.firepeak.crystal_collect",
        "sfx.firepeak.puzzle_complete",
        "sfx.firepeak.restore",
        "sfx.firepeak.switch",
        "sfx.firepeak.checkpoint",
        "sfx.firepeak.lava_respawn",
        "sfx.firepeak.rock_rumble",
        "sfx.firepeak.complete",
    }
    assert "sfx.firepeak.machinery" not in wired
    assert "voice.firepeak.npc_greet" not in wired
