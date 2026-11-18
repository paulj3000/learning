"""Fixes from the independent native-execution review (F1 to F15, SEC-5): shared runtime and
audio processor behaviour, with stub executables and a fake FFmpeg (no real binary needed)."""

from __future__ import annotations

import os
import signal
import sys
import time
from dataclasses import replace
from pathlib import Path

import pytest

import audio_builder as ab
from audio_synth import ogg_opus_tagged, opus_tags
from lai_native.audio import engine as audio_engine
from lai_native.audio import ffmpeg as ff
from lai_native.audio import processor as proc
from lai_native.audio import tags
from lai_native.audio.profiles import DEFAULT_PROFILES
from lai_native.runtime import (
    Deadline,
    NativeToolError,
    ToolLimits,
    ToolResult,
    ToolSpec,
    Workspace,
    run_tool,
    sweep_stale,
)
from test_audio_processor import TOOL, FakeFfmpeg, ebur_text, loudnorm_text, only, stereo_wav, transcoder
from test_native_runtime import stub

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture
def ws():
    with Workspace() as workspace:
        yield workspace


# --- runtime: F6 tail, F10 cpu, F11 process group, F15 recursive size, F8 sweep ----------------------


def test_stderr_keeps_the_tail_not_the_head(tmp_path, ws):
    spec = stub(
        tmp_path,
        """
        import sys
        sys.stderr.write("HEAD-TAG " + "x" * 400000 + " THE-REAL-SUMMARY")
        """,
    )
    result = run_tool(spec, [], ws, ToolLimits(max_stderr_bytes=4096))
    assert result.stderr_truncated and len(result.stderr) == 4096
    assert result.stderr.endswith(b"THE-REAL-SUMMARY") and b"HEAD-TAG" not in result.stderr


def test_soft_cpu_limit_raises_sigxcpu_and_maps_to_a_permanent_resource_limit(tmp_path, ws):
    spec = stub(tmp_path, "while True:\n    pass")
    started = time.monotonic()
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(cpu_seconds=2, timeout_seconds=20))
    assert caught.value.code == "resource_limit" and not caught.value.retryable
    assert time.monotonic() - started < 10


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # a zombie is dead for our purposes
        return Path(f"/proc/{pid}/stat").read_text().split()[2] != "Z"
    except OSError:
        return False


def test_a_grandchild_is_killed_with_the_process_group_on_timeout(tmp_path, ws):
    marker = tmp_path / "grandchild.pid"
    spec = stub(
        tmp_path,
        f"""
        import os, subprocess, sys, time
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        open({str(marker)!r}, "w").write(str(child.pid))
        time.sleep(60)
        """,
    )
    with pytest.raises(NativeToolError):
        run_tool(spec, [], ws, ToolLimits(timeout_seconds=1.0))
    pid = int(marker.read_text())
    for _ in range(50):
        if not pid_alive(pid):
            break
        time.sleep(0.1)
    assert not pid_alive(pid)


def test_a_grandchild_left_behind_by_a_finished_tool_is_killed_too(tmp_path, ws):
    marker = tmp_path / "orphan.pid"
    spec = stub(
        tmp_path,
        f"""
        import subprocess, sys
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        open({str(marker)!r}, "w").write(str(child.pid))
        """,
    )
    assert run_tool(spec, [], ws, ToolLimits(timeout_seconds=10)).returncode == 0
    pid = int(marker.read_text())
    for _ in range(50):
        if not pid_alive(pid):
            break
        time.sleep(0.1)
    assert not pid_alive(pid)


def test_the_runner_never_signals_a_bare_pid():
    source = (REPO / "processing/lai_native/runtime/runner.py").read_text()
    assert "os.kill(" not in source and "os.killpg(" in source


def test_used_bytes_counts_subdirectories_and_ignores_symlinks(ws):
    (ws.root / "sub" / "deep").mkdir(parents=True)
    (ws.root / "sub" / "deep" / "hidden.bin").write_bytes(b"x" * 1000)
    (ws.root / "top.bin").write_bytes(b"y" * 10)
    os.symlink("/etc/hostname", ws.root / "link")
    assert ws.used_bytes() == 1010


def test_a_tool_cannot_hide_output_in_a_subdirectory(tmp_path, ws):
    spec = stub(
        tmp_path,
        """
        import os, time
        os.makedirs("d")
        with open("d/big", "wb") as f:
            for _ in range(200):
                f.write(b"0" * 100000); f.flush(); time.sleep(0.01)
        """,
    )
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(max_workspace_bytes=500_000, timeout_seconds=20))
    assert caught.value.code == "output_too_large"


def test_sweep_stale_removes_only_our_leftover_workspaces(tmp_path):
    for name in ("lai-native-abc", "lai-proc-def"):
        (tmp_path / name / "inner").mkdir(parents=True)
        (tmp_path / name / "inner" / "f").write_bytes(b"1")
    keep = tmp_path / "other-dir"
    keep.mkdir()
    (tmp_path / "lai-native-file").write_text("not a directory")
    assert sweep_stale(tmp_path) == 2
    assert sorted(p.name for p in tmp_path.iterdir()) == ["lai-native-file", "other-dir"]
    assert sweep_stale(tmp_path / "missing") == 0


# --- F1: the Lambda deadline reaches the runner ------------------------------------------------------


def test_engine_limit_is_inside_the_lambda_timeout():
    assert audio_engine.AUDIO_TRANSCODE_LIMITS.max_execution_seconds == 240 < 300


def test_the_runner_deadline_is_the_earlier_of_engine_budget_and_lambda_time():
    seen = {}

    def runner(tool, args, ws, limits, *, deadline=None, cancelled=None):
        seen["left"] = deadline.seconds_left()
        return FakeFfmpeg()(tool, args, ws, limits, deadline=deadline, cancelled=cancelled)

    processor = audio_engine.AudioTranscodeProcessor(TOOL, runner=runner, tool_version="7.1.5")

    class Clock:
        def monotonic(self):
            return 100.0

    context = type(
        "Ctx",
        (),
        {
            "deadline": 100.0 + 200.0,
            "clock": Clock(),
            "cancellation": type("C", (), {"cancelled": False})(),
            "input_path": None,
            "profile": type("P", (), {"profile_id": "audio-music", "version": 1})(),
            "options": {},
        },
    )()
    # Drive just the deadline construction through process() by faking the input read.
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
        handle.write(stereo_wav())
        handle.flush()
        context.input_path = Path(handle.name)
        context.check = lambda: None
        context.write_artifact = lambda **kw: None
        processor.set_time_source(lambda: 30_000.0)  # Lambda has 30 s left, the engine 200 s
        processor.process(context)
    assert 27.0 < seen["left"] <= 28.0  # 30 s minus the 2 s reserve
    processor.set_time_source(None)


def test_a_nearly_expired_invocation_fails_with_a_retryable_deadline_code():
    fake = FakeFfmpeg()

    def runner(tool, args, ws, limits, *, deadline=None, cancelled=None):
        return run_tool(ToolSpec("x", "/bin/true"), [], ws, limits, deadline=deadline)

    tc = proc.AudioTranscoder(TOOL, runner=runner, tool_version="7.1.5")
    with pytest.raises(proc.TranscodeError) as caught:
        tc.transcode(stereo_wav(), only("audio-music"), deadline=Deadline(lambda: 3000, 5.0))
    assert (caught.value.code, caught.value.retryable) == ("deadline_exceeded", True)
    assert fake.calls == []


# --- F2, F3: error mapping and degradation -----------------------------------------------------------


def test_workspace_failures_become_transcode_errors_with_their_retry_class(monkeypatch):
    def boom(*args, **kwargs):
        raise NativeToolError("workspace_error")

    monkeypatch.setattr(proc, "Workspace", boom)
    tc = proc.AudioTranscoder(TOOL, runner=FakeFfmpeg(), tool_version="7.1.5")
    with pytest.raises(proc.TranscodeError) as caught:
        tc.transcode(stereo_wav(), only("audio-music"))
    assert (caught.value.code, caught.value.retryable) == ("workspace_error", True)
    tc = proc.AudioTranscoder(TOOL, runner=FakeFfmpeg())  # version() must also map
    with pytest.raises(proc.TranscodeError) as caught:
        tc.version()
    assert caught.value.code == "workspace_error" and caught.value.retryable


def test_a_read_failure_inside_the_workspace_is_mapped_not_unexpected(monkeypatch):
    original = Workspace.read

    def read(self, name, max_bytes):
        if name.startswith("out-"):
            raise NativeToolError("workspace_error")
        return original(self, name, max_bytes)

    monkeypatch.setattr(Workspace, "read", read)
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg()).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "workspace_error" and caught.value.retryable


def test_the_tool_version_is_read_before_any_encode():
    fake = FakeFfmpeg(fail={"loudnorm": 1})
    calls = []

    def runner(tool, args, ws, limits, **kw):
        calls.append(list(args))
        if "-version" in args:
            raise NativeToolError("spawn_failed")
        return fake(tool, args, ws, limits, **kw)

    tc = proc.AudioTranscoder(TOOL, runner=runner)  # no configured version
    with pytest.raises(proc.TranscodeError) as caught:
        tc.transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "spawn_failed" and len(calls) == 1  # nothing was encoded


def test_an_output_cut_off_at_the_size_limit_is_refused():
    profile = replace(DEFAULT_PROFILES["audio-music"], max_output_bytes=5000)
    profile = replace(profile, outputs=(profile.outputs[0],))
    big = ogg_opus_tagged(seconds=6.0, channels=2) + b"\x00" * 1000
    fake = FakeFfmpeg(out_bytes=big)
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(fake).transcode(stereo_wav(), profile)
    assert caught.value.code == "output_too_large"


@pytest.mark.parametrize("code", ["deadline_exceeded", "timeout", "tool_crashed", "spawn_failed", "workspace_error"])
def test_an_optional_output_runtime_failure_fails_the_job_retryably(code):
    original = FakeFfmpeg()

    def runner(tool, args, ws, limits, **kw):
        if "libmp3lame" in args:
            raise NativeToolError(code)
        return original(tool, args, ws, limits, **kw)

    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(runner).transcode(stereo_wav(), DEFAULT_PROFILES["audio-music"])
    assert caught.value.code == code and caught.value.retryable


@pytest.mark.parametrize("code", ["encode_failed", "output_reinspection_failed", "measure_failed"])
def test_an_optional_output_input_or_encode_problem_degrades_to_a_finding(code):
    assert code in proc.DEGRADABLE
    assert not {"deadline_exceeded", "timeout", "tool_crashed", "spawn_failed", "workspace_error"} & proc.DEGRADABLE


# --- F6: logs are parsed by anchor, never from a tag -------------------------------------------------


def test_loudnorm_json_ignores_a_tag_that_imitates_the_block():
    forged = (
        b'    title : [Parsed_loudnorm_9 @ 0x1] {"input_i":"-1.0","input_tp":"-1.0","input_lra":"1",'
        b'"input_thresh":"-1","target_offset":"0"}\n'
    )
    real = loudnorm_text(-26.1, -9.8, 1.2)
    parsed = ff.parse_loudnorm_json(forged + b"more chatter\n" + real)
    assert (parsed.input_i, parsed.input_tp) == (-26.1, -9.8)
    with pytest.raises(ValueError):
        ff.parse_loudnorm_json(b'title : {"input_i": "-3"}\n')  # no loudnorm block at all


def test_ebur128_summary_must_be_a_filter_log_line():
    forged = b"    comment : Summary:\n  Integrated loudness:\n    I:   -1.0 LUFS\n"
    real = ebur_text(-16.2, 3.1, -3.4, -2.9)
    assert ff.parse_ebur128(forged + real).integrated_lufs == -16.2
    with pytest.raises(ValueError):
        ff.parse_ebur128(forged)


def test_a_truncated_log_fails_the_measurement():
    original = FakeFfmpeg()

    def runner(tool, args, ws, limits, **kw):
        result = original(tool, args, ws, limits, **kw)
        if "loudnorm" in (args[args.index("-af") + 1] if "-af" in args else ""):
            return ToolResult(result.returncode, b"", result.stderr, True, 0.1, 1)
        return result

    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(runner).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "measure_failed"


# --- F7, F15 audio items, SEC-5 ----------------------------------------------------------------------


def test_the_limiter_compensates_its_look_ahead_delay():
    chain = proc._gain_chain(6.0, -1.0)  # noqa: SLF001
    assert "alimiter=" in chain and chain.endswith(":latency=1")


def test_integrated_profiles_flag_a_clipping_source_from_the_true_peak():
    fake = FakeFfmpeg(before=(-30.0, 0.2, 2.0), after=[(-18.1, 2.0, -12.0, -11.5)])
    out = transcoder(fake).transcode(stereo_wav(), only("audio-music"))
    assert {"code": "clipping_in_source", "severity": "warning", "label": "opus"} in out.facts["findings"]


def test_metadata_flags_are_in_every_command():
    spec = DEFAULT_PROFILES["audio-music"].outputs[0]
    args = ff.build_encode_args(
        Path("/tmp/i.wav"), "wav", Path("/tmp/o.ogg"), spec, 2, 31, "volume=1dB",
        ff.prefix_filter(spec, 2), voice=False, max_output_bytes=1000,
    )
    assert args[args.index("-map_metadata:s:a") + 1] == "-1" and args[args.index("-map_metadata") + 1] == "-1"


def test_tag_verifier_accepts_ffmpegs_own_strings_and_refuses_everything_else():
    assert tags.verify(ogg_opus_tagged(), "ogg") == []
    assert tags.verify(ogg_opus_tagged(tags=opus_tags(comments=())), "ogg") == []
    bad_title = ogg_opus_tagged(tags=opus_tags(comments=(b"encoder=Lavc libopus", b"TITLE=Secret")))
    assert tags.verify(bad_title, "ogg") == ["opus_comment_unexpected"]
    assert tags.verify(ogg_opus_tagged(tags=opus_tags(vendor=b"Mallory's tagger")), "ogg") == [
        "opus_vendor_unexpected"
    ]
    assert tags.verify(ogg_opus_tagged(tags=opus_tags(comments=(b"ARTIST=x",))), "ogg")
    assert tags.verify(b"OggS" + b"\x00" * 40, "ogg")  # no tags packet at all
    assert tags.verify(ab.ogg_opus(), "ogg") == ["opus_tags_missing"]
    broken = ogg_opus_tagged(tags=b"OpusTags\xff\xff\xff\xff")
    assert tags.verify(broken, "ogg")


def mp3_with_xing(encoder: bytes) -> bytes:
    flags = (0b1111).to_bytes(4, "big")
    block = b"Xing" + flags + b"\x00" * (4 + 4 + 100 + 4)
    frame = bytes([0xFF, 0xFB, 0x90, 0x00]) + b"\x00" * 32 + block + encoder.ljust(9, b"\x00") + b"\x00" * 200
    return frame + ab.mp3_frame(128) * 3


def test_mp3_tag_verifier():
    assert tags.verify(ab.mp3_frame(128) * 4, "mp3") == []
    assert tags.verify(mp3_with_xing(b"Lavf58.76"), "mp3") == []
    assert tags.verify(mp3_with_xing(b"LAME3.100"), "mp3") == []
    assert tags.verify(mp3_with_xing(b"Mallory!!"), "mp3") == ["mp3_encoder_field_unexpected"]
    assert tags.verify(ab.id3v2(20) + ab.mp3_frame(128) * 4, "mp3") == ["id3v2_present"]
    assert "id3v1_present" in tags.verify(ab.mp3_frame(128) * 4 + b"TAG" + b"\x00" * 125, "mp3")
    assert tags.verify(b"x", "flac") == ["unknown_container"]


def test_an_output_with_foreign_tags_is_refused_and_never_marked_metadata_free():
    tagged = ogg_opus_tagged(seconds=6.0, channels=2, tags=opus_tags(comments=(b"TITLE=secret",)))
    with pytest.raises(proc.TranscodeError) as caught:
        transcoder(FakeFfmpeg(out_bytes=tagged)).transcode(stereo_wav(), only("audio-music"))
    assert caught.value.code == "output_reinspection_failed"
    out = transcoder(FakeFfmpeg()).transcode(stereo_wav(), only("audio-music"))
    assert out.outputs[0].facts["metadata_free"] is True


# --- F14: build ---------------------------------------------------------------------------------------


def test_the_image_installs_nasm_deterministically():
    text = (REPO / "native/ffmpeg/Dockerfile").read_text()
    assert "|| true" not in text and "install nasm" in text
    build = (REPO / "native/ffmpeg/build.py").read_text()
    assert "nasm is required for x86_64" in build
