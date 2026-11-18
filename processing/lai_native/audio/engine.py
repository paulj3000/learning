"""The `asset.audio_transcoder` processor: the transcoder plugged into the ADR-061 engine.

`lai_processing.core.execution.ExecutionEngine` owns the request checks, the verified input
copy (size and SHA-256), limits, deadlines, error classification, the result and the artifact
key discipline (`ProcessingContext.write_artifact` confines every key to the attempt's prefix).
This processor only adapts: it hands the verified copy to `AudioTranscoder`, writes each output
as an `audio.transcoded` artifact plus one `audio.report` JSON artifact, and maps transcoder
failures onto the contract's error codes.

The job type `asset.transcode_audio` must be declared in `lai_processing.contracts.job_types`
(Workstream A registers it with the roles of docs/processing/COMPLETION_INTEGRATION.md section
4); registering this processor before that raises, by design.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Final

from lai_native.runtime import Deadline, ToolLimits, ToolSpec
from lai_processing.contracts.profiles import ProcessingProfile
from lai_processing.contracts.results import Finding, Severity, Verdict
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.limits import MIB, ResourceLimits
from lai_processing.core.processor import ProcessingContext, Processor, ProcessorOutput

from .processor import PROCESSOR_VERSION, AudioTranscoder, TranscodeError
from .profiles import DEFAULT_PROFILES, JOB_TYPE, AudioTranscodeProfile

__all__ = [
    "ARTIFACT_REPORT",
    "ARTIFACT_TRANSCODED",
    "AUDIO_TRANSCODE_LIMITS",
    "AudioTranscodeProcessor",
    "map_error",
    "profile_for",
]

ARTIFACT_TRANSCODED: Final = "audio.transcoded"
ARTIFACT_REPORT: Final = "audio.report"
_EXTENSIONS: Final = {"ogg": "ogg", "mp3": "mp3"}

AUDIO_TRANSCODE_LIMITS: Final = ResourceLimits(
    max_input_bytes=20 * MIB,
    max_output_bytes=48 * MIB,
    max_execution_seconds=300,
    max_temp_bytes=160 * MIB,
    max_artifact_count=4,  # up to three outputs and the report
    max_metadata_bytes=48 * 1024,
    max_message_bytes=64 * 1024,
)

#: Transcoder code -> (contract code, details reason). Reasons are fixed strings.
_MAP: Final = {
    "input_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "input_too_large"),
    "input_too_long": (ErrorCode.UNSUPPORTED_INPUT, "input_too_long"),
    "input_refused": (ErrorCode.INVALID_INPUT, "input_refused"),
    "unsupported_input": (ErrorCode.UNSUPPORTED_INPUT, "unsupported_input"),
    "silent_source": (ErrorCode.INVALID_INPUT, "silent_source"),
    "decode_failed": (ErrorCode.INVALID_INPUT, "decode_failed"),
    "measure_failed": (ErrorCode.UNEXPECTED_FAILURE, "measure_failed"),
    "encode_failed": (ErrorCode.UNEXPECTED_FAILURE, "encode_failed"),
    "output_reinspection_failed": (ErrorCode.UNEXPECTED_FAILURE, "output_reinspection_failed"),
    "profile_invalid": (ErrorCode.INVALID_PROCESSING_PROFILE, "profile_invalid"),
    "timeout": (ErrorCode.PROCESSING_TIMEOUT, "tool_timeout"),
    "deadline_exceeded": (ErrorCode.PROCESSING_TIMEOUT, "deadline"),
    "cancelled": (ErrorCode.CANCELLED, "cancelled"),
    "resource_limit": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "tool_resource"),
    "output_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "output_too_large"),
    "stdout_too_large": (ErrorCode.UNEXPECTED_FAILURE, "tool_output"),
    "tool_crashed": (ErrorCode.TEMPORARY_FAILURE, "tool_crashed"),
    "spawn_failed": (ErrorCode.TEMPORARY_FAILURE, "spawn_failed"),
    "workspace_error": (ErrorCode.TEMPORARY_FAILURE, "workspace"),
    # A missing or altered binary is a deployment fault: manual, never retried in a loop.
    "invalid_argument": (ErrorCode.UNEXPECTED_FAILURE, "invalid_argument"),
    "tool_failed": (ErrorCode.UNEXPECTED_FAILURE, "tool_failed"),
    "tool_missing": (ErrorCode.UNEXPECTED_FAILURE, "tool_missing"),
    "tool_not_executable": (ErrorCode.UNEXPECTED_FAILURE, "tool_not_executable"),
    "tool_not_configured": (ErrorCode.UNEXPECTED_FAILURE, "tool_not_configured"),
    "tool_checksum_mismatch": (ErrorCode.UNEXPECTED_FAILURE, "tool_checksum_mismatch"),
}


def map_error(error: TranscodeError) -> ProcessingError:
    code, reason = _MAP.get(error.code, (ErrorCode.UNEXPECTED_FAILURE, "tool_failed"))
    return ProcessingError(code, {"reason": reason})


def profile_for(profile: AudioTranscodeProfile) -> ProcessingProfile:
    return ProcessingProfile(
        profile_id=profile.profile_id,
        version=profile.version,
        job_type=JOB_TYPE,
        description=f"Transcode and loudness-normalise {profile.category} audio: {profile.description}",
        options={},
        limits=AUDIO_TRANSCODE_LIMITS,
    )


_SEVERITY: Final = {"info": Severity.INFO, "warning": Severity.WARNING, "error": Severity.ERROR}


class AudioTranscodeProcessor(Processor):
    processor_id = "asset.audio_transcoder"
    version = PROCESSOR_VERSION + ".0.0"
    job_types = frozenset({JOB_TYPE})

    def __init__(
        self,
        tool: ToolSpec,
        *,
        tool_limits: ToolLimits | None = None,
        workspace_base: str | None = None,
        runner: Callable | None = None,
        tool_version: str | None = None,
    ):
        kwargs = {"runner": runner} if runner is not None else {}
        self._transcoder = AudioTranscoder(
            tool,
            tool_limits,
            workspace_base=workspace_base,
            tool_version=tool_version,
            **kwargs,
        )
        self._by_ref = {(p.profile_id, p.version): p for p in DEFAULT_PROFILES.values()}

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return tuple(profile_for(p) for p in DEFAULT_PROFILES.values())

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        assert context.input_path is not None
        profile = self._by_ref.get((context.profile.profile_id, context.profile.version))
        if profile is None:
            raise ProcessingError(ErrorCode.INVALID_PROCESSING_PROFILE, {"field": "profile"})
        data = context.input_path.read_bytes()
        deadline = Deadline(
            lambda: max(0.0, context.deadline - context.clock.monotonic()) * 1000.0 + 0.0,
            reserve_seconds=2.0,
        )
        try:
            outcome = self._transcoder.transcode(
                data,
                profile,
                deadline=deadline,
                cancelled=lambda: context.cancellation.cancelled,
            )
        except TranscodeError as error:
            raise map_error(error) from None
        context.check()
        references = []
        for output in outcome.outputs:
            ref = context.write_artifact(
                logical_id=output.label,
                artifact_type=ARTIFACT_TRANSCODED,
                data=output.data,
                content_type=output.content_type,
                extension=_EXTENSIONS[output.container],
            )
            references.append(ref)
        report = json.dumps(outcome.facts, sort_keys=True, separators=(",", ":")).encode()
        context.write_artifact(
            logical_id="report",
            artifact_type=ARTIFACT_REPORT,
            data=report,
            content_type="application/json",
            extension="json",
        )
        metadata = dict(outcome.facts)
        metadata["outputs"] = [
            {**o.facts, "artifact_logical_id": o.label} for o in outcome.outputs
        ]
        findings = tuple(
            Finding(
                code=f.code,
                severity=_SEVERITY[f.severity],
                message=_FINDING_TEXT.get(f.code, "See the report."),
                path=f.label or "",
            )
            for f in outcome.findings
        )
        return ProcessorOutput(
            verdict=Verdict.PASS,
            metadata=metadata,
            findings=findings,
            warnings=(),
        )


#: Authored finding text (never derived from the file).
_FINDING_TEXT: Final = {
    "short_clip_peak_normalised": "The clip is short, so its peak level was set instead of its loudness.",
    "clipping_in_source": "The source already reaches full scale.",
    "true_peak_limited": "A limiter held the true peak under the ceiling.",
    "true_peak_retry": "The encoded peak was too high, so the output was encoded again with less gain.",
    "true_peak_over_ceiling": "The encoded true peak is still above the ceiling.",
    "loudness_target_missed": "The measured loudness is outside the target tolerance.",
    "peak_target_missed": "The measured peak is outside the target tolerance.",
    "loudness_range_above_target": "The source loudness range is wider than the profile target; it was not compressed.",
    "duration_drift": "The output length differs from the source by more than the tolerance.",
    "loop_length_drift": "The looping output length differs from the source; check the loop point.",
    "duration_unavailable": "The output length could not be read.",
    "optional_output_failed": "An optional output could not be produced.",
}
