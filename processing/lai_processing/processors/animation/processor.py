"""The `asset.animation_inspector` processor (job type `asset.analyze_animation`, LAI-LAMBDA-009).

It reads the engine-verified input copy and reports the facts `inspect.inspect_glb` extracts:
clips (exact names, durations, channels, samplers, keyframe counts, targets, interpolations),
skins and their joint hierarchy, plus findings. The verdict is `fail` when the file or its
animation data cannot be read correctly (any error finding), `pass` otherwise; warnings (missing
or duplicate names, exporter take names, targets outside skins) never fail it. A verdict is a
statement about the data, not an approval and not a mapping: the processor never names a
runtime animation state, and Django never writes `NpcModelVariant.animation_map` from it.

Read only: it writes no artifact and has no options that would.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Final

from ...contracts.profiles import ProcessingProfile
from ...contracts.results import Verdict
from ...core.canonical import canonical_json
from ...core.errors import ErrorCode, ProcessingError
from ...core.processor import ProcessingContext, Processor, ProcessorOutput
from ..gltf.processor import GLB_LIMITS
from ..gltf.report import Report
from .inspect import (
    ANIMATION_COMPLEXITY_DEFAULTS,
    MAX_LISTED_CLIPS,
    MAX_LISTED_SKINS,
    AnimationSettings,
    InspectionOutcome,
    inspect_glb,
)

__all__ = ["ANIMATION_PROFILE", "METADATA_VERSION", "AnimationInspectorProcessor", "build_metadata"]

METADATA_VERSION: Final = 1

# The GLB validator's limits (input size, time, metadata) with this processor's counters, so a
# change to the model input ceiling applies to both processors alike.
ANIMATION_LIMITS: Final = dataclasses.replace(GLB_LIMITS, complexity=ANIMATION_COMPLEXITY_DEFAULTS)

ANIMATION_PROFILE: Final = ProcessingProfile(
    profile_id="animation-default",
    version=1,
    job_type="asset.analyze_animation",
    description="Inspect a GLB model's animation clips, skins and joint hierarchy (read only).",
    options={},
    limits=ANIMATION_LIMITS,
)


def _cap(items: list[Any], limit: int, report: Report) -> list[Any]:
    if len(items) > limit:
        report.note(
            "metadata_list_truncated",
            f"A metadata list was shortened to its first {limit} entries.",
        )
        return items[:limit]
    return items


def build_metadata(outcome: InspectionOutcome, max_bytes: int) -> dict[str, Any]:
    """The deterministic metadata object, fitted under `max_bytes` of canonical JSON.

    Over the budget, per-clip target lists and per-skin root lists are emptied first, then the
    clip and skin lists themselves (`lists_truncated: true`, with a run warning); counts and
    `clip_count` always stay complete."""
    report = outcome.report
    layout = outcome.layout
    clips = _cap([dict(sorted(c.items())) for c in outcome.clips], MAX_LISTED_CLIPS, report)
    skins = _cap([dict(sorted(s.items())) for s in outcome.skins], MAX_LISTED_SKINS, report)
    metadata: dict[str, Any] = {
        "clip_count": len(outcome.clips),
        "clips": clips,
        "counts": outcome.counts,
        "document_read": outcome.document_read,
        "file_size_bytes": outcome.file_size,
        "format": "glb" if layout else None,
        "generic_clip_count": sum(1 for c in outcome.clips if c.get("generic_name")),
        "lists_truncated": False,
        "metadata_version": METADATA_VERSION,
        "skins": skins,
    }
    if len(canonical_json(metadata)) > max_bytes:
        metadata["clips"] = [{**c, "target_nodes": []} for c in clips]
        metadata["skins"] = [{**s, "root_joints": []} for s in skins]
        metadata["lists_truncated"] = True
    if len(canonical_json(metadata)) > max_bytes:
        metadata["clips"] = []
        metadata["skins"] = []
    if metadata["lists_truncated"]:
        report.note(
            "metadata_truncated",
            "Some per-item metadata lists did not fit in the result and were shortened.",
        )
    return dict(sorted(metadata.items()))


class AnimationInspectorProcessor(Processor):
    processor_id = "asset.animation_inspector"
    version = "1.0.0"
    job_types = frozenset({"asset.analyze_animation"})

    def profiles(self) -> tuple[ProcessingProfile, ...]:
        return (ANIMATION_PROFILE,)

    def validate(self, context: ProcessingContext) -> None:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})

    def process(self, context: ProcessingContext) -> ProcessorOutput:
        if context.input_path is None or context.request.input is None:
            raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "input"})
        settings = AnimationSettings.resolve(context.limits.complexity)
        with open(context.input_path, "rb") as handle:
            handle.seek(0, 2)
            size = handle.tell()
            if size > context.limits.max_input_bytes:
                raise ProcessingError(
                    ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "max_input_bytes"}
                )
            outcome = inspect_glb(handle, size, settings, context.check)
        context.check()
        metadata = build_metadata(outcome, context.limits.max_metadata_bytes)
        report = outcome.report
        return ProcessorOutput(
            verdict=Verdict.FAIL if report.has_errors else Verdict.PASS,
            metadata=metadata,
            findings=report.findings(),
            warnings=report.warnings(),
        )
