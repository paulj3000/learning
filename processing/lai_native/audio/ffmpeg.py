"""FFmpeg command construction and bounded output parsing. Pure functions: nothing runs here.

Every command is an argv list of constants plus a few validated values: absolute paths inside the
job workspace (built by `Workspace.safe_path`), numbers formatted by this module, and enumerated
format names. No value taken from a job or from file contents reaches an argument.

Inputs are restricted: `-protocol_whitelist file` (the build also has only the file and pipe
protocols), an explicit input format with `-f`, only the first audio stream is mapped, and
metadata, chapters, video, subtitles and data are dropped.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from .profiles import MP3_VBR_QUALITY, OPUS_PRESETS, OutputSpec

__all__ = [
    "LoudnormMeasure",
    "Measurement",
    "build_encode_args",
    "num",
    "build_measure_ebur128_args",
    "build_measure_loudnorm_args",
    "parse_ebur128",
    "parse_loudnorm_json",
    "parse_version",
    "prefix_filter",
]

#: Input format name -> the `-f` demuxer name (explicit, never probed).
INPUT_FORMATS: Final = {"wav": "wav", "mp3": "mp3", "ogg": "ogg"}
#: Floor reported for silence; EBU R128 gating makes anything near it unmeasurable.
SILENCE_LUFS: Final = -70.0
_FLOAT = re.compile(r"^-?(?:\d+(?:\.\d+)?|inf|nan)$", re.IGNORECASE)
MAX_JSON_BYTES: Final = 4096

_COMMON: Final = ["-nostdin", "-hide_banner", "-nostats", "-loglevel", "info", "-n"]


@dataclass(frozen=True)
class Measurement:
    """BS.1770 / EBU R128 numbers (dB units; `None` when the tool did not print one)."""

    integrated_lufs: float | None
    lra_lu: float | None
    true_peak_dbtp: float | None
    sample_peak_dbfs: float | None

    def as_facts(self) -> dict[str, float | None]:
        return {
            "integrated_lufs": _r(self.integrated_lufs),
            "loudness_range_lu": _r(self.lra_lu),
            "true_peak_dbtp": _r(self.true_peak_dbtp),
            "sample_peak_dbfs": _r(self.sample_peak_dbfs),
        }


@dataclass(frozen=True)
class LoudnormMeasure:
    input_i: float
    input_tp: float
    input_lra: float
    input_thresh: float
    target_offset: float
    normalization_type: str | None = None


def _r(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, 2)


def num(value: float) -> str:
    """A float formatted for a filter option: plain decimal, bounded, never scientific."""
    if not math.isfinite(value):
        raise ValueError("non-finite filter value")
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def prefix_filter(spec: OutputSpec, channels: int, source_channels: int | None = None) -> str:
    """Resample, then set the channel layout, first in every chain, so each measurement sees the
    delivered signal. A stereo source going to mono is averaged explicitly (`pan`): FFmpeg's
    implicit downmix differs with the chain shape (it can add 3 dB), which would put the measured
    and the encoded signal on different levels."""
    layout = "mono" if channels == 1 else "stereo"
    parts = [f"aresample={spec.sample_rate}"]
    if channels == 1 and (source_channels or 1) >= 2:
        parts.append("pan=mono|c0=0.5*c0+0.5*c1")
    parts.append(f"aformat=sample_rates={spec.sample_rate}:channel_layouts={layout}")
    return ",".join(parts)


def _input_args(input_path: Path, input_format: str, max_seconds: float) -> list[str]:
    if input_format not in INPUT_FORMATS:
        raise ValueError("unknown input format")
    _check_path(input_path)
    return [
        "-protocol_whitelist",
        "file",
        "-t",
        num(max_seconds),
        "-f",
        INPUT_FORMATS[input_format],
        "-i",
        str(input_path),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-map_metadata:s:a",
        "-1",
    ]


def _check_path(path: Path) -> None:
    text = str(path)
    if not path.is_absolute() or text.startswith("-") or "\x00" in text:
        raise ValueError("path must be absolute")


def build_measure_loudnorm_args(
    input_path: Path,
    input_format: str,
    max_seconds: float,
    prefix: str,
    *,
    target_i: float,
    target_tp: float,
    target_lra: float,
) -> list[str]:
    """Pass 1: loudnorm with `print_format=json`, output discarded."""
    chain = (
        f"{prefix},loudnorm=I={num(target_i)}:TP={num(target_tp)}:LRA={num(target_lra)}"
        ":print_format=json"
    )
    return [
        *_COMMON,
        *_input_args(input_path, input_format, max_seconds),
        "-af",
        chain,
        "-f",
        "null",
        "-",
    ]


def build_measure_ebur128_args(
    input_path: Path, input_format: str, max_seconds: float, prefix: str
) -> list[str]:
    """Loudness, loudness range, sample peak and true peak of what a decoder would play."""
    chain = f"{prefix},ebur128=peak=sample+true:framelog=quiet"
    return [
        *_COMMON,
        *_input_args(input_path, input_format, max_seconds),
        "-af",
        chain,
        "-f",
        "null",
        "-",
    ]


def build_encode_args(
    input_path: Path,
    input_format: str,
    output_path: Path,
    spec: OutputSpec,
    channels: int,
    max_seconds: float,
    gain_chain: str,
    prefix: str,
    *,
    voice: bool,
    max_output_bytes: int,
) -> list[str]:
    """Encode one output. `gain_chain` is built by the processor from measured numbers only."""
    _check_path(output_path)
    chain = f"{prefix},{gain_chain}" if gain_chain else prefix
    args = [
        *_COMMON,
        *_input_args(input_path, input_format, max_seconds),
        "-af",
        chain,
        "-fflags",
        "+bitexact",
        "-ar",
        str(spec.sample_rate),
        "-ac",
        str(channels),
        "-flags:a",
        "+bitexact",
        "-fs",
        str(int(max_output_bytes)),
    ]
    if spec.codec == "opus":
        kbps = spec.bitrate_kbps if spec.bitrate_kbps is not None else OPUS_PRESETS[spec.quality]
        args += [
            "-c:a",
            "libopus",
            "-b:a",
            f"{kbps}k",
            "-vbr",
            "on",
            "-compression_level",
            "10",
            "-application",
            "voip" if voice else "audio",
            "-frame_duration",
            "20",
            "-f",
            "ogg",
        ]
    elif spec.codec == "mp3":
        args += ["-c:a", "libmp3lame"]
        if spec.quality is not None:
            args += ["-q:a", str(MP3_VBR_QUALITY[spec.quality])]
        else:
            args += ["-b:a", f"{spec.bitrate_kbps}k"]
        args += ["-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-f", "mp3"]
    else:
        raise ValueError("unsupported codec")
    args.append(str(output_path))
    return args


# --- parsing (bounded: callers pass at most the runner's stderr cap) ---------------------------


def _to_float(text: str) -> float | None:
    text = text.strip()
    if not _FLOAT.match(text):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_loudnorm_json(stderr: bytes) -> LoudnormMeasure:
    """The JSON block loudnorm prints (the last one). Values are strings; `-inf` is legal."""
    text = stderr.decode("utf-8", "replace")
    # Anchor on the LAST loudnorm log block: input tags are printed at the start of a run, so a
    # tag that imitates a marker or a JSON object cannot come after the real block.
    anchor = text.rfind("[Parsed_loudnorm")
    if anchor < 0:
        raise ValueError("no loudnorm json")
    start = text.find("{", anchor)
    end = text.find("}", start) if start >= 0 else -1
    if start < 0 or end < 0 or end - start > MAX_JSON_BYTES:
        raise ValueError("no loudnorm json")
    try:
        data = json.loads(text[start : end + 1])
    except ValueError:
        raise ValueError("no loudnorm json") from None
    values = {}
    for key in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset"):
        raw = data.get(key) if isinstance(data, dict) else None
        parsed = _to_float(raw) if isinstance(raw, str) else None
        if parsed is None:
            raise ValueError("no loudnorm json")
        values[key] = parsed
    kind = data.get("normalization_type") if isinstance(data, dict) else None
    return LoudnormMeasure(
        **values, normalization_type=kind if kind in ("linear", "dynamic") else None
    )


_I = re.compile(r"^\s*I:\s+(\S+)\s+LUFS\s*$")
_LRA = re.compile(r"^\s*LRA:\s+(\S+)\s+LU\s*$")
_PEAK = re.compile(r"^\s*Peak:\s+(\S+)\s+dB(?:FS|TP)\s*$")


def parse_ebur128(stderr: bytes) -> Measurement:
    """The ebur128 summary block (the last one printed)."""
    lines = stderr.decode("utf-8", "replace").splitlines()
    start = max(
        (
            i
            for i, line in enumerate(lines)
            if line.startswith("[Parsed_ebur128") and line.strip().endswith("Summary:")
        ),
        default=-1,
    )
    if start < 0:
        raise ValueError("no ebur128 summary")
    integrated = lra = sample = true = None
    section = ""
    for line in lines[start + 1 : start + 60]:
        stripped = line.strip()
        if stripped.endswith(":") and not stripped.startswith(("I:", "LRA:", "Peak:")):
            section = stripped.lower()
            continue
        match = _I.match(line)
        if match and section.startswith("integrated"):
            integrated = _to_float(match.group(1))
            continue
        match = _LRA.match(line)
        if match and section.startswith("loudness range"):
            lra = _to_float(match.group(1))
            continue
        match = _PEAK.match(line)
        if match:
            if section.startswith("sample"):
                sample = _to_float(match.group(1))
            elif section.startswith("true"):
                true = _to_float(match.group(1))
    if integrated is None and lra is None and true is None and sample is None:
        raise ValueError("no ebur128 summary")
    return Measurement(integrated, lra, true, sample)


_VERSION = re.compile(r"^ffmpeg version (\d+\.\d+(?:\.\d+)?)\b")


def parse_version(stdout: bytes) -> str | None:
    first = stdout.decode("utf-8", "replace").splitlines()[:1]
    match = _VERSION.match(first[0]) if first else None
    return match.group(1) if match else None
