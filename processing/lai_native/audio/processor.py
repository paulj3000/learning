"""Audio transcode and loudness processor (LAI-LAMBDA-008b, ADR-067).

`AudioTranscoder.transcode(data, profile)` takes the verified bytes of one staff-authored audio
file and returns candidate outputs (Ogg Opus, MP3) with measured facts. It never publishes or
writes anywhere but its private workspace; the caller stores outputs as artifacts.

Per output (outputs run one at a time):

1. Header inspection of the input (`lai_processing` audio inspector, pure Python) decides the
   format from the bytes, refuses anything it reports as an error, and checks duration limits.
2. Pass 1 measures the signal as it will be delivered (the output's sample rate and channel
   layout): `loudnorm ... print_format=json` for integrated profiles, `ebur128` (sample and true
   peak) for peak profiles and for clips shorter than `SHORT_AUDIO_SECONDS`, where integrated
   loudness is unreliable and the clip is peak normalised instead.
3. The gain is one linear number computed here from the measurement (no dynamic compression).
   When the true-peak ceiling leaves less headroom than the loudness target needs, the signal is
   limited (`alimiter`) and the result carries a `true_peak_limited` finding.
4. Pass 2 encodes with that gain, metadata stripped and bitexact flags set.
5. The output is decoded and measured again; a lossy encode that overshoots the true-peak ceiling
   is retried with 0.5 dB less gain (twice at most), then flagged.
6. The output is re-inspected (format, rate, channels, duration within a stated tolerance).

Gameplay code never sees any of this: results are advisory facts plus bytes for staff review.
"""

from __future__ import annotations

import hashlib
import io
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

from lai_native.runtime import (
    Deadline,
    NativeToolError,
    ToolLimits,
    ToolResult,
    ToolSpec,
    Workspace,
    run_tool,
)
from lai_processing.processors.audio.facts import AudioSettings
from lai_processing.processors.audio.inspector import inspect_audio

from . import ffmpeg
from .profiles import (
    CONTENT_TYPES,
    SHORT_AUDIO_SECONDS,
    AudioTranscodeProfile,
    OutputSpec,
    check_profile,
)

__all__ = [
    "AudioOutput",
    "AudioTranscoder",
    "ERROR_CODES",
    "Finding",
    "MAX_INPUT_BYTES",
    "TranscodeError",
    "TranscodeOutcome",
    "choose_gain",
    "output_channels",
]

PROCESSOR_VERSION: Final = "1"
MAX_INPUT_BYTES: Final = 20 * 1024 * 1024
MAX_GAIN_DB: Final = 20.0  # a source needing more is "silent_source", refused
MAX_PEAK_RETRIES: Final = 2
RETRY_STEP_DB: Final = 0.5
#: Peak target (dBFS) for a short clip under an integrated profile: this far under the ceiling.
SHORT_CLIP_MARGIN_DB: Final = 2.0
#: A lossy encode may land this far from the sample-peak target before a finding is raised.
PEAK_TOLERANCE_DB: Final = 1.0
#: A peak-profile output this far over its sample-peak target is re-encoded with less gain.
PEAK_RETRY_DB: Final = 0.5
_FORMAT_TYPES: Final = {"wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg"}
_EXT: Final = {"wav": "wav", "mp3": "mp3", "ogg": "ogg"}
_SOURCE_CODECS: Final = {"wav": {"pcm", "float"}, "mp3": {"mp3"}, "ogg": {"vorbis", "opus"}}

#: Error codes this module raises itself (runtime codes pass through from `NativeToolError`).
ERROR_CODES: Final = {
    "input_too_large": False,
    "input_refused": False,
    "input_too_long": False,
    "unsupported_input": False,
    "silent_source": False,
    "decode_failed": False,
    "measure_failed": False,
    "encode_failed": False,
    "output_reinspection_failed": False,
    "profile_invalid": False,
}


class TranscodeError(Exception):
    """A transcode failed. `code` is a stable, log-safe string; `retryable` is for the queue."""

    def __init__(self, code: str, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class Finding:
    code: str
    severity: str  # "info" | "warning" | "error"
    label: str | None = None

    def as_dict(self) -> dict[str, str]:
        out = {"code": self.code, "severity": self.severity}
        if self.label:
            out["label"] = self.label
        return out


@dataclass(frozen=True)
class AudioOutput:
    label: str
    codec: str
    container: str
    content_type: str
    data: bytes
    facts: dict[str, Any]


@dataclass(frozen=True)
class TranscodeOutcome:
    outputs: list[AudioOutput]
    facts: dict[str, Any]
    findings: list[Finding] = field(default_factory=list)


def output_channels(spec: OutputSpec, source_channels: int) -> int:
    """Channel policy: never upmix. A profile asking for mono always gets mono (dialogue stays
    mono), one asking for stereo gets stereo only when the source has it, and a profile with no
    preference keeps the source layout."""
    if spec.channels is None:
        return 2 if source_channels >= 2 else 1
    return min(spec.channels, 2 if source_channels >= 2 else 1)


def choose_gain(
    profile: AudioTranscodeProfile,
    *,
    duration_seconds: float,
    integrated_lufs: float | None,
    true_peak_dbtp: float | None,
    sample_peak_dbfs: float | None,
) -> tuple[str, float, bool]:
    """(mode used, gain in dB, true_peak_limited). Pure arithmetic over measured numbers.

    `integrated`: gain reaches the loudness target; if that would push the true peak over the
    ceiling the gain is still applied and a limiter holds the ceiling (`limited` is True).
    `peak`: gain moves the sample peak to the target. A short clip under an integrated profile
    switches to `peak` with the target `true_peak_dbtp - 2 dB` (loudness is unreliable there).
    """
    ld = profile.loudness
    mode = ld.mode
    peak_target = ld.peak_dbfs
    if mode == "integrated" and duration_seconds < SHORT_AUDIO_SECONDS:
        mode = "peak"
        peak_target = (ld.true_peak_dbtp or -1.0) - SHORT_CLIP_MARGIN_DB
    if mode == "none":
        return "none", 0.0, False
    if mode == "peak":
        if sample_peak_dbfs is None or not math.isfinite(sample_peak_dbfs) or sample_peak_dbfs < -70.0:
            raise TranscodeError("silent_source")
        assert peak_target is not None
        return "peak", peak_target - sample_peak_dbfs, False
    if (
        integrated_lufs is None
        or true_peak_dbtp is None
        or not math.isfinite(integrated_lufs)
        or not math.isfinite(true_peak_dbtp)
        or integrated_lufs <= -70.0
    ):
        raise TranscodeError("silent_source")
    assert ld.integrated_lufs is not None and ld.true_peak_dbtp is not None
    gain = ld.integrated_lufs - integrated_lufs
    return "integrated", gain, true_peak_dbtp + gain > ld.true_peak_dbtp


def _gain_chain(gain_db: float, limit_dbtp: float | None) -> str:
    chain = f"volume={ffmpeg.num(gain_db)}dB"
    if limit_dbtp is not None:
        # alimiter limits sample peaks with look-ahead; one dB under the true-peak ceiling leaves
        # room for inter-sample peaks. The output is re-measured and retried regardless.
        limit_linear = 10 ** ((limit_dbtp - 1.0) / 20.0)
        chain += f",alimiter=limit={ffmpeg.num(max(0.0625, min(1.0, limit_linear)))}:level=disabled"
    return chain


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class AudioTranscoder:
    """Runs profiles through one trusted FFmpeg executable."""

    def __init__(
        self,
        tool: ToolSpec,
        limits: ToolLimits | None = None,
        *,
        workspace_base: str | None = None,
        runner: Callable[..., ToolResult] = run_tool,
        tool_version: str | None = None,
    ):
        self.tool = tool
        self.limits = limits or ToolLimits(
            timeout_seconds=240.0,
            cpu_seconds=240,
            address_space_bytes=2 * 1024 * 1024 * 1024,
            max_file_bytes=24 * 1024 * 1024,
            max_workspace_bytes=96 * 1024 * 1024,
        )
        self.workspace_base = workspace_base
        self._runner = runner
        self.tool_version = tool_version

    # --- execution ---

    def _run(
        self,
        ws: Workspace,
        args: list[str],
        deadline: Deadline | None,
        cancelled: Callable[[], bool] | None,
    ) -> ToolResult:
        try:
            return self._runner(
                self.tool, args, ws, self.limits, deadline=deadline, cancelled=cancelled
            )
        except NativeToolError as error:
            raise TranscodeError(error.code, error.retryable) from None

    def version(self, deadline: Deadline | None = None) -> str | None:
        if self.tool_version is None:
            with Workspace(self.workspace_base) as ws:
                result = self._run(ws, ["-hide_banner", "-version"], deadline, None)
            self.tool_version = ffmpeg.parse_version(result.stdout) or "unknown"
        return self.tool_version

    # --- the job ---

    def transcode(
        self,
        data: bytes,
        profile: AudioTranscodeProfile,
        *,
        deadline: Deadline | None = None,
        cancelled: Callable[[], bool] | None = None,
        only_labels: tuple[str, ...] | None = None,
    ) -> TranscodeOutcome:
        try:
            check_profile(profile)
        except ValueError:
            raise TranscodeError("profile_invalid") from None
        source = self._inspect_source(data, profile)
        fmt = source["format"]
        findings: list[Finding] = []
        outputs: list[AudioOutput] = []
        measured_before: dict[str, Any] = {}
        gains: dict[str, float] = {}
        specs = [o for o in profile.outputs if only_labels is None or o.label in only_labels]
        if not specs:
            raise TranscodeError("profile_invalid")
        duration = source["duration_seconds"]
        max_seconds = float(min(profile.max_input_seconds, 900)) + 1.0
        with Workspace(self.workspace_base) as ws:
            input_path = ws.write(f"input.{_EXT[fmt]}", data)
            for spec in specs:
                try:
                    out, before, gain, extra = self._one_output(
                        ws, input_path, fmt, source, profile, spec, max_seconds, deadline, cancelled
                    )
                except TranscodeError as error:
                    if spec.required:
                        raise
                    findings.append(Finding("optional_output_failed", "warning", spec.label))
                    findings.append(Finding(error.code, "info", spec.label))
                    continue
                outputs.append(out)
                measured_before[spec.label] = before
                gains[spec.label] = round(gain, 2)
                findings.extend(extra)
        if not outputs:
            raise TranscodeError("encode_failed")
        facts = {
            "processor_version": PROCESSOR_VERSION,
            "profile": {"id": profile.profile_id, "version": profile.version},
            "source": {**source, "sha256": _sha256(data), "size_bytes": len(data)},
            "duration_seconds": duration,
            "measured_before": measured_before,
            "gain_db": gains,
            "tool": {
                "name": "ffmpeg",
                "version": self.version(deadline),
                "license_class": "lgpl",
                "binary_sha256": self.tool.sha256,
            },
            "findings": [f.as_dict() for f in findings],
        }
        return TranscodeOutcome(outputs, facts, findings)

    # --- steps ---

    def _inspect_source(self, data: bytes, profile: AudioTranscodeProfile) -> dict[str, Any]:
        if len(data) > MAX_INPUT_BYTES:
            raise TranscodeError("input_too_large")
        from lai_processing.processors.audio.inspector import sniff

        fmt = sniff(data[:16])
        if fmt is None:
            raise TranscodeError("unsupported_input")
        inspection = inspect_audio(
            io.BytesIO(data), len(data), _FORMAT_TYPES[fmt], AudioSettings()
        )
        meta = inspection.metadata
        if inspection.report.has_errors:
            raise TranscodeError("input_refused")
        if meta.get("codec") not in _SOURCE_CODECS[fmt]:
            raise TranscodeError("unsupported_input")
        seconds = meta.get("duration_seconds")
        channels = meta.get("channels")
        rate = meta.get("sample_rate_hz")
        if not isinstance(seconds, (int, float)) or seconds <= 0:
            raise TranscodeError("input_refused")
        if seconds > profile.max_input_seconds:
            raise TranscodeError("input_too_long")
        if channels not in (1, 2) or not isinstance(rate, int):
            raise TranscodeError("unsupported_input")
        return {
            "format": fmt,
            "codec": meta["codec"],
            "duration_seconds": round(float(seconds), 3),
            "sample_rate_hz": rate,
            "channels": channels,
        }

    def _measure_before(
        self,
        ws: Workspace,
        input_path: Path,
        fmt: str,
        profile: AudioTranscodeProfile,
        prefix: str,
        duration: float,
        max_seconds: float,
        deadline: Deadline | None,
        cancelled: Callable[[], bool] | None,
    ) -> ffmpeg.Measurement:
        ld = profile.loudness
        if ld.mode == "integrated" and duration >= SHORT_AUDIO_SECONDS:
            assert ld.integrated_lufs is not None and ld.true_peak_dbtp is not None
            args = ffmpeg.build_measure_loudnorm_args(
                input_path,
                fmt,
                max_seconds,
                prefix,
                target_i=ld.integrated_lufs,
                target_tp=ld.true_peak_dbtp,
                target_lra=ld.lra_max or 20.0,
            )
            result = self._run(ws, args, deadline, cancelled)
            self._exit_ok(result)
            try:
                ln = ffmpeg.parse_loudnorm_json(result.stderr)
            except ValueError:
                raise TranscodeError("measure_failed") from None
            return ffmpeg.Measurement(ln.input_i, ln.input_lra, ln.input_tp, None)
        args = ffmpeg.build_measure_ebur128_args(input_path, fmt, max_seconds, prefix)
        result = self._run(ws, args, deadline, cancelled)
        self._exit_ok(result)
        try:
            return ffmpeg.parse_ebur128(result.stderr)
        except ValueError:
            raise TranscodeError("measure_failed") from None

    @staticmethod
    def _exit_ok(result: ToolResult) -> None:
        if result.returncode != 0:
            raise TranscodeError("decode_failed")

    def _one_output(
        self,
        ws: Workspace,
        input_path: Path,
        fmt: str,
        source: dict[str, Any],
        profile: AudioTranscodeProfile,
        spec: OutputSpec,
        max_seconds: float,
        deadline: Deadline | None,
        cancelled: Callable[[], bool] | None,
    ) -> tuple[AudioOutput, dict[str, Any], float, list[Finding]]:
        label = spec.label
        findings: list[Finding] = []
        channels = output_channels(spec, source["channels"])
        prefix = ffmpeg.prefix_filter(spec, channels, source["channels"])
        duration = source["duration_seconds"]
        before = self._measure_before(
            ws, input_path, fmt, profile, prefix, duration, max_seconds, deadline, cancelled
        )
        ld = profile.loudness
        if ld.mode == "integrated" and duration < SHORT_AUDIO_SECONDS:
            findings.append(Finding("short_clip_peak_normalised", "info", label))
        if before.sample_peak_dbfs is not None and before.sample_peak_dbfs >= -0.1:
            findings.append(Finding("clipping_in_source", "warning", label))
        if ld.mode == "integrated" and ld.lra_max and before.lra_lu and before.lra_lu > ld.lra_max:
            findings.append(Finding("loudness_range_above_target", "info", label))
        mode, gain, limited = choose_gain(
            profile,
            duration_seconds=duration,
            integrated_lufs=before.integrated_lufs,
            true_peak_dbtp=before.true_peak_dbtp,
            sample_peak_dbfs=before.sample_peak_dbfs,
        )
        if gain > MAX_GAIN_DB:
            raise TranscodeError("silent_source")
        ceiling = ld.true_peak_dbtp if ld.true_peak_dbtp is not None else -1.0
        peak_target = None
        if mode == "peak":
            peak_target = (
                ld.peak_dbfs if ld.mode == "peak" else ceiling - SHORT_CLIP_MARGIN_DB
            )
        if limited:
            findings.append(Finding("true_peak_limited", "info", label))
        output_name = f"out-{label}.{'ogg' if spec.codec == 'opus' else 'mp3'}"
        out_path = ws.safe_path(output_name)

        applied = gain
        after: ffmpeg.Measurement | None = None
        data = b""
        for attempt in range(MAX_PEAK_RETRIES + 1):
            if out_path.exists():
                out_path.unlink()
            chain = "" if mode == "none" else _gain_chain(applied, ceiling if limited else None)
            args = ffmpeg.build_encode_args(
                input_path,
                fmt,
                out_path,
                spec,
                channels,
                max_seconds,
                chain,
                prefix,
                voice=profile.category == "voice",
                max_output_bytes=profile.max_output_bytes,
            )
            result = self._run(ws, args, deadline, cancelled)
            if result.returncode != 0:
                raise TranscodeError("encode_failed")
            data = ws.read(output_name, profile.max_output_bytes)
            if not data:
                raise TranscodeError("encode_failed")
            after = self._measure_output(
                ws, output_name, spec, channels, max_seconds, deadline, cancelled
            )
            excess = self._overshoot(after, mode, peak_target, ceiling)
            if excess <= 0:
                break
            if attempt < MAX_PEAK_RETRIES:
                findings.append(Finding("true_peak_retry", "info", label))
                applied -= excess + (RETRY_STEP_DB if mode == "integrated" else 0.1)
                limited = mode == "integrated"
            else:
                findings.append(Finding("true_peak_over_ceiling", "warning", label))
        assert after is not None

        if mode == "integrated" and after.integrated_lufs is not None and ld.integrated_lufs is not None:
            if abs(after.integrated_lufs - ld.integrated_lufs) > ld.tolerance_lu and not limited:
                findings.append(Finding("loudness_target_missed", "warning", label))
            elif limited and after.integrated_lufs < ld.integrated_lufs - ld.tolerance_lu:
                findings.append(Finding("loudness_target_missed", "warning", label))
        if mode == "peak" and after.sample_peak_dbfs is not None and peak_target is not None:
            if abs(after.sample_peak_dbfs - peak_target) > PEAK_TOLERANCE_DB:
                findings.append(Finding("peak_target_missed", "warning", label))

        facts = self._verify_output(data, spec, channels, source, profile, label, findings)
        facts["measured_after"] = after.as_facts()
        facts["mode"] = mode
        facts["label"] = label
        return (
            AudioOutput(
                label=label,
                codec=spec.codec,
                container=spec.container,
                content_type=CONTENT_TYPES[spec.container],
                data=data,
                facts=facts,
            ),
            {**before.as_facts(), "mode": mode},
            applied,
            findings,
        )

    @staticmethod
    def _overshoot(after: ffmpeg.Measurement, mode: str, peak_target: float | None, ceiling: float) -> float:
        """dB by which the decoded output is over its limit (0 when within). Integrated and
        peak profiles are both held under the true-peak ceiling; a peak profile is also held
        within `PEAK_RETRY_DB` of its sample-peak target, because a lossy encode can overshoot."""
        if mode == "none":
            return 0.0
        excess = 0.0
        tp = after.true_peak_dbtp
        if tp is not None and math.isfinite(tp) and tp > ceiling + 0.05:
            excess = tp - ceiling
        sp = after.sample_peak_dbfs
        if mode == "peak" and peak_target is not None and sp is not None and math.isfinite(sp):
            if sp > peak_target + PEAK_RETRY_DB:
                excess = max(excess, sp - peak_target)
        return excess

    def _measure_output(
        self,
        ws: Workspace,
        name: str,
        spec: OutputSpec,
        channels: int,
        max_seconds: float,
        deadline: Deadline | None,
        cancelled: Callable[[], bool] | None,
    ) -> ffmpeg.Measurement:
        fmt = "ogg" if spec.codec == "opus" else "mp3"
        # Decode as delivered: no resample or downmix, so the numbers are what a player gets.
        layout = "mono" if channels == 1 else "stereo"
        prefix = f"aformat=sample_rates={spec.sample_rate}:channel_layouts={layout}"
        args = ffmpeg.build_measure_ebur128_args(ws.safe_path(name), fmt, max_seconds, prefix)
        result = self._run(ws, args, deadline, cancelled)
        if result.returncode != 0:
            raise TranscodeError("output_reinspection_failed")
        try:
            return ffmpeg.parse_ebur128(result.stderr)
        except ValueError:
            raise TranscodeError("measure_failed") from None

    def _verify_output(
        self,
        data: bytes,
        spec: OutputSpec,
        channels: int,
        source: dict[str, Any],
        profile: AudioTranscodeProfile,
        label: str,
        findings: list[Finding],
    ) -> dict[str, Any]:
        from lai_processing.processors.audio.inspector import sniff

        expected = "ogg" if spec.codec == "opus" else "mp3"
        if sniff(data[:16]) != expected:
            raise TranscodeError("output_reinspection_failed")
        inspection = inspect_audio(
            io.BytesIO(data), len(data), _FORMAT_TYPES[expected], AudioSettings()
        )
        meta = inspection.metadata
        if inspection.report.has_errors:
            raise TranscodeError("output_reinspection_failed")
        want_codec = "opus" if spec.codec == "opus" else "mp3"
        if meta.get("codec") != want_codec or meta.get("channels") != channels:
            raise TranscodeError("output_reinspection_failed")
        out_rate = meta.get("sample_rate_hz")
        # Opus is stored at 48 kHz in the header whatever the encoder rate; MP3 keeps its rate.
        if spec.codec == "mp3" and out_rate != spec.sample_rate:
            raise TranscodeError("output_reinspection_failed")
        seconds = meta.get("duration_seconds")
        src_seconds = source["duration_seconds"]
        tolerance = 0.06 if profile.loop else 0.15 + 0.01 * src_seconds
        if isinstance(seconds, (int, float)):
            if abs(seconds - src_seconds) > tolerance:
                findings.append(
                    Finding("loop_length_drift" if profile.loop else "duration_drift", "warning", label)
                )
        else:
            findings.append(Finding("duration_unavailable", "warning", label))
        bitrate = None
        if isinstance(seconds, (int, float)) and seconds > 0:
            bitrate = int(round(len(data) * 8 / seconds / 1000))
        return {
            "codec": spec.codec,
            "container": spec.container,
            "content_type": CONTENT_TYPES[spec.container],
            "sample_rate_hz": spec.sample_rate if spec.codec == "opus" else out_rate,
            "channels": channels,
            "duration_seconds": seconds,
            "bitrate_kbps": bitrate,
            "size_bytes": len(data),
            "sha256": _sha256(data),
            "metadata_free": True,
        }
