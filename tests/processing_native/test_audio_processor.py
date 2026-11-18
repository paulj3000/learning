"""The transcode processor with a fake FFmpeg runner: sequencing, gain, retries, error mapping."""

from __future__ import annotations

import re
from dataclasses import replace

import pytest

import audio_builder as ab
from audio_synth import ogg_opus_tagged
from lai_native.audio import processor as proc
from lai_native.audio.profiles import DEFAULT_PROFILES, LoudnessSpec
from lai_native.runtime import NativeToolError, ToolResult, ToolSpec

TOOL = ToolSpec("ffmpeg", "/opt/bin/ffmpeg", sha256="a" * 64)


def loudnorm_text(i, tp, lra=2.0):
    return (
        f'[Parsed_loudnorm_1 @ 0x1]\n{{\n"input_i" : "{i}",\n"input_tp" : "{tp}",\n'
        f'"input_lra" : "{lra}",\n"input_thresh" : "-40.0",\n"target_offset" : "0.1"\n}}\n'
    ).encode()


def ebur_text(i, lra, sample, true):
    return (
        "[Parsed_ebur128_1 @ 0x1] Summary:\n\n  Integrated loudness:\n"
        f"    I:         {i} LUFS\n    Threshold: -30.0 LUFS\n\n  Loudness range:\n"
        f"    LRA:         {lra} LU\n\n  Sample peak:\n    Peak:       {sample} dBFS\n\n"
        f"  True peak:\n    Peak:       {true} dBFS\n"
    ).encode()


class FakeFfmpeg:
    """Stands in for `run_tool`: answers by looking at the argv the processor built."""

    def __init__(self, *, before=(-30.0, -20.0, 2.0), after=None, after_seq=None, fail=None,
                 out_bytes=None, version="7.1.5", seconds=6.0):
        self.seconds = seconds
        self.before = before
        self.after = after or [(-18.0, 2.0, -12.0, -12.0)]
        self.after_seq = list(after_seq or [])
        self.fail = fail or {}
        self.out_bytes = out_bytes
        self.version = version
        self.calls: list[list[str]] = []

    def __call__(self, tool, args, ws, limits, *, deadline=None, cancelled=None):
        assert tool is TOOL and "-hide_banner" in args
        self.calls.append(list(args))
        if "-version" in args:
            return ToolResult(0, f"ffmpeg version {self.version} Copyright".encode(), b"", False, 0, 1)
        kind = self._kind(args)
        if kind in self.fail:
            exc = self.fail[kind]
            if isinstance(exc, NativeToolError):
                raise exc
            return ToolResult(exc, b"", b"boom /secret/path", False, 0.1, 1)
        if kind == "loudnorm":
            return ToolResult(0, b"", loudnorm_text(self.before[0], self.before[1], self.before[2]), False, 0.1, 5)
        if kind == "before":
            return ToolResult(0, b"", ebur_text(self.before[0], 0.0, self.before[1] - 1, self.before[1]), False, 0.1, 5)
        if kind == "encode":
            out = args[-1]
            if "libopus" in args:
                data = self.out_bytes or ogg_opus_tagged(seconds=self.seconds, channels=self._channels(args))
            else:
                data = self.out_bytes or ab.mp3_cbr(frames=int(self.seconds / 0.026122), kbps=128, tag=False)
            with open(out, "wb") as handle:
                handle.write(data)
            return ToolResult(0, b"", b"", False, 0.2, 9)
        values = self.after_seq.pop(0) if self.after_seq else self.after[0]
        return ToolResult(0, b"", ebur_text(*values), False, 0.1, 5)

    @staticmethod
    def _kind(args):
        af = args[args.index("-af") + 1] if "-af" in args else ""
        if "-c:a" in args:
            return "encode"
        if "loudnorm" in af:
            return "loudnorm"
        path = args[args.index("-i") + 1]
        return "after" if "/out-" in path else "before"

    @staticmethod
    def _channels(args):
        return int(args[args.index("-ac") + 1])

    def af(self, index_of_encode=0):
        encodes = [c for c in self.calls if "-c:a" in c]
        c = encodes[index_of_encode]
        return c[c.index("-af") + 1]


def transcoder(fake, **kw):
    return proc.AudioTranscoder(TOOL, runner=fake, tool_version="7.1.5", **kw)


def stereo_wav(seconds=6.0, rate=44_100):
    return ab.wav(seconds=seconds, rate=rate, channels=2)


def only(profile_id, label="opus"):
    p = DEFAULT_PROFILES[profile_id]
    return replace(p, outputs=tuple(o for o in p.outputs if o.label == label))


def test_integrated_profile_runs_measure_encode_measure_for_each_output():
    fake = FakeFfmpeg(after=[(-18.1, 3.0, -12.0, -11.9)])
    out = transcoder(fake).transcode(stereo_wav(), DEFAULT_PROFILES["audio-music"])
    kinds = [FakeFfmpeg._kind(c) for c in fake.calls]
    assert kinds == ["loudnorm", "encode", "after", "loudnorm", "encode", "after"]
    assert [o.label for o in out.outputs] == ["opus", "mp3"]
    assert out.outputs[0].content_type == "audio/ogg" and out.outputs[1].content_type == "audio/mpeg"
    # One linear gain: target -18 minus measured -30.
    assert fake.af() .endswith("volume=12dB") and "alimiter" not in fake.af()
    assert out.facts["gain_db"] == {"opus": 12.0, "mp3": 12.0}
    assert out.facts["measured_before"]["opus"]["integrated_lufs"] == -30.0
    assert out.outputs[0].facts["measured_after"]["integrated_lufs"] == -18.1
    assert out.facts["tool"] == {
        "name": "ffmpeg", "version": "7.1.5", "license_class": "lgpl", "binary_sha256": "a" * 64
    }
    assert out.facts["source"]["format"] == "wav" and len(out.facts["source"]["sha256"]) == 64
    assert out.findings == []


def test_every_command_is_restricted_and_create_only():
    fake = FakeFfmpeg()
    transcoder(fake).transcode(stereo_wav(), DEFAULT_PROFILES["audio-music"])
    for call in fake.calls:
        if call[-1] == "-" or "-c:a" in call:
            assert call[call.index("-protocol_whitelist") + 1] == "file"
            assert "-n" in call and "-nostdin" in call and "-y" not in call
            assert call[call.index("-f") + 1] in {"wav", "mp3", "ogg"}
            assert call[call.index("-map") + 1] == "0:a:0"


def test_true_peak_headroom_shortfall_uses_the_limiter():
    fake = FakeFfmpeg(before=(-30.0, -3.0, 2.0), after=[(-18.0, 2.0, -3.0, -2.0)])
    out = transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert "alimiter=limit=" in fake.af()
    assert {"code": "true_peak_limited", "severity": "info", "label": "opus"} in out.facts["findings"]


def test_short_clip_is_peak_normalised_not_loudness_normalised():
    fake = FakeFfmpeg(before=(-70.0, -12.0, 0.0), after=[(-30.0, 0.0, -3.0, -2.6)])
    out = transcoder(fake).transcode(ab.wav(seconds=1.0, rate=44_100, channels=1), only("audio-voice"))
    kinds = [FakeFfmpeg._kind(c) for c in fake.calls]
    assert kinds[0] == "before"  # ebur128 pass, no loudnorm
    # Voice ceiling -1 dBTP minus 2 dB margin: peak target -3 dBFS from a sample peak of -13.
    assert out.facts["gain_db"]["opus"] == 10.0
    assert out.outputs[0].facts["mode"] == "peak"
    assert {"code": "short_clip_peak_normalised", "severity": "info", "label": "opus"} in out.facts["findings"]


def test_peak_profile_gain():
    fake = FakeFfmpeg(before=(-20.0, -10.0, 0.0), after=[(-15.0, 0.0, -3.0, -2.5)])
    out = transcoder(fake).transcode(ab.wav(seconds=1.0, rate=44_100, channels=1), only("audio-sfx"))
    assert out.facts["gain_db"]["opus"] == 8.0  # sample peak -11 to -3
    assert fake.af().endswith("volume=8dB")


def test_silent_source_is_refused_permanently():
    for before in ((float("-inf"), float("-inf"), 0.0), (-80.0, -70.0, 0.0)):
        fake = FakeFfmpeg(before=before)
        with pytest.raises(proc.TranscodeError) as caught:
            transcoder(fake).transcode(stereo_wav(), only("audio-music"))
        assert caught.value.code == "silent_source" and not caught.value.retryable
    fake = FakeFfmpeg(before=(-60.0, -50.0, 0.0))  # would need more than +20 dB
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "silent_source"


def test_true_peak_overshoot_retries_with_less_gain_then_succeeds():
    fake = FakeFfmpeg(after_seq=[(-17.0, 2.0, -0.2, 0.4), (-17.9, 2.0, -1.5, -1.2)])
    out = transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    encodes = [c for c in fake.calls if "-c:a" in c]
    assert len(encodes) == 2
    assert fake.af(1).endswith("alimiter=limit=0.7943:level=disabled") or "volume=" in fake.af(1)
    assert out.facts["gain_db"]["opus"] < 12.0
    codes = [f["code"] for f in out.facts["findings"]]
    assert "true_peak_retry" in codes and "true_peak_over_ceiling" not in codes


def test_persistent_overshoot_is_flagged_after_two_retries():
    fake = FakeFfmpeg(after=[(-17.0, 2.0, 0.0, 0.5)])
    out = transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert len([c for c in fake.calls if "-c:a" in c]) == 3
    codes = [f["code"] for f in out.facts["findings"]]
    assert codes.count("true_peak_retry") == 2 and "true_peak_over_ceiling" in codes


def test_loudness_miss_is_a_finding_not_a_failure():
    fake = FakeFfmpeg(after=[(-21.0, 2.0, -12.0, -11.0)])
    out = transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert {"code": "loudness_target_missed", "severity": "warning", "label": "opus"} in out.facts["findings"]


def test_optional_output_failure_does_not_fail_the_job_but_required_does():
    fake = FakeFfmpeg()
    fake.fail = {}
    calls = {"n": 0}
    original = fake.__call__

    def flaky(tool, args, ws, limits, **kw):
        if "libmp3lame" in args:
            return ToolResult(1, b"", b"x", False, 0, 1)
        return original(tool, args, ws, limits, **kw)

    out = transcoder(flaky).transcode(stereo_wav(), DEFAULT_PROFILES["audio-music"])
    assert [o.label for o in out.outputs] == ["opus"]
    assert any(f["code"] == "optional_output_failed" for f in out.facts["findings"])
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg(fail={"encode": 1})).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "encode_failed"
    del calls


@pytest.mark.parametrize(
    ("kind", "exit_code", "code"),
    [("loudnorm", 1, "decode_failed"), ("encode", 1, "encode_failed"), ("after", 1, "output_reinspection_failed")],
)
def test_tool_exit_codes_map_to_stable_error_codes(kind, exit_code, code):
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg(fail={kind: exit_code})).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == code and not caught.value.retryable
    assert "secret" not in str(caught.value)


def test_runtime_errors_keep_their_retry_class():
    err = NativeToolError("timeout")
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg(fail={"loudnorm": err})).transcode(stereo_wav(), only("audio-music"))
    assert (caught.value.code, caught.value.retryable) == ("timeout", True)
    err = NativeToolError("tool_missing")
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg(fail={"loudnorm": err})).transcode(stereo_wav(), only("audio-music"))
    assert (caught.value.code, caught.value.retryable) == ("tool_missing", False)


def test_garbage_output_fails_reinspection():
    fake = FakeFfmpeg(out_bytes=b"not audio at all" * 10)
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "output_reinspection_failed"


def test_duration_drift_is_a_warning():
    fake = FakeFfmpeg(out_bytes=ogg_opus_tagged(seconds=9.0, channels=2))
    out = transcoder(fake).transcode(stereo_wav(6.0), only("audio-music"))
    assert {"code": "duration_drift", "severity": "warning", "label": "opus"} in out.facts["findings"]


def test_loop_profiles_use_a_tighter_drift_tolerance():
    fake = FakeFfmpeg(out_bytes=ogg_opus_tagged(seconds=6.2, channels=2))
    out = transcoder(fake).transcode(stereo_wav(6.0), only("audio-ambient"))
    assert any(f["code"] == "loop_length_drift" for f in out.facts["findings"])


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "unsupported_input"),
        (b"hello world, this is not audio", "unsupported_input"),
        (ab.wav(seconds=0.5)[:30], "input_refused"),
        (ab.ogg_vorbis(seconds=1.0)[:50], "input_refused"),
        (ab.wav(seconds=61.0, rate=8000)[:], "input_too_long"),
        (b"fLaC" + b"\x00" * 40, "unsupported_input"),
    ],
)
def test_input_refusals_happen_before_any_tool_runs(data, code):
    fake = FakeFfmpeg()
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(fake).transcode(data, DEFAULT_PROFILES["audio-sfx"])
    assert caught.value.code == code and not caught.value.retryable
    assert fake.calls == []


def test_oversize_input_is_refused(monkeypatch):
    monkeypatch.setattr(proc, "MAX_INPUT_BYTES", 100)
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg()).transcode(ab.wav(seconds=1.0), DEFAULT_PROFILES["audio-sfx"])
    assert caught.value.code == "input_too_large"


def test_non_pcm_wav_and_non_vorbis_ogg_codecs_are_refused():
    adpcm = ab.wav(seconds=1.0, tag=2, bits=4)
    flac_ogg = b"".join(ab.ogg_stream(ab.flac_in_ogg_id(), 48_000))
    for data in (adpcm, flac_ogg):
        fake = FakeFfmpeg()
        with pytest.raises(proc.TranscodeError) as caught:
            transcoder(fake).transcode(data, DEFAULT_PROFILES["audio-sfx"])
        assert caught.value.code in {"input_refused", "unsupported_input"}
        assert fake.calls == []


def test_invalid_profile_is_refused():
    bad = replace(DEFAULT_PROFILES["audio-sfx"], loudness=LoudnessSpec("integrated"))
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg()).transcode(ab.wav(seconds=1.0), bad)
    assert caught.value.code == "profile_invalid"


def test_workspace_is_removed_after_success_and_failure(tmp_path):
    fake = FakeFfmpeg()
    tc = transcoder(fake, workspace_base=str(tmp_path))
    tc.transcode(stereo_wav(), only("audio-music"))
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(proc.TranscodeError):
        transcoder(FakeFfmpeg(fail={"encode": 1}), workspace_base=str(tmp_path)).transcode(
            stereo_wav(), only("audio-music")
        )
    assert list(tmp_path.iterdir()) == []


def test_version_is_read_once_from_the_tool():
    fake = FakeFfmpeg(version="7.1.5")
    tc = proc.AudioTranscoder(TOOL, runner=fake)
    assert tc.version() == "7.1.5" and tc.version() == "7.1.5"
    assert sum("-version" in c for c in fake.calls) == 1


# --- pure policy ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("wanted", "source", "result"),
    [(1, 1, 1), (1, 2, 1), (2, 2, 2), (2, 1, 1), (None, 2, 2), (None, 1, 1)],
)
def test_channel_policy_never_upmixes_and_keeps_dialogue_mono(wanted, source, result):
    spec = replace(DEFAULT_PROFILES["audio-music"].outputs[0], channels=wanted)
    assert proc.output_channels(spec, source) == result


def test_choose_gain_cases():
    voice = DEFAULT_PROFILES["audio-voice"]
    assert proc.choose_gain(voice, duration_seconds=10, integrated_lufs=-26, true_peak_dbtp=-12, sample_peak_dbfs=None) == ("integrated", 10.0, False)
    assert proc.choose_gain(voice, duration_seconds=10, integrated_lufs=-26, true_peak_dbtp=-5, sample_peak_dbfs=None) == ("integrated", 10.0, True)
    assert proc.choose_gain(voice, duration_seconds=2.9, integrated_lufs=-40, true_peak_dbtp=-9, sample_peak_dbfs=-10.0) == ("peak", 7.0, False)
    assert proc.choose_gain(DEFAULT_PROFILES["audio-ui"], duration_seconds=1, integrated_lufs=None, true_peak_dbtp=None, sample_peak_dbfs=-20.0) == ("peak", 14.0, False)
    # Loudening beyond the source is allowed; cutting is too (a loud source comes down).
    assert proc.choose_gain(voice, duration_seconds=10, integrated_lufs=-10, true_peak_dbtp=-1, sample_peak_dbfs=None)[1] == -6.0
