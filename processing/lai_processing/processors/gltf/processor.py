"""The `asset.glb_validator` processor (job type `asset.validate_model`, LAI-LAMBDA-002).

It reads the engine-verified input copy, validates it as a GLB with `validate_glb`, and reports
findings in the Asset Library shape plus deterministic metadata. The verdict is `fail` when any
finding is an error, `pass` otherwise. A bad file is a *finding*, never a job error: the job
succeeds with a `fail` verdict, so Django records why the version was refused. Only
cancellation and the deadline (from `context.check()`), a missing input, or an internal fault
end the job as an error.

Processing success is not approval: Django records the result for staff review (ADR-061).
"""

from __future__ import annotations

from typing import Final

from ...contracts.profiles import OptionSpec, ProcessingProfile
from ...contracts.results import Verdict
from ...core.canonical import canonical_json
from ...core.errors import ErrorCode, ProcessingError
from ...core.limits import DEFAULT_LIMITS, ResourceLimits
from ...core.processor import ProcessingContext, Processor, ProcessorOutput
from .document import COMPLEXITY_DEFAULTS, GlbSettings, validate_glb
from .metadata import build_metadata

__all__ = ["GLB_PROFILE", "GLB_REPORT_TYPE", "GlbValidatorProcessor"]

GLB_REPORT_TYPE: Final = "report.glb_validation"
GLB_REPORT_LOGICAL_ID: Final = "glb-report"
MAX_TEXTURE_DIMENSION: Final = 16_384

GLB_LIMITS: Final = ResourceLimits(
    max_input_bytes=DEFAULT_LIMITS.max_input_bytes,
    max_output_bytes=DEFAULT_LIMITS.max_output_bytes,
    max_execution_seconds=DEFAULT_LIMITS.max_execution_seconds,
    max_temp_bytes=DEFAULT_LIMITS.max_temp_bytes,
    max_artifact_count=DEFAULT_LIMITS.max_artifact_count,
    max_metadata_bytes=DEFAULT_LIMITS.max_metadata_bytes,
    max_message_bytes=DEFAULT_LIMITS.max_message_bytes,
    complexity=COMPLEXITY_DEFAULTS,
)

GLB_PROFILE: Final = ProcessingProfile(
    profile_id="glb-default",
    version=1,
    job_type="asset.validate_model",
    description="Validate a GLB model (structure, references, limits) and extract metadata.",
    options={
        "max_texture_dimension": OptionSpec(
            "int", default=8192, minimum=1, maximum=MAX_TEXTURE_DIMENSION
        ),
        "require_animations": OptionSpec("bool", default=False),
        "write_report": OptionSpec("bool", default=False),
    },
    limits=GLB_LIMITS,
)


class GlbValidatorProcessor(Processor):
    processor_id = "asset.glb_validator"
    version = "1.0.0"
    job_types = frozenset({"asset.validate_model"})

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return (GLB_PROFILE,)

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})
        settings = GlbSettings.resolve(
            context.limits.complexity,
            max_texture_dimension=int(context.options.get("max_texture_dimension", 8192)),
            require_animations=context.options.get("require_animations") is True,
        )
        with open(context.input_path, "rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            if size > context.limits.max_input_bytes:
                raise ProcessingError(
                    ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"}
                )
            outcome = validate_glb(handle, size, settings, context.check)
        context.check()
        report = outcome.report
        metadata = build_metadata(outcome, context.limits.max_metadata_bytes)
        findings = report.findings()
        verdict = Verdict.FAIL if report.has_errors else Verdict.PASS
        if context.options.get("write_report") is True:
            body = {
                "findings": [f.to_dict() for f in findings],
                "metadata": metadata,
                "verdict": verdict.value,
                "warnings": [w.to_dict() for w in report.warnings()],
            }
            context.write_artifact(
                logical_id=GLB_REPORT_LOGICAL_ID,
                artifact_type=GLB_REPORT_TYPE,
                data=canonical_json(body),
                content_type="application/json",
                extension="json",
            )
        return ProcessorOutput(
            verdict=verdict, metadata=metadata, findings=findings, warnings=report.warnings()
        )
