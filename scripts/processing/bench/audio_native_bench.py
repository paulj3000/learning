#!/usr/bin/env python3
"""Offline benchmark of the real FFmpeg audio transcoder (LAI-LAMBDA-008b, ADR-067).

    LAI_FFMPEG_BIN=/path/to/layer/bin/ffmpeg python3 scripts/processing/bench/audio_native_bench.py

Generates deterministic synthetic WAVs with the standard library, runs every profile through
`lai_native.audio.processor.AudioTranscoder` and the real runner, and prints JSON: wall time,
peak child RSS (`ru_maxrss` of the tool, per call, maximum over the run), output size and bit
rate, and accuracy against the profile target (loudness error in LU, true peak margin to the
ceiling). Skips with `{"skipped": ...}` when `LAI_FFMPEG_BIN` is unset. Numbers describe the
machine that ran it: label them (the report writes the host's CPU model and architecture).
"""

from __future__ import annotations

import json
import os
import platform
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "processing"))
sys.path.insert(0, str(ROOT / "tests" / "processing_native"))

#: (label, profile, kind, seconds, rate, channels, peak dBFS)
CASES = (
    ("voice-10s-mono", "audio-voice", "speechlike", 10, 44_100, 1, -22.0),
    ("voice-60s-stereo", "audio-voice", "speechlike", 60, 44_100, 2, -22.0),
    ("music-60s-stereo", "audio-music", "chord", 60, 44_100, 2, -30.0),
    ("music-110s-stereo", "audio-music", "chord", 110, 44_100, 2, -26.0),
    ("voice-900s-8k-mono", "audio-voice", "speechlike", 900, 8_000, 1, -24.0),
    ("ambient-60s-stereo", "audio-ambient", "noise", 60, 48_000, 2, -34.0),
    ("sfx-1s-mono", "audio-sfx", "noise", 1, 44_100, 1, -12.0),
    ("ui-0.3s-mono", "audio-ui", "sine", 0.3, 44_100, 1, -15.0),
)


def cpu_model() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or "unknown"


def main() -> int:
    binary = os.environ.get("LAI_FFMPEG_BIN", "")
    if not binary or not os.path.isfile(binary):
        print(json.dumps({"skipped": "set LAI_FFMPEG_BIN to the built ffmpeg"}))
        return 0
    from audio_synth import make_wav
    from lai_native.audio.processor import AudioTranscoder
    from lai_native.audio.profiles import DEFAULT_PROFILES
    from lai_native.runtime import ToolSpec, run_tool, sha256_file

    peak = {"rss_kb": 0, "calls": 0}

    def runner(*args, **kwargs):
        result = run_tool(*args, **kwargs)
        peak["rss_kb"] = max(peak["rss_kb"], result.peak_rss_kb)
        peak["calls"] += 1
        return result

    tool = ToolSpec("ffmpeg", binary, sha256=sha256_file(binary))
    transcoder = AudioTranscoder(tool, runner=runner)
    cold = time.perf_counter()
    version = transcoder.version()
    cold_ms = round((time.perf_counter() - cold) * 1000, 1)
    rows = []
    for label, pid, kind, seconds, rate, channels, level in CASES:
        profile = DEFAULT_PROFILES[pid]
        data = make_wav(kind, seconds, rate, channels, level)
        peak["rss_kb"] = 0
        started = time.perf_counter()
        out = transcoder.transcode(data, profile)
        elapsed = time.perf_counter() - started
        for o in out.outputs:
            after = o.facts["measured_after"]
            row = {
                "case": label,
                "profile": pid,
                "output": o.label,
                "input_seconds": seconds,
                "input_bytes": len(data),
                "output_bytes": o.facts["size_bytes"],
                "bitrate_kbps": o.facts["bitrate_kbps"],
                "peak_child_rss_mb": round(peak["rss_kb"] / 1024, 1),
                "job_wall_seconds_all_outputs": round(elapsed, 2),
                "realtime_factor": round(seconds / elapsed, 1),
                "measured_after": after,
                "findings": [f["code"] for f in out.facts["findings"]],
            }
            ld = profile.loudness
            if ld.mode == "integrated":
                row["loudness_error_lu"] = round(after["integrated_lufs"] - ld.integrated_lufs, 2)
            else:
                row["peak_error_db"] = round(after["sample_peak_dbfs"] - ld.peak_dbfs, 2)
            row["true_peak_margin_db"] = round((ld.true_peak_dbtp or -1.0) - after["true_peak_dbtp"], 2)
            rows.append(row)
    print(
        json.dumps(
            {
                "host": {"arch": platform.machine(), "cpu": cpu_model(), "cpus": os.cpu_count(),
                         "label": "workstation, NOT Lambda"},
                "ffmpeg": version,
                "ffmpeg_version_call_ms": cold_ms,
                "rows": rows,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
