"""Audio transcode profile model and the offline benchmark harness (LAI-LAMBDA-008b).

No ffmpeg is needed or run: argument construction, fixture generation and the skip path only."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import wave
from dataclasses import replace
from pathlib import Path

import pytest

from lai_processing.contracts import JOB_TYPES
from lai_processing.contracts import audio_profiles as ap

REPO = Path(__file__).resolve().parents[2]


def _load_bench():
    spec = importlib.util.spec_from_file_location(
        "audio_transcode_bench", REPO / "scripts/processing/bench/audio_transcode_bench.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


bench = _load_bench()


def test_proposed_job_type_is_not_in_the_closed_catalog():
    assert ap.PROPOSED_JOB_TYPE not in JOB_TYPES


def test_default_profiles_cover_every_category_and_are_valid():
    assert {p.category for p in ap.DEFAULT_PROFILES.values()} == set(ap.CATEGORIES)
    for p in ap.DEFAULT_PROFILES.values():
        assert ap.validate_profile(p) == ()
        assert p.strip_metadata


def test_targets_differ_by_category():
    d = ap.DEFAULT_PROFILES
    assert d["audio-voice-v1"].loudness.integrated_lufs == -16.0
    assert d["audio-music-v1"].loudness.integrated_lufs == -18.0
    assert d["audio-ambient-v1"].loudness.integrated_lufs == -20.0
    assert d["audio-sfx-v1"].loudness.mode == "peak"
    assert d["audio-ui-v1"].loudness.peak_dbfs < d["audio-sfx-v1"].loudness.peak_dbfs


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
    p = replace(ap.DEFAULT_PROFILES["audio-voice-v1"], **change)
    assert field in {x.field for x in ap.validate_profile(p)}
    with pytest.raises(ValueError):
        ap.check_profile(p)


def test_output_rules():
    base = ap.DEFAULT_PROFILES["audio-music-v1"]
    opus = base.outputs[0]
    cases = [
        replace(opus, sample_rate=44_100),  # opus must be 48/24/16 kHz
        replace(opus, bitrate_kbps=64),  # preset and bitrate are exclusive
        replace(opus, quality=None, bitrate_kbps=999),
        replace(opus, quality="ultra"),
        replace(opus, channels=6),
        replace(base.outputs[1], sample_rate=48_000, channels=1),
    ]
    for bad in cases:
        p = replace(
            base, outputs=(bad, base.outputs[1]) if bad is not base.outputs[1] else (opus, bad)
        )
        assert ap.validate_profile(p), bad
    dup = replace(base, outputs=(opus, replace(opus, label="other")))
    assert any("container" in x.reason for x in ap.validate_profile(dup))
    pcm = replace(base, outputs=(ap.OutputSpec("wav", "pcm16", 48_000, 1),))
    assert any("pcm16" in x.reason for x in ap.validate_profile(pcm))  # music is not a short clip


def test_from_mapping_strict():
    data = {
        "profile_id": "audio-x-v1",
        "version": 1,
        "category": "sfx",
        "outputs": [
            {
                "label": "opus",
                "codec": "opus",
                "sample_rate": 48000,
                "channels": 1,
                "quality": "low",
            }
        ],
        "loudness": {"mode": "peak", "peak_dbfs": -3.0},
        "max_input_seconds": 10,
    }
    assert ap.profile_from_mapping(data).outputs[0].codec == "opus"
    with pytest.raises(ValueError):
        ap.profile_from_mapping({**data, "extra": 1})
    with pytest.raises(ValueError):
        ap.profile_from_mapping({**data, "loudness": {"mode": "peak", "peak_dbfs": -3.0, "x": 1}})
    with pytest.raises(ValueError):
        ap.profile_from_mapping({k: v for k, v in data.items() if k != "outputs"})


def test_gain_respects_true_peak_ceiling():
    spec = ap.DEFAULT_PROFILES["audio-voice-v1"].loudness
    assert ap.linear_gain_db(-26.0, spec, -12.0) == pytest.approx(10.0)
    assert ap.linear_gain_db(-26.0, spec, -5.0) == pytest.approx(4.0)  # peak limits the gain
    assert ap.loudness_within_tolerance(-16.5, spec)
    assert not ap.loudness_within_tolerance(-18.0, spec)
    with pytest.raises(ValueError):
        ap.linear_gain_db(-20.0, ap.DEFAULT_PROFILES["audio-sfx-v1"].loudness, -3.0)


# --- bench harness --------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["sine", "chord", "speechlike", "noise"])
def test_fixture_is_a_valid_deterministic_wav(kind):
    a = bench.generate_wav(kind, 1, 8_000, 2)
    assert a == bench.generate_wav(kind, 1, 8_000, 2)
    with wave.open(io.BytesIO(a)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (
            2,
            2,
            8_000,
            8_000,
        )
        pcm = w.readframes(w.getnframes())
    assert any(pcm)
    samples = memoryview(pcm).cast("h")
    assert max(abs(s) for s in samples) < 32768


def test_noise_is_quiet_and_seeded():
    pcm = memoryview(
        wave.open(io.BytesIO(bench.generate_wav("noise", 1, 8_000, 1))).readframes(8_000)
    ).cast("h")
    assert max(abs(s) for s in pcm) <= 1100
    assert bench.generate_wav("noise", 1, 8_000, 1, seed=1) != bench.generate_wav(
        "noise", 1, 8_000, 1, seed=2
    )


@pytest.mark.parametrize(
    "args", [("pet", 1, 8000, 1), ("sine", 0, 8000, 1), ("sine", 1, 4000, 1), ("sine", 1, 8000, 6)]
)
def test_fixture_limits(args):
    with pytest.raises(ValueError):
        bench.generate_wav(*args)


def test_every_case_uses_a_known_profile_and_stays_in_limits():
    for _label, pid, _kind, seconds, rate, ch in bench.CASES:
        assert pid in ap.DEFAULT_PROFILES
        assert seconds * rate * ch * 2 <= bench.MAX_UPLOAD_BYTES


def _encode(profile_id, idx=0, gain="volume=1.00dB"):
    p = ap.DEFAULT_PROFILES[profile_id]
    return bench.build_encode_argv(
        "/opt/ffmpeg", "/tmp/j/in.wav", "wav", "/tmp/j/out.bin", p.outputs[idx], p, gain
    )


def test_encode_argv_is_a_safe_list():
    for pid, p in ap.DEFAULT_PROFILES.items():
        for i, _out in enumerate(p.outputs):
            argv = _encode(pid, i)
            assert all(isinstance(a, str) for a in argv)
            assert argv[0] == "/opt/ffmpeg" and argv[-1] == "/tmp/j/out.bin"
            for flag in ("-nostdin", "-n", "-vn", "-sn", "-dn"):
                assert flag in argv
            assert argv[argv.index("-protocol_whitelist") + 1] == "file"
            assert argv[argv.index("-map_metadata") + 1] == "-1"
            assert argv[argv.index("-map_chapters") + 1] == "-1"
            assert argv[argv.index("-f") + 1] == "wav"  # explicit input format first
            assert int(argv[argv.index("-t") + 1]) == p.max_input_seconds
            assert int(argv[argv.index("-fs") + 1]) <= 20 * 1024 * 1024
            assert argv.index("-i") < argv.index("-map")
            assert not any(" " in a and not a.startswith("volume") for a in argv[1:-1])


def test_codec_flags():
    voice = _encode("audio-voice-v1", 0)
    assert voice[voice.index("-c:a") + 1] == "libopus"
    assert voice[voice.index("-b:a") + 1] == "48k" and "voip" in voice
    assert voice[voice.index("-ac") + 1] == "1" and voice[voice.index("-ar") + 1] == "48000"
    mp3 = _encode("audio-voice-v1", 1)
    assert "libmp3lame" in mp3 and mp3[mp3.index("-b:a") + 1] == "64k"
    assert mp3[mp3.index("-write_id3v2") + 1] == "0"
    music_mp3 = _encode("audio-music-v1", 1)
    assert music_mp3[music_mp3.index("-q:a") + 1] == "4" and "-b:a" not in music_mp3
    wav = _encode("audio-ui-v1", 1)
    assert "pcm_s16le" in wav and wav[wav.index("-rf64") + 1] == "never"


def test_no_gain_filter_when_none():
    assert "-af" not in _encode("audio-voice-v1", 0, gain=None)


@pytest.mark.parametrize("bad", ["relative.wav", "-evil.wav"])
def test_paths_must_be_absolute(bad):
    p = ap.DEFAULT_PROFILES["audio-sfx-v1"]
    with pytest.raises(ValueError):
        bench.build_encode_argv("/opt/ffmpeg", bad, "wav", "/tmp/o", p.outputs[0], p, None)
    with pytest.raises(ValueError):
        bench.build_encode_argv("/opt/ffmpeg", "/tmp/i", "wav", bad, p.outputs[0], p, None)


def test_input_format_must_be_sniffed():
    with pytest.raises(ValueError):
        bench.build_measure_argv(
            "/f", "/tmp/i", "flac", ap.LoudnessSpec("peak", peak_dbfs=-3.0), 10
        )


def test_measure_argv_and_parsing():
    voice = ap.DEFAULT_PROFILES["audio-voice-v1"].loudness
    argv = bench.build_measure_argv("/f", "/tmp/i", "wav", voice, 900)
    assert "loudnorm=I=-16.0:TP=-1.0:LRA=12.0:print_format=json" in argv
    assert argv[-3:] == ["-f", "null", "-"]
    err = 'noise\n{\n "input_i" : "-26.10",\n "input_tp" : "-9.80"\n}\n'
    m = bench.parse_measure(err, voice)
    assert m == {"input_i": -26.1, "input_tp": -9.8}
    assert bench.gain_filter(voice, m) == "volume=8.80dB"  # the true-peak ceiling limits the gain
    sfx = ap.DEFAULT_PROFILES["audio-sfx-v1"].loudness
    assert bench.build_measure_argv("/f", "/tmp/i", "wav", sfx, 30)[-4] == "volumedetect"
    assert bench.parse_measure("x\n max_volume: -7.5 dB\n", sfx) == {"max_volume": -7.5}
    assert bench.gain_filter(sfx, {"max_volume": -7.5}) == "volume=4.50dB"
    with pytest.raises(ValueError):
        bench.build_measure_argv("/f", "/tmp/i", "wav", ap.LoudnessSpec("none"), 10)


def test_bench_skips_cleanly_without_ffmpeg(monkeypatch, capsys):
    monkeypatch.setattr(bench.shutil, "which", lambda _name: None)
    assert bench.main(["--run"]) == 0
    assert "skipped" in json.loads(capsys.readouterr().out)


def test_bench_plan_runs_nothing(capsys):
    assert bench.main([]) == 0
    assert json.loads(capsys.readouterr().out)["plan"]
