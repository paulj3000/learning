"""The `asset.glb_optimizer` processor: the GLB optimizer plugged into the ADR-061 engine.

`lai_processing.core.execution.ExecutionEngine` owns the request checks, the verified input copy,
limits, deadlines and the artifact key discipline (`ProcessingContext.write_artifact`). This
processor only adapts:

- profile `meshopt-conservative` v1 runs `optimize_meshopt`; `ktx2-basisu` v1 runs
  `optimize_ktx2` with Workstream D's texture preparer;
- a success writes `model.optimized` (logical id `model`, `model/gltf-binary`) and
  `model.optimize_report` (logical id `report`, JSON) and returns verdict `pass` with a compact
  summary in the metadata;
- an optimization that would not be safe or useful (no size or GPU gain, preservation
  difference, invalid output, input it cannot handle) is a `fail` verdict with a finding and
  **no artifacts**: the job succeeded, the answer is "do not use this";
- native runtime failures (timeout, crash, missing tool) map to contract errors, retryable
  exactly when the runtime says so.

The tools come from configuration (`ToolPaths`), never from the job. Constants shared with
Django live in `lai_processing.processors.gltf.compression.optimize_contract`.
"""

from __future__ import annotations

import json
from typing import Any, Final

from lai_processing.contracts.profiles import ProcessingProfile
from lai_processing.contracts.results import Finding, Severity, Verdict
from lai_processing.core.errors import ErrorCode, ProcessingError
from lai_processing.core.processor import ProcessingContext, Processor, ProcessorOutput
from lai_processing.processors.gltf.compression.optimize_contract import (
    JOB_TYPE,
    OPTIMIZE_LIMITS,
    PROCESSOR_ID,
    PROCESSOR_VERSION,
    ROLE_MODEL,
    ROLE_REPORT,
    variant_for_profile,
)

from ..runtime import Deadline, Workspace
from .ktx2 import optimize_ktx2
from .meshopt import OptimizeError, ToolPaths, optimize_meshopt
from .profiles import KTX2_BASISU, MESHOPT_CONSERVATIVE, OptimizeProfile
from .texture_prep import PrepareTexture

__all__ = ["GlbOptimizeProcessor", "artifact_facts", "summary"]

_PROFILES: Final[dict[str, OptimizeProfile]] = {
    "meshopt": MESHOPT_CONSERVATIVE,
    "ktx2": KTX2_BASISU,
}

#: Outcomes that are an answer about the model, not a job failure: verdict `fail`, no artifacts.
_VERDICT_CODES: Final = frozenset(
    {
        "source_unreadable",
        "source_already_compressed",
        "no_size_gain",
        "size_limit",
        "no_gpu_gain",
        "no_textures",
        "unclassified_texture",
        "mixed_texture_usage",
        "unsupported_image_source",
        "unsupported_layout",
        "output_invalid",
        "output_unreadable",
        "preservation_failed",
        "texture_needs_resize",
        "texture_type",
        "texture_unreadable",
        "tool_failed",
    }
)

_FINDING_TEXT: Final = {
    "source_unreadable": "The model could not be read for optimization.",
    "source_already_compressed": "The model already uses compression; it was not optimized again.",
    "no_size_gain": "Optimization would not make the model smaller, so nothing was produced.",
    "size_limit": "The KTX2 model would be too much larger than the original.",
    "no_gpu_gain": "KTX2 would not reduce texture memory, so nothing was produced.",
    "no_textures": "The model has no textures to convert to KTX2.",
    "unclassified_texture": (
        "A texture is not used by a known material slot, so its colour space is unknown."
    ),
    "mixed_texture_usage": "One texture image is used both as colour and as data.",
    "unsupported_image_source": "A texture is not stored inside the model file.",
    "unsupported_layout": "The model's binary layout cannot be rewritten safely.",
    "output_invalid": "The optimized model would not pass validation.",
    "output_unreadable": "The optimized model could not be read back.",
    "preservation_failed": (
        "Optimization would change something the game relies on (see the report)."
    ),
    "texture_needs_resize": "A texture cannot be encoded at its size.",
    "texture_type": "A texture is not PNG or JPEG.",
    "texture_unreadable": "A texture could not be read.",
    "tool_failed": "The optimization tool did not produce a model.",
}

#: Native runtime codes -> (contract code, reason). Mirrors the audio processor's map.
_RUNTIME: Final = {
    "timeout": (ErrorCode.PROCESSING_TIMEOUT, "tool_timeout"),
    "deadline_exceeded": (ErrorCode.PROCESSING_TIMEOUT, "deadline"),
    "cancelled": (ErrorCode.CANCELLED, "cancelled"),
    "resource_limit": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "tool_resource"),
    "output_too_large": (ErrorCode.RESOURCE_LIMIT_EXCEEDED, "output_too_large"),
    "tool_crashed": (ErrorCode.TEMPORARY_FAILURE, "tool_crashed"),
    "spawn_failed": (ErrorCode.TEMPORARY_FAILURE, "spawn_failed"),
    "workspace_error": (ErrorCode.TEMPORARY_FAILURE, "workspace"),
}


def _profile(variant: str, optimize: OptimizeProfile) -> ProcessingProfile:
    return ProcessingProfile(
        profile_id=optimize.name,
        version=optimize.version,
        job_type=JOB_TYPE,
        description=f"Optimize a GLB model ({variant}): {optimize.label}.",
        options={},
        limits=OPTIMIZE_LIMITS,
    )


def summary(report: dict[str, Any]) -> dict[str, Any]:
    """The compact, value-free facts kept in the result metadata (the full report is the
    `model.optimize_report` artifact)."""
    textures = report.get("textures") or {}
    out: dict[str, Any] = {
        "profile": report.get("profile"),
        "source_bytes": report["source"]["bytes"],
        "output_bytes": report["output"]["bytes"],
        "size_ratio": report["size_ratio"],
        "processing_seconds": report.get("processing_seconds"),
        "preserved": not report["preservation"]["differences"],
        "animation_clips": len(report["animation"]["clips"]),
        "triangles": report["geometry"]["output"]["triangle_count"],
        "extensions_required": report["geometry"]["output"]["extensions_required"],
    }
    if "gpu_bytes_estimate_after" in textures:
        out["gpu_bytes_before"] = textures["gpu_bytes_estimate_before"]
        out["gpu_bytes_after"] = textures["gpu_bytes_estimate_after"]
        out["texture_formats"] = sorted(
            {f"{e['codec']}/{e['color_space']}" for e in textures.get("encoded", [])}
        )
    else:
        out["gpu_bytes_before"] = out["gpu_bytes_after"] = textures.get("gpu_bytes_estimate")
    return out


def artifact_facts(variant: str, facts: dict[str, Any]) -> dict[str, Any]:
    """At most 12 scalar facts for the `model.optimized` artifact row (shown in Django Admin)."""
    out: dict[str, Any] = {
        "variant": variant,
        "source_bytes": facts["source_bytes"],
        "output_bytes": facts["output_bytes"],
        "size_ratio": facts["size_ratio"],
        "preserved": facts["preserved"],
        "triangles": facts["triangles"],
        "animation_clips": facts["animation_clips"],
        "extensions": ",".join(facts["extensions_required"])[:64],
    }
    if facts.get("gpu_bytes_before") is not None:
        out["gpu_bytes_before"] = facts["gpu_bytes_before"]
        out["gpu_bytes_after"] = facts["gpu_bytes_after"]
    if facts.get("texture_formats"):
        out["texture_formats"] = ",".join(facts["texture_formats"])[:64]
    return out


def _compact_report(report: dict[str, Any]) -> bytes:
    body = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    if len(body) <= 60 * 1024:
        return body
    trimmed = dict(report)
    trimmed["geometry"] = {"output": report["geometry"]["output"]}
    trimmed.pop("ktx2", None)
    return json.dumps(trimmed, sort_keys=True, separators=(",", ":")).encode()


class GlbOptimizeProcessor(Processor):
    processor_id = PROCESSOR_ID
    version = PROCESSOR_VERSION
    job_types = frozenset({JOB_TYPE})

    def __init__(
        self,
        tools: ToolPaths,
        *,
        workspace_base: str | None = None,
        prepare: PrepareTexture | None = None,
        run=None,  # type: ignore[no-untyped-def]  - test seam for the native runner
    ) -> None:
        self._tools = tools
        self._workspace_base = workspace_base
        self._prepare = prepare
        self._run = run

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return tuple(_profile(name, p) for name, p in _PROFILES.items())

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        assert context.input_path is not None  # noqa: S101 - checked in validate
        variant = variant_for_profile(context.profile.profile_id, context.profile.version)
        if variant is None:
            raise ProcessingError(ErrorCode.INVALID_PROCESSING_PROFILE, {"field": "profile"})
        optimize = _PROFILES[variant.name]
        source = context.input_path.read_bytes()
        deadline = Deadline(
            lambda: max(0.0, context.deadline - context.clock.monotonic()) * 1000.0,
            reserve_seconds=5.0,
        )
        kwargs: dict[str, Any] = {
            "tools": self._tools,
            "profile": optimize,
            "deadline": deadline,
            "cancelled": lambda: context.cancellation.cancelled,
        }
        if self._run is not None:
            kwargs["run"] = self._run
        if variant.name == "ktx2" and self._prepare is not None:
            kwargs["prepare"] = self._prepare
        step = optimize_meshopt if variant.name == "meshopt" else optimize_ktx2
        try:
            with Workspace(base=self._workspace_base) as workspace:
                result = step(source, workspace=workspace, **kwargs)
        except OptimizeError as error:
            return self._refused(error)
        context.check()
        context.write_artifact(
            logical_id="model",
            artifact_type=ROLE_MODEL,
            data=result.output,
            content_type="model/gltf-binary",
            extension="glb",
        )
        context.write_artifact(
            logical_id="report",
            artifact_type=ROLE_REPORT,
            data=_compact_report(result.report),
            content_type="application/json",
            extension="json",
        )
        facts = summary(result.report)
        return ProcessorOutput(
            verdict=Verdict.PASS,
            metadata={
                "optimize": facts,
                # Read by Django's `artifact_results.safe_metadata` (scalars only, 12 keys).
                "tool_versions": dict(optimize.tool_versions),
                "artifact_facts": {"model": artifact_facts(variant.name, facts)},
            },
        )

    def _refused(self, error: OptimizeError) -> ProcessorOutput:
        if error.code in _RUNTIME:
            code, reason = _RUNTIME[error.code]
            raise ProcessingError(code, {"reason": reason}) from None
        if error.code not in _VERDICT_CODES and not error.code.startswith("texture_"):
            # A missing or altered binary, a bad argument: a deployment fault, never retried.
            raise ProcessingError(ErrorCode.UNEXPECTED_FAILURE, {"reason": "tool_failed"}) from None
        # Codes only: difference paths carry node and material names from the file, which stay
        # out of results (they are in nothing Django stores).
        details = sorted(
            {
                str(d.get("code", ""))[:64]
                for d in error.details[:50]
                if d.get("code") != "stderr_tail"
            }
        )
        finding = Finding(
            code=error.code[:64],
            severity=Severity.ERROR,
            message=_FINDING_TEXT.get(error.code, "The texture could not be prepared."),
            path="",
        )
        return ProcessorOutput(
            verdict=Verdict.FAIL,
            metadata={"optimize": {"refused": error.code, "details": details}},
            findings=(finding,),
        )
