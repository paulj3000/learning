"""Command construction and bounded parsing for FFmpeg (nothing is executed)."""

from __future__ import annotations

from pathlib import Path

import pytest

from lai_native.audio import ffmpeg as ff
from lai_native.audio.profiles import DEFAULT_PROFILES

IN = Path("/tmp/j/input.wav")
OUT = Path("/tmp/j/out-opus.ogg")


def _encode(profile_id, idx=0, channels=None, gain="volume=1.5dB"):
    p = DEFAULT_PROFILES[profile_id]
    spec = p.outputs[idx]
    ch = channels or spec.channels or 1
    return ff.build_encode_args(
        IN, "wav", OUT, spec, ch, 31, gain, ff.prefix_filter(spec, ch),
        voice=p.category == "voice", max_output_bytes=p.max_output_bytes,
    )


def test_every_profile_output_builds_a_safe_argv():
    for pid, p in DEFAULT_PROFILES.items():
        for i, _o in enumerate(p.outputs):
            argv = _encode(pid, i)
            assert all(isinstance(a, str) and a and "\x00" not in a for a in argv)
            assert argv[-1] == str(OUT)
            for flag in ("-nostdin", "-n", "-vn", "-sn", "-dn"):
                assert flag in argv
            assert "-y" not in argv  # create-only
            assert argv[argv.index("-protocol_whitelist") + 1] == "file"
            assert argv[argv.index("-f") + 1] == "wav"  # explicit input format, first -f
            assert argv[argv.index("-map") + 1] == "0:a:0"
            assert argv[argv.index("-map_metadata") + 1] == "-1"
            assert argv[argv.index("-map_chapters") + 1] == "-1"
            assert argv.index("-protocol_whitelist") < argv.index("-i")
            assert argv.index("-i") < argv.index("-af") < argv.index("-fflags")
            assert argv[argv.index("-fflags") + 1] == "+bitexact"
            assert int(argv[argv.index("-fs") + 1]) <= 20 * 1024 * 1024
            assert argv[argv.index("-af") + 1].startswith("aresample=")


def test_opus_flags_voice_vs_music():
    voice = _encode("audio-voice-v1", 0)
    assert voice[voice.index("-c:a") + 1] == "libopus"
    assert voice[voice.index("-b:a") + 1] == "48k" and voice[voice.index("-application") + 1] == "voip"
    assert voice[voice.index("-ac") + 1] == "1" and voice[voice.index("-ar") + 1] == "48000"
    assert voice[-3:-1] == ["-f", "ogg"]
    music = _encode("audio-music-v1", 0, channels=2)
    assert music[music.index("-b:a") + 1] == "96k" and music[music.index("-application") + 1] == "audio"


def test_mp3_flags_cbr_vbr_and_no_tags():
    voice_mp3 = _encode("audio-voice-v1", 1)
    assert voice_mp3[voice_mp3.index("-b:a") + 1] == "64k" and "libmp3lame" in voice_mp3
    assert voice_mp3[voice_mp3.index("-id3v2_version") + 1] == "0"
    assert "-abr" not in voice_mp3
    assert voice_mp3[voice_mp3.index("-write_id3v1") + 1] == "0"
    music_mp3 = _encode("audio-music-v1", 1, channels=2)
    assert music_mp3[music_mp3.index("-q:a") + 1] == "4" and "-b:a" not in music_mp3


def test_gain_chain_is_optional():
    without = _encode("audio-voice-v1", 0, gain="")
    assert not without[without.index("-af") + 1].endswith("dB")
    with_gain = _encode("audio-voice-v1", 0, gain="volume=1.5dB")
    assert with_gain[with_gain.index("-af") + 1].endswith(",volume=1.5dB")


def test_measure_commands():
    spec = DEFAULT_PROFILES["audio-voice-v1"].outputs[0]
    prefix = ff.prefix_filter(spec, 1)
    assert prefix == "aresample=48000,aformat=sample_rates=48000:channel_layouts=mono"
    assert ff.prefix_filter(spec, 1, 2) == "aresample=48000,pan=mono|c0=0.5*c0+0.5*c1,aformat=sample_rates=48000:channel_layouts=mono"
    assert "pan" not in ff.prefix_filter(spec, 1, 1)
    ln = ff.build_measure_loudnorm_args(IN, "wav", 901, prefix, target_i=-16, target_tp=-1, target_lra=12)
    assert f"{prefix},loudnorm=I=-16:TP=-1:LRA=12:print_format=json" in ln
    assert ln[-3:] == ["-f", "null", "-"]
    eb = ff.build_measure_ebur128_args(IN, "wav", 31, prefix)
    assert any(a.endswith("ebur128=peak=sample+true:framelog=quiet") for a in eb)


@pytest.mark.parametrize("bad", [Path("relative.wav"), Path("-evil.wav")])
def test_paths_must_be_absolute(bad):
    spec = DEFAULT_PROFILES["audio-sfx-v1"].outputs[0]
    with pytest.raises(ValueError):
        ff.build_measure_ebur128_args(bad, "wav", 5, ff.prefix_filter(spec, 1))
    with pytest.raises(ValueError):
        ff.build_encode_args(IN, "wav", bad, spec, 1, 5, "", ff.prefix_filter(spec, 1), voice=False, max_output_bytes=10)


def test_input_format_is_a_closed_set():
    spec = DEFAULT_PROFILES["audio-sfx-v1"].outputs[0]
    with pytest.raises(ValueError):
        ff.build_measure_ebur128_args(IN, "flac", 5, ff.prefix_filter(spec, 1))


def test_num_formats_plain_decimals():
    assert ff.num(-3.0) == "-3" and ff.num(0.1 + 0.2) == "0.3" and ff.num(1e-9) == "0"
    with pytest.raises(ValueError):
        ff.num(float("nan"))


LOUDNORM = b"""[Parsed_loudnorm_0 @ 0x55] 
{
\t"input_i" : "-26.10",
\t"input_tp" : "-9.80",
\t"input_lra" : "1.20",
\t"input_thresh" : "-36.50",
\t"output_i" : "-16.5",
\t"normalization_type" : "linear",
\t"target_offset" : "0.30"
}
"""


def test_parse_loudnorm_json():
    m = ff.parse_loudnorm_json(b"noise {brace} before\n" + LOUDNORM)
    assert (m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset) == (
        -26.1, -9.8, 1.2, -36.5, 0.3,
    )
    assert m.normalization_type == "linear"


def test_parse_loudnorm_accepts_silence_and_refuses_garbage():
    silent = LOUDNORM.replace(b'"-26.10"', b'"-inf"')
    assert ff.parse_loudnorm_json(silent).input_i == float("-inf")
    for bad in (b"", b"{", b'{"input_i": 1}', LOUDNORM.replace(b"-9.80", b"evil;rm"), b"x" * 10 + b"{" + b"y" * 9000 + b"}"):
        with pytest.raises(ValueError):
            ff.parse_loudnorm_json(bad)


EBUR = b"""[Parsed_ebur128_0 @ 0x5] Summary:

  Integrated loudness:
    I:         -16.2 LUFS
    Threshold: -26.3 LUFS

  Loudness range:
    LRA:         3.1 LU
    Threshold: -36.3 LUFS
    LRA low:   -19.0 LUFS
    LRA high:  -15.9 LUFS

  Sample peak:
    Peak:       -3.4 dBFS

  True peak:
    Peak:       -2.9 dBFS
"""


def test_parse_ebur128_summary():
    m = ff.parse_ebur128(b"earlier chatter\n" + EBUR)
    assert (m.integrated_lufs, m.lra_lu, m.sample_peak_dbfs, m.true_peak_dbtp) == (-16.2, 3.1, -3.4, -2.9)
    assert m.as_facts()["true_peak_dbtp"] == -2.9
    silent = EBUR.replace(b"-16.2", b"-inf").replace(b"-3.4", b"-inf")
    s = ff.parse_ebur128(silent)
    assert s.integrated_lufs == float("-inf") and s.as_facts()["integrated_lufs"] is None
    with pytest.raises(ValueError):
        ff.parse_ebur128(b"no summary here")


def test_parse_version():
    assert ff.parse_version(b"ffmpeg version 7.1.5 Copyright (c)\nbuilt") == "7.1.5"
    assert ff.parse_version(b"ffmpeg version N-1234-gabc") is None
    assert ff.parse_version(b"") is None
