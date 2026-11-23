"""The `asset.audio_inspector` processor (job type `asset.process_audio`, LAI-LAMBDA-008 phase 1).

Phase 1 is inspection only: it reads the engine-verified input copy and reports header facts
(format, codec, duration, sample rate, channels, sample width, bit rate, structure), findings and
the inspection's limitations. It never transcodes, normalises or writes artifacts. A malformed
file is a *finding* (the job succeeds with verdict `fail`); only cancellation, the deadline, an
oversized input or an internal fault end the job as an error. Standard library only: no FFmpeg,
no subprocess, no native code. Staff assets only, never child recordings.

Processing success is not approval: Django keeps the result on the job for staff review.
"""

from __future__ import annotations

from typing import Final

from ...contracts.profiles import ProcessingProfile
from ...contracts.results import Verdict
from ...core.errors import ErrorCode, ProcessingError
from ...core.limits import DEFAULT_LIMITS, MIB, ResourceLimits
from ...core.processor import ProcessingContext, Processor, ProcessorOutput
from .facts import AudioSettings
from .inspector import inspect_audio

__all__ = ["AUDIO_COMPLEXITY", "AUDIO_LIMITS", "AUDIO_PROFILE", "AudioInspectorProcessor"]

#: The Asset Library's audio upload ceiling (`LAI_ASSET_MAX_AUDIO_BYTES`, default 20 MiB in
#: lai/apps/assets/validation_media.py). A stored audio version is never larger.
MAX_AUDIO_INPUT_BYTES: Final = 20 * MIB

_DEFAULTS: Final = AudioSettings()
AUDIO_COMPLEXITY: Final = {
    "max_wav_chunks": _DEFAULTS.max_wav_chunks,
    "max_mp3_frames": _DEFAULTS.max_mp3_frames,
    "max_ogg_pages": _DEFAULTS.max_ogg_pages,
    "max_id3_bytes": _DEFAULTS.max_id3_bytes,
}

AUDIO_LIMITS: Final = ResourceLimits(
    max_input_bytes=MAX_AUDIO_INPUT_BYTES,
    max_output_bytes=DEFAULT_LIMITS.max_output_bytes,
    max_execution_seconds=DEFAULT_LIMITS.max_execution_seconds,
    max_temp_bytes=DEFAULT_LIMITS.max_temp_bytes,
    max_artifact_count=DEFAULT_LIMITS.max_artifact_count,
    max_metadata_bytes=DEFAULT_LIMITS.max_metadata_bytes,
    max_message_bytes=DEFAULT_LIMITS.max_message_bytes,
    complexity=AUDIO_COMPLEXITY,
)

AUDIO_PROFILE: Final = ProcessingProfile(
    profile_id="audio-inspect",
    version=1,
    job_type="asset.process_audio",
    description="Inspect an audio file's container and codec headers (no decoding, no "
    "transcoding) and report its metadata and findings.",
    options={},
    limits=AUDIO_LIMITS,
)


def settings_from(complexity) -> AudioSettings:
    """Scan bounds from the effective complexity limits (missing counters keep the defaults)."""
    return AudioSettings(
        max_wav_chunks=int(complexity.get("max_wav_chunks", _DEFAULTS.max_wav_chunks)),
        max_mp3_frames=int(complexity.get("max_mp3_frames", _DEFAULTS.max_mp3_frames)),
        max_ogg_pages=int(complexity.get("max_ogg_pages", _DEFAULTS.max_ogg_pages)),
        max_id3_bytes=int(complexity.get("max_id3_bytes", _DEFAULTS.max_id3_bytes)),
    )


class AudioInspectorProcessor(Processor):
    processor_id = "asset.audio_inspector"
    version = "1.0.0"
    job_types = frozenset({"asset.process_audio"})

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return (AUDIO_PROFILE,)

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})
        settings = settings_from(context.limits.complexity)
        with open(context.input_path, "rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            if size > context.limits.max_input_bytes:
                raise ProcessingError(
                    ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"}
                )
            inspection = inspect_audio(
                handle, size, context.request.input.content_type, settings, context.check
            )
        context.check()
        report = inspection.report
        return ProcessorOutput(
            verdict=Verdict.FAIL if report.has_errors else Verdict.PASS,
            metadata=inspection.metadata,
            findings=report.findings(),
            warnings=report.warnings(),
        )
