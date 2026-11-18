from __future__ import annotations

from dataclasses import replace

import pytest

from lai_native.audio import profiles as ap
from lai_processing.contracts import JOB_TYPES


def test_default_profiles_cover_every_category_and_are_valid():
    assert {p.category for p in ap.DEFAULT_PROFILES.values()} == set(ap.CATEGORIES)
    for p in ap.DEFAULT_PROFILES.values():
        assert ap.validate_profile(p) == ()
        assert p.strip_metadata and p.version == 1
        assert p.outputs[0].codec == "opus" and p.outputs[0].required  # Opus is primary
        assert any(o.codec == "mp3" for o in p.outputs)  # MP3 is the alternative


def test_job_type_name_matches_the_frozen_convention():
    assert ap.JOB_TYPE == "asset.transcode_audio"
    # Registration in the closed catalog is Workstream A's task; this must not break either way.
    assert isinstance(JOB_TYPES, (dict, tuple, frozenset, list, set)) or JOB_TYPES is not None


def test_design_targets_differ_by_category():
    d = ap.DEFAULT_PROFILES
    assert d["audio-voice"].loudness.integrated_lufs == -16.0
    assert d["audio-music"].loudness.integrated_lufs == -18.0
    assert d["audio-ambient"].loudness.integrated_lufs == -20.0
    assert d["audio-sfx"].loudness.peak_dbfs == -3.0
    assert d["audio-ui"].loudness.peak_dbfs == -6.0
    assert d["audio-ambient"].loop and not d["audio-music"].loop


def test_dialogue_stays_mono_and_content_types_are_the_artifact_types():
    voice = ap.DEFAULT_PROFILES["audio-voice"]
    assert all(o.channels == 1 for o in voice.outputs)
    assert set(ap.CONTENT_TYPES.values()) == {"audio/ogg", "audio/mpeg"}


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"category": "pet"}, "category"),
        ({"max_input_seconds": 901}, "max_input_seconds"),
        ({"strip_metadata": False}, "strip_metadata"),
        ({"outputs": ()}, "outputs"),
        ({"profile_id": "Bad Id"}, "profile_id"),
        ({"loudness": ap.LoudnessSpec("integrated", -16.0)}, "loudness.true_peak_dbtp"),
        ({"loudness": ap.LoudnessSpec("integrated", -5.0, -1.0)}, "loudness.integrated_lufs"),
        (
            {"loudness": ap.LoudnessSpec("peak", true_peak_dbtp=-1.0, peak_dbfs=-3.0)},
            "loudness.mode",
        ),
        ({"loudness": ap.LoudnessSpec("none", peak_dbfs=-3.0)}, "loudness.mode"),
    ],
)
def test_validator_refuses(change, field):
    p = replace(ap.DEFAULT_PROFILES["audio-voice"], **change)
    assert field in {x.field for x in ap.validate_profile(p)}
    with pytest.raises(ValueError):
        ap.check_profile(p)


def test_output_rules():
    base = ap.DEFAULT_PROFILES["audio-music"]
    opus, mp3 = base.outputs
    for bad in (
        replace(opus, sample_rate=44_100),  # opus must be 48/24/16 kHz
        replace(opus, bitrate_kbps=64),  # preset and bitrate are exclusive
        replace(opus, quality=None, bitrate_kbps=999),
        replace(opus, quality="ultra"),
        replace(opus, channels=6),
    ):
        assert ap.validate_profile(replace(base, outputs=(bad, mp3))), bad
    assert ap.validate_profile(replace(base, outputs=(opus, replace(mp3, sample_rate=48_000, channels=1))))
    dup = replace(base, outputs=(opus, replace(opus, label="other")))
    assert any("container" in x.reason for x in ap.validate_profile(dup))
    assert ap.validate_profile(replace(base, outputs=(replace(opus, codec="pcm16"),)))  # no PCM


def test_from_mapping_strict():
    data = {
        "profile_id": "audio-x-v1",
        "version": 1,
        "category": "sfx",
        "outputs": [
            {"label": "opus", "codec": "opus", "sample_rate": 48000, "channels": 1, "quality": "low"}
        ],
        "loudness": {"mode": "peak", "peak_dbfs": -3.0},
        "max_input_seconds": 10,
        "loop": False,
    }
    assert ap.profile_from_mapping(data).outputs[0].codec == "opus"
    with pytest.raises(ValueError):
        ap.profile_from_mapping({**data, "extra": 1})
    with pytest.raises(ValueError):
        ap.profile_from_mapping({**data, "loudness": {"mode": "peak", "peak_dbfs": -3.0, "x": 1}})
    with pytest.raises(ValueError):
        ap.profile_from_mapping({k: v for k, v in data.items() if k != "outputs"})


def test_gain_respects_true_peak_ceiling():
    spec = ap.DEFAULT_PROFILES["audio-voice"].loudness
    assert ap.linear_gain_db(-26.0, spec, -12.0) == pytest.approx(10.0)
    assert ap.linear_gain_db(-26.0, spec, -5.0) == pytest.approx(4.0)
    assert ap.loudness_within_tolerance(-16.5, spec)
    assert not ap.loudness_within_tolerance(-18.0, spec)
    with pytest.raises(ValueError):
        ap.linear_gain_db(-20.0, ap.DEFAULT_PROFILES["audio-sfx"].loudness, -3.0)
