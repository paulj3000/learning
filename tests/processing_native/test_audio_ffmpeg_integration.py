"""REAL FFmpeg integration tests. Skipped unless `LAI_FFMPEG_BIN` names the built layer's ffmpeg.

    LAI_FFMPEG_BIN=/path/to/layer/bin/ffmpeg pytest tests/processing_native/test_audio_ffmpeg_integration.py

Fixtures are generated with the standard library (audio_synth). These tests run the real binary
through the real runner; nothing is mocked. They check the facts the design promises: loudness
within tolerance, true peak under the ceiling, metadata stripped, determinism, channel policy,
bounded resources, and the shape of the build (LGPL, no network protocols).
"""

from __future__ import annotations

import os
import re
from dataclasses import replace

import pytest

from audio_synth import make_wav
from lai_native.audio import processor as proc
from lai_native.audio.profiles import DEFAULT_PROFILES
from lai_native.runtime import (
    NativeToolError,
    ToolLimits,
    ToolSpec,
    Workspace,
    run_tool,
    sha256_file,
)
from lai_processing.processors.audio.facts import AudioSettings
from lai_processing.processors.audio.inspector import inspect_audio

BIN = os.environ.get("LAI_FFMPEG_BIN", "")
pytestmark = pytest.mark.skipif(
    not BIN or not os.path.isfile(BIN), reason="set LAI_FFMPEG_BIN to the built ffmpeg to run"
)


@pytest.fixture(scope="module")
def tool():
    return ToolSpec("ffmpeg", BIN, sha256=sha256_file(BIN))


@pytest.fixture(scope="module")
def tc(tool):
    return proc.AudioTranscoder(tool)


def _run(tool, args):
    with Workspace() as ws:
        return run_tool(tool, args, ws, ToolLimits(timeout_seconds=30))


def test_build_is_lgpl_and_minimal(tool):
    version = _run(tool, ["-hide_banner", "-version"]).stdout.decode()
    assert version.startswith("ffmpeg version 7.1.")
    for flag in ("--enable-gpl", "--enable-nonfree", "--enable-version3"):
        assert flag not in version
    assert "--disable-network" in version and "--enable-libopus" in version
    licence = _run(tool, ["-hide_banner", "-L"]).stdout.decode()
    assert "GNU Lesser General Public" in licence and "GNU General Public" not in licence.replace(
        "GNU Lesser General Public", ""
    )
    protocols = _run(tool, ["-hide_banner", "-protocols"]).stdout.decode()
    names = set(re.findall(r"^\s+(\w+)$", protocols, re.M))
    assert names == {"file", "pipe"}, names
    encoders = _run(tool, ["-hide_banner", "-encoders"]).stdout.decode()
    assert "libopus" in encoders and "libmp3lame" in encoders
    assert "libx264" not in encoders and "aac" not in encoders.lower().replace("libfdk_aac", "")


def test_runs_with_an_empty_environment_from_a_relocated_layer(tool):
    # Runpath is $ORIGIN-relative: the libraries load with no LD_LIBRARY_PATH at all.
    assert _run(tool, ["-hide_banner", "-version"]).returncode == 0


CASES = [
    ("audio-voice-v1", "speechlike", 6.0, 2, -20.0),
    ("audio-music-v1", "chord", 8.0, 2, -28.0),
    ("audio-ambient-v1", "noise", 8.0, 2, -30.0),
    ("audio-sfx-v1", "noise", 0.8, 1, -10.0),
    ("audio-ui-v1", "sine", 0.3, 1, -15.0),
]


@pytest.mark.parametrize(("pid", "kind", "seconds", "channels", "peak"), CASES)
def test_profile_hits_its_loudness_or_peak_target(tc, pid, kind, seconds, channels, peak):
    profile = DEFAULT_PROFILES[pid]
    data = make_wav(kind, seconds, 44_100, channels, peak)
    out = tc.transcode(data, profile)
    assert [o.label for o in out.outputs] == [o.label for o in profile.outputs]
    for o in out.outputs:
        after = o.facts["measured_after"]
        assert after["true_peak_dbtp"] <= -1.0 + 0.3, (pid, o.label, after)
        if profile.loudness.mode == "integrated":
            assert abs(after["integrated_lufs"] - profile.loudness.integrated_lufs) <= 1.0, (pid, o.label, after)
        else:
            assert abs(after["sample_peak_dbfs"] - profile.loudness.peak_dbfs) <= 1.5, (pid, o.label, after)
        assert o.facts["size_bytes"] == len(o.data) <= profile.max_output_bytes
    assert not [f for f in out.facts["findings"] if f["severity"] == "error"]


def test_outputs_are_reinspected_valid_and_metadata_free(tc):
    wav = make_wav("speechlike", 4.0, 44_100, 1, -18.0)
    # Hostile-looking metadata in the source (a RIFF LIST/INFO chunk) must not survive.
    secret = b"SECRETTITLE-should-not-appear"
    info = b"LIST" + (len(secret) + 12).to_bytes(4, "little") + b"INFOINAM" + len(secret).to_bytes(4, "little") + secret
    wav = wav[:4] + (len(wav) - 8 + len(info)).to_bytes(4, "little") + wav[8:] + info
    out = tc.transcode(wav, DEFAULT_PROFILES["audio-voice-v1"])
    for o in out.outputs:
        assert secret not in o.data
        # Only constant, source-independent encoder identifiers remain (Opus comment header,
        # LAME info tag); no ID3v2 or ID3v1 block, no title, artist or comment fields.
        assert not o.data.startswith(b"ID3") and o.data[-128:-125] != b"TAG"
        if o.codec == "opus":
            tags = o.data[o.data.index(b"OpusTags") : o.data.index(b"OpusTags") + 60]
            assert tags.count(b"=") == 1 and b"encoder=" in tags
        ins = inspect_audio(__import__("io").BytesIO(o.data), len(o.data), o.content_type, AudioSettings())
        assert not ins.report.has_errors
    assert out.outputs[0].data.startswith(b"OggS") and out.outputs[0].content_type == "audio/ogg"


def test_same_input_gives_the_same_bytes(tc):
    wav = make_wav("chord", 3.5, 44_100, 2, -24.0)
    a = tc.transcode(wav, DEFAULT_PROFILES["audio-music-v1"])
    b = tc.transcode(wav, DEFAULT_PROFILES["audio-music-v1"])
    assert [o.facts["sha256"] for o in a.outputs] == [o.facts["sha256"] for o in b.outputs]


def test_channel_policy_on_real_audio(tc):
    stereo = make_wav("speechlike", 4.0, 44_100, 2, -20.0)
    voice = tc.transcode(stereo, DEFAULT_PROFILES["audio-voice-v1"])
    assert all(o.facts["channels"] == 1 for o in voice.outputs)  # dialogue stays mono
    after = voice.outputs[0].facts["measured_after"]["integrated_lufs"]
    assert abs(after - (-16.0)) <= 1.0  # downmix is measured, not assumed
    mono_music = tc.transcode(make_wav("chord", 4.0, 44_100, 1, -24.0), DEFAULT_PROFILES["audio-music-v1"])
    assert all(o.facts["channels"] == 1 for o in mono_music.outputs)  # never upmixed


def test_mp3_and_opus_outputs_decode_back_as_inputs(tc):
    first = tc.transcode(make_wav("noise", 5.0, 44_100, 2, -26.0), DEFAULT_PROFILES["audio-ambient-v1"])
    for o in first.outputs:  # Ogg Opus in, MP3 in
        again = tc.transcode(o.data, replace(DEFAULT_PROFILES["audio-music-v1"], max_input_seconds=30))
        assert again.outputs and again.facts["source"]["format"] in {"ogg", "mp3"}


def test_loop_length_is_preserved_within_the_pre_skip_tolerance(tc):
    out = tc.transcode(make_wav("noise", 10.0, 48_000, 2, -30.0), DEFAULT_PROFILES["audio-ambient-v1"])
    for o in out.outputs:
        assert abs(o.facts["duration_seconds"] - 10.0) <= 0.06
    assert not [f for f in out.facts["findings"] if f["code"] == "loop_length_drift"]


def test_silence_and_garbage_are_refused(tc):
    with pytest.raises(proc.TranscodeError) as caught:
        tc.transcode(make_wav("silence", 3.0, 44_100, 1), DEFAULT_PROFILES["audio-voice-v1"])
    assert caught.value.code == "silent_source"
    with pytest.raises(proc.TranscodeError):
        tc.transcode(make_wav("sine", 3.0, 44_100, 1)[:60] + b"\xff" * 500, DEFAULT_PROFILES["audio-voice-v1"])


def test_real_timeout_kills_the_tool(tool):
    with Workspace() as ws:
        path = ws.write("input.wav", make_wav("noise", 120.0, 48_000, 2, -10.0))
        args = [
            "-nostdin", "-hide_banner", "-nostats", "-n", "-f", "wav", "-i", str(path),
            "-af", "loudnorm=print_format=json", "-f", "null", "-",
        ]
        with pytest.raises(NativeToolError) as caught:
            run_tool(tool, args, ws, ToolLimits(timeout_seconds=0.05))
        assert caught.value.code == "timeout"


def test_memory_limit_stops_the_real_tool(tool):
    with Workspace() as ws:
        path = ws.write("input.wav", make_wav("noise", 2.0, 48_000, 2, -10.0))
        args = ["-nostdin", "-hide_banner", "-n", "-f", "wav", "-i", str(path), "-f", "null", "-"]
        result = run_tool(tool, args, ws, ToolLimits(address_space_bytes=24 * 1024 * 1024))
        assert result.returncode != 0
