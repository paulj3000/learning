#!/usr/bin/env python3
"""Offline audio transcode benchmark for LAI-LAMBDA-008b (feasibility only).

Drives a LOCALLY INSTALLED ffmpeg through argv lists (never a shell) over synthetic WAV fixtures
generated at run time with the standard `wave` module, for each proposed category profile in
`lai_processing.contracts.audio_profiles`. It reports wall time, the running maximum resident
set size of all child processes so far (a monotonic upper bound, not per step) and output
size. It never installs, downloads or commits a binary, writes only into a fresh temporary
directory, and uses no network.

    python3 scripts/processing/bench/audio_transcode_bench.py            # plan only
    python3 scripts/processing/bench/audio_transcode_bench.py --run      # run; skips without ffmpeg
    python3 scripts/processing/bench/audio_transcode_bench.py --run --quick

Without ffmpeg on PATH (or --ffmpeg), `--run` prints {"skipped": ...} and exits 0.

This file is a measurement tool, not product code. `lai_processing` must never run a process
(tests/processing/test_processing_runtime_independence.py); the argument construction here is the
reference for what an approved, separately packaged worker would do, nothing more. Timings
describe the host that ran them: an x86 laptop is not an arm64 Lambda.
"""

from __future__ import annotations

import argparse
import array
import io
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "processing"))

from lai_processing.contracts.audio_profiles import (  # noqa: E402
    DEFAULT_PROFILES,
    AudioTranscodeProfile,
    LoudnessSpec,
    OutputSpec,
    linear_gain_db,
)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # lai/apps/assets/validation_media.py
WALL_CLOCK_SECONDS = 240  # proposal: below a 300 s function timeout
HARD_OUTPUT_CAP = 20 * 1024 * 1024

# (label, profile id, kind, seconds, sample rate, channels)
CASES = (
    ("sfx-2s-mono-48k", "audio-sfx-v1", "sine", 2, 48_000, 1),
    ("ui-1s-mono-48k", "audio-ui-v1", "sine", 1, 48_000, 1),
    ("ambient-30s-stereo-44k", "audio-ambient-v1", "noise", 30, 44_100, 2),
    ("voice-60s-mono-48k", "audio-voice-v1", "speechlike", 60, 48_000, 1),
    ("music-115s-stereo-44k", "audio-music-v1", "chord", 115, 44_100, 2),  # about the 20 MiB cap
    ("voice-900s-mono-8k", "audio-voice-v1", "speechlike", 900, 8_000, 1),  # 15 min, small bytes
)
QUICK = {"sfx-2s-mono-48k", "ambient-30s-stereo-44k"}


# --- fixtures (standard library only) ---------------------------------------------------------


def _wav_bytes(frames: bytes, rate: int, channels: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()


def _tile(block: array.array, total_frames: int, channels: int) -> bytes:
    need = total_frames * channels
    reps, rem = divmod(need, len(block))
    data = block * reps + block[:rem]
    if sys.byteorder == "big":  # WAV is little endian
        data.byteswap()
    return data.tobytes()


def _sine_block(rate: int, hz: float, amp: float, channels: int) -> array.array:
    n = rate  # one second; tiling a whole second keeps the loop seamless for integer hz
    a = array.array("h")
    for i in range(n):
        v = int(amp * 32767 * math.sin(2 * math.pi * hz * i / rate))
        a.extend([v] * channels)
    return a


def generate_wav(kind: str, seconds: int, rate: int, channels: int, seed: int = 7) -> bytes:
    """Deterministic 16-bit PCM WAV. Kinds: sine (440 Hz, -12 dBFS), chord (three sines, about
    -14 dBFS peak), speechlike (110 Hz and 220 Hz with a 3 Hz level modulation, about -20 dBFS),
    noise (white noise attenuated to about -30 dBFS peak). Never audio of a real person."""
    if kind not in {"sine", "chord", "speechlike", "noise"}:
        raise ValueError("unknown fixture kind")
    if not (1 <= seconds <= 900 and 8_000 <= rate <= 96_000 and channels in (1, 2)):
        raise ValueError("fixture outside the Asset Library audio limits")
    frames = seconds * rate
    if kind == "noise":
        raw = bytearray(random.Random(seed).randbytes(frames * channels * 2))  # noqa: S311
        table = bytes(((b >> 5) - 4) & 0xFF for b in range(256))  # high byte -4..3 => +-1024
        raw[1::2] = raw[1::2].translate(table)
        return _wav_bytes(bytes(raw), rate, channels)
    block = array.array("h")
    for i in range(rate):
        t = i / rate
        if kind == "sine":
            v = 0.25 * math.sin(2 * math.pi * 440 * t)
        elif kind == "chord":
            v = 0.07 * sum(math.sin(2 * math.pi * hz * t) for hz in (261, 329, 392))
        else:  # speechlike
            env = 0.5 + 0.5 * math.sin(2 * math.pi * 3 * t)
            v = (
                0.06
                * env
                * (math.sin(2 * math.pi * 110 * t) + 0.5 * math.sin(2 * math.pi * 220 * t))
            )
        block.extend([int(v * 32767)] * channels)
    return _wav_bytes(_tile(block, frames, channels), rate, channels)


# --- argument construction (pure; no ffmpeg needed) --------------------------------------------

COMMON = (
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error",
    "-protocol_whitelist", "file",
)  # fmt: skip


def _input_args(src: str, fmt: str, max_seconds: int) -> list[str]:
    if fmt not in {"wav", "mp3", "ogg"}:
        raise ValueError("input format must be sniffed as wav, mp3 or ogg")
    return ["-t", str(max_seconds), "-f", fmt, "-i", src]


def build_measure_argv(ffmpeg: str, src: str, fmt: str, spec: LoudnessSpec, max_seconds: int):
    """Pass 1: measure only, output discarded (`-f null -`). Integrated modes print loudnorm
    JSON on stderr; peak mode uses volumedetect."""
    if spec.mode == "integrated":
        filt = (
            f"loudnorm=I={spec.integrated_lufs}:TP={spec.true_peak_dbtp}"
            f":LRA={spec.lra_max or 11.0}:print_format=json"
        )
    elif spec.mode == "peak":
        filt = "volumedetect"
    else:
        raise ValueError("nothing to measure for mode none")
    return [
        ffmpeg, *COMMON, "-loglevel", "info", *_input_args(src, fmt, max_seconds),
        "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", filt, "-f", "null", "-",
    ]  # fmt: skip


def gain_filter(spec: LoudnessSpec, measured: dict[str, float]) -> str | None:
    """Pass 2 filter from pass 1 numbers (measured: input_i, input_tp or max_volume)."""
    if spec.mode == "integrated":
        gain = linear_gain_db(measured["input_i"], spec, measured["input_tp"])
        return f"volume={gain:.2f}dB"
    if spec.mode == "peak":
        if spec.peak_dbfs is None:
            raise ValueError("peak mode needs peak_dbfs")
        return f"volume={spec.peak_dbfs - measured['max_volume']:.2f}dB"
    return None


def codec_args(out: OutputSpec) -> list[str]:
    from lai_processing.contracts.audio_profiles import MP3_VBR_QUALITY, OPUS_PRESETS

    if out.codec == "opus":
        kbps = out.bitrate_kbps or OPUS_PRESETS[out.quality or "standard"]
        return ["-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-application",
                "voip" if (out.channels == 1 and kbps <= 64) else "audio", "-f", "ogg",
                "-fflags", "+bitexact", "-flags:a", "+bitexact"]  # fmt: skip
    if out.codec == "mp3":
        if out.quality is not None:
            rate = ["-q:a", str(MP3_VBR_QUALITY[out.quality])]
        else:
            rate = ["-b:a", f"{out.bitrate_kbps}k"]
        return ["-c:a", "libmp3lame", *rate, "-write_id3v2", "0", "-write_xing", "1",
                "-f", "mp3", "-fflags", "+bitexact", "-flags:a", "+bitexact"]  # fmt: skip
    return ["-c:a", "pcm_s16le", "-rf64", "never", "-f", "wav", "-bitexact"]


def build_encode_argv(
    ffmpeg: str,
    src: str,
    fmt: str,
    dst: str,
    out: OutputSpec,
    profile: AudioTranscodeProfile,
    gain: str | None,
) -> list[str]:
    """Pass 2: one output. Every flag is a separate argv element; the paths are the only
    variable parts and are placed after `-i` and last, so a name cannot become an option
    (callers pass absolute paths inside a per-job directory)."""
    for p in (src, dst):
        if not os.path.isabs(p) or p.startswith("-"):
            raise ValueError("paths must be absolute")
    argv = [
        ffmpeg, *COMMON, "-n", *_input_args(src, fmt, profile.max_input_seconds),
        "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-map_metadata", "-1", "-map_chapters", "-1",
        "-fs", str(min(profile.max_output_bytes, HARD_OUTPUT_CAP)),
    ]  # fmt: skip
    filters = []
    if gain:
        filters.append(gain)
    if filters:
        argv += ["-af", ",".join(filters)]
    argv += ["-ar", str(out.sample_rate)]
    if out.channels is not None:
        argv += ["-ac", str(out.channels)]
    argv += codec_args(out)
    argv.append(dst)
    return argv


# --- running ----------------------------------------------------------------------------------


def parse_measure(stderr: str, spec: LoudnessSpec) -> dict[str, float]:
    if spec.mode == "peak":
        for line in stderr.splitlines():
            if "max_volume:" in line:
                return {"max_volume": float(line.split("max_volume:")[1].split("dB")[0])}
        raise ValueError("no max_volume in output")
    start = stderr.rfind("{")
    data = json.loads(stderr[start : stderr.rfind("}") + 1])
    return {"input_i": float(data["input_i"]), "input_tp": float(data["input_tp"])}


def run_argv(argv: list[str], cwd: str, timeout: float = WALL_CLOCK_SECONDS) -> dict:
    """Run argv (no shell, empty environment, stdin closed), return wall time, the running maximum
    RSS of all children so far (getrusage) and stderr. Killed at the timeout."""
    env = {"LC_ALL": "C", "PATH": ""}
    t0 = time.perf_counter()
    with subprocess.Popen(  # noqa: S603 - argv list, absolute executable, no shell
        argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, shell=False,
    ) as proc:  # fmt: skip
        timed_out = False
        try:
            _, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, err = proc.communicate()
            timed_out = True
        wall = time.perf_counter() - t0
        rss_kib = None
        try:
            import resource

            rss_kib = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        except ImportError:  # pragma: no cover - non-POSIX
            pass
    return {"returncode": proc.returncode, "wall_s": round(wall, 3), "timed_out": timed_out,
            "peak_rss_children_mib": round(rss_kib / 1024, 1) if rss_kib else None,
            "stderr": err.decode("utf-8", "replace")}  # fmt: skip


def run_case(ffmpeg: str, case: tuple, work: Path) -> dict:
    label, pid, kind, seconds, rate, ch = case
    profile = DEFAULT_PROFILES[pid]
    src = work / f"{label}.wav"
    src.write_bytes(generate_wav(kind, seconds, rate, ch))
    row: dict = {"case": label, "profile": pid, "source_bytes": src.stat().st_size, "outputs": []}
    gain = None
    if profile.loudness.mode != "none":
        m = run_argv(build_measure_argv(ffmpeg, str(src), "wav", profile.loudness,
                                        profile.max_input_seconds), str(work))  # fmt: skip
        row["measure"] = {k: m[k] for k in ("returncode", "wall_s", "peak_rss_children_mib")}
        if m["returncode"] == 0:
            measured = parse_measure(m["stderr"], profile.loudness)
            row["measured"] = measured
            gain = gain_filter(profile.loudness, measured)
    for out in profile.outputs:
        dst = work / f"{label}.{out.label}.{out.container}"
        r = run_argv(build_encode_argv(ffmpeg, str(src), "wav", str(dst), out, profile, gain),
                     str(work))  # fmt: skip
        row["outputs"].append({
            "label": out.label, "returncode": r["returncode"], "wall_s": r["wall_s"],
            "peak_rss_children_mib": r["peak_rss_children_mib"],
            "bytes": dst.stat().st_size if dst.exists() else None,
            "error": None if r["returncode"] == 0 else r["stderr"][-300:],
        })  # fmt: skip
    return row


def host() -> dict:
    return {"python": platform.python_version(), "machine": platform.machine(),
            "system": platform.system(), "cpus": os.cpu_count()}  # fmt: skip


def ffmpeg_version(ffmpeg: str) -> str:
    out = subprocess.run(  # noqa: S603
        [ffmpeg, "-hide_banner", "-version"], capture_output=True, check=False, timeout=20,
        stdin=subprocess.DEVNULL, shell=False,
    )  # fmt: skip
    return out.stdout.decode("utf-8", "replace").splitlines()[0] if out.stdout else "unknown"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--run", action="store_true", help="run the cases (default: plan only)")
    parser.add_argument("--quick", action="store_true", help="only the two small cases")
    parser.add_argument("--ffmpeg", help="absolute path to ffmpeg (default: first on PATH)")
    args = parser.parse_args(argv)
    cases = [c for c in CASES if not args.quick or c[0] in QUICK]
    if not args.run:
        print(json.dumps({"plan": [c[0] for c in cases], "host": host()}, indent=2))
        return 0
    ffmpeg = args.ffmpeg or shutil.which("ffmpeg")
    if not ffmpeg:
        print(json.dumps({"skipped": "ffmpeg not found; nothing was measured"}))
        return 0
    ffmpeg = os.path.realpath(ffmpeg)
    with tempfile.TemporaryDirectory(prefix="lai-audio-bench-") as tmp:
        rows = [run_case(ffmpeg, c, Path(tmp)) for c in cases]
    print(json.dumps({"host": host(), "ffmpeg": ffmpeg_version(ffmpeg), "results": rows}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
