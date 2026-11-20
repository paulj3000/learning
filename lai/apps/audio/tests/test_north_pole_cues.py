"""North Pole sound cues and the create-only seed command (design section 8)."""

import re
from io import StringIO

import pytest
from django.core.management import call_command

from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.north_pole_cues import (
    NORTH_POLE_CUE_IDS,
    NORTH_POLE_CUES,
    NORTH_POLE_REGION_ID,
    NORTH_POLE_ZONE_AMBIENCE,
)
from apps.audio.tests.helpers import audio_asset
from apps.audio.vocabulary import CUE_ID_PATTERN
from apps.regions.models import WorldRegion

DESIGN_IDS = {
    "music.north_pole.village",
    "music.north_pole.forest",
    "music.north_pole.celebration",
    "ambient.north_pole.landing",
    "ambient.north_pole.workshop",
    "ambient.north_pole.forest",
    "ambient.north_pole.lake",
    "ambient.north_pole.stables",
    "ambient.north_pole.gingerbread",
    "ambient.north_pole.mountain_wind",
    "ambient.north_pole.observatory",
    "ambient.north_pole.wind",
    "sfx.north_pole.snow_step",
    "sfx.north_pole.ice_step",
    "sfx.north_pole.collect",
    "sfx.north_pole.fragment",
    "sfx.north_pole.answer_right",
    "sfx.north_pole.answer_retry",
    "sfx.north_pole.quest_complete",
    "sfx.north_pole.checkpoint",
    "sfx.north_pole.respawn",
    "sfx.north_pole.reindeer",
    "sfx.north_pole.sleigh_bells",
    "sfx.north_pole.star_restored",
    "voice.north_pole.npc_greet",
}
ZONES = {
    "santas-landing",
    "christmas-village",
    "santas-workshop",
    "candy-cane-forest",
    "frozen-lake",
    "reindeer-stables",
    "gingerbread-village",
    "north-road",
    "snowflake-mountain",
    "north-pole-observatory",
}
#: What the client plays today (`regionAudio.ts`): everything else is `wired=False`.
WIRED = {
    "music.north_pole.village",
    "music.north_pole.celebration",
    *{cue for cue in DESIGN_IDS if cue.startswith("ambient.")},
    "sfx.north_pole.collect",
    "sfx.north_pole.answer_right",
    "sfx.north_pole.answer_retry",
    "sfx.north_pole.quest_complete",
    "sfx.north_pole.checkpoint",
    "sfx.north_pole.respawn",
}

pytestmark = pytest.mark.django_db


def run(*args):
    out = StringIO()
    call_command("seed_north_pole_sound", *args, stdout=out)
    return out.getvalue()


def test_every_design_cue_is_present_valid_and_unique():
    ids = [spec.cue_id for spec in NORTH_POLE_CUES]
    assert len(ids) == len(set(ids))
    assert set(ids) == DESIGN_IDS == set(NORTH_POLE_CUE_IDS)
    for spec in NORTH_POLE_CUES:
        assert re.match(CUE_ID_PATTERN, spec.cue_id)
        assert spec.cue_id.startswith(f"{spec.channel}.")


def test_loops_and_streams_suit_the_channel():
    for spec in NORTH_POLE_CUES:
        if spec.channel == "ambient":
            assert spec.loop and spec.stream
        if spec.channel == "sfx":
            assert not spec.loop
    by_id = {spec.cue_id: spec for spec in NORTH_POLE_CUES}
    assert by_id["music.north_pole.village"].loop
    assert by_id["music.north_pole.forest"].loop
    assert not by_id["music.north_pole.celebration"].loop


def test_wired_flags_are_truthful():
    assert {spec.cue_id for spec in NORTH_POLE_CUES if spec.wired} == WIRED


def test_every_zone_has_an_ambience_cue():
    assert set(NORTH_POLE_ZONE_AMBIENCE) == ZONES
    assert set(NORTH_POLE_ZONE_AMBIENCE.values()) <= NORTH_POLE_CUE_IDS
    assert len(set(NORTH_POLE_ZONE_AMBIENCE.values())) == 9  # the village shares the landing bed


def test_asset_ids_are_unique_dashed_cue_ids():
    assets = [spec.asset_id for spec in NORTH_POLE_CUES]
    assert len(assets) == len(set(assets))
    assert "ambient-north-pole-mountain-wind" in assets


def _stage_all_audio():
    for spec in NORTH_POLE_CUES:
        category = "music" if spec.channel in ("music", "voice") else "sound"
        audio_asset(spec.asset_id, category=category)


def test_without_audio_creates_nothing_and_without_the_area_skips_assignments():
    report = run()
    assert SoundCue.objects.count() == 0
    assert SoundAssignment.objects.count() == 0
    assert SoundRelease.objects.count() == 0
    for spec in NORTH_POLE_CUES:
        assert f"ASSET NEEDED {spec.cue_id}" in report
    assert "does not exist yet" in report


def test_creates_cues_without_the_area_and_is_idempotent():
    _stage_all_audio()
    run()
    assert set(SoundCue.objects.values_list("cue_id", flat=True)) == DESIGN_IDS
    SoundCue.objects.filter(cue_id="sfx.north_pole.checkpoint").update(volume=0.2, enabled=False)
    report = run()
    cue = SoundCue.objects.get(cue_id="sfx.north_pole.checkpoint")
    assert (cue.volume, cue.enabled) == (0.2, False)
    assert SoundCue.objects.count() == len(DESIGN_IDS)
    assert SoundAssignment.objects.count() == 0
    assert "Created 0 cue" in report
    assert SoundRelease.objects.count() == 0


def test_dry_run_writes_nothing():
    _stage_all_audio()
    assert f"Would create {len(DESIGN_IDS)} cue" in run("--dry-run")
    assert SoundCue.objects.count() == 0


def test_never_makes_placeholders_for_a_single_missing_asset():
    for spec in NORTH_POLE_CUES:
        if spec.cue_id != "sfx.north_pole.reindeer":
            audio_asset(spec.asset_id, category="music" if spec.channel in ("music", "voice") else "sound")
    report = run()
    assert "ASSET NEEDED sfx.north_pole.reindeer" in report
    assert not SoundCue.objects.filter(cue_id="sfx.north_pole.reindeer").exists()


def test_assignments_are_created_once_for_the_area_and_never_overwritten(treasure):
    WorldRegion.objects.filter(pk=treasure.region.pk).update(
        region_id=NORTH_POLE_REGION_ID,
        scene={"layout": {"zones": [{"rect": {"id": zone}} for zone in sorted(ZONES)]}},
    )
    _stage_all_audio()
    run()
    zone_rows = SoundAssignment.objects.filter(target_type="zone")
    assert {a.target_id for a in zone_rows} == ZONES
    assert {a.target_id: a.cue.cue_id for a in zone_rows} == NORTH_POLE_ZONE_AMBIENCE
    assert SoundAssignment.objects.filter(
        target_type="scope", cue__cue_id="music.north_pole.village", event="on_enter"
    ).exists()
    SoundAssignment.objects.filter(target_id="frozen-lake").update(priority=7)
    count = SoundAssignment.objects.count()
    report = run()
    assert SoundAssignment.objects.count() == count
    assert SoundAssignment.objects.get(target_id="frozen-lake").priority == 7
    assert "Created 0 assignment" in report
    assert SoundRelease.objects.count() == 0


def test_a_zone_the_layout_does_not_declare_is_skipped_not_fatal(treasure):
    WorldRegion.objects.filter(pk=treasure.region.pk).update(region_id=NORTH_POLE_REGION_ID)
    _stage_all_audio()
    report = run()
    assert "ASSIGNMENT SKIPPED" in report
    assert not SoundAssignment.objects.filter(target_type="zone").exists()
    assert SoundCue.objects.count() == len(DESIGN_IDS)
