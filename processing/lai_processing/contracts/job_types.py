"""The closed catalog of job types.

A job type is declared here, in code, before any message may name it: there is no dynamic
registration of job types and no loading of code from a message. Whether a *processor* exists
for a declared job type is a separate question answered by the processor registry, so a job
type can be declared (and its contract frozen) before its processor is built.

Asset job types require an `AssetContext` and an input object, and their subject must be the
asset version they process. Other job categories (for example a future report or export job)
declare their own subject type and need not reference an asset at all.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

from ..core.errors import ErrorCode, ProcessingError

__all__ = ["JOB_TYPES", "JobTypeSpec", "job_type_spec"]


@dataclass(frozen=True, slots=True)
class JobTypeSpec:
    job_type: str
    category: str
    requires_asset: bool
    requires_input: bool
    # None means any subject type is accepted.
    subject_type: str | None
    owner_task: str
    description: str


ASSET_VERSION_SUBJECT: Final = "asset_version"

_SPECS: Final = (
    JobTypeSpec(
        job_type="reference.checksum",
        category="reference",
        requires_asset=False,
        requires_input=True,
        subject_type=None,
        owner_task="LAI-LAMBDA-001",
        description="Reference job: verify the input checksum and report deterministic metadata.",
    ),
    JobTypeSpec(
        job_type="asset.validate_model",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-002",
        description="Validate a GLB/glTF model version and extract its metadata.",
    ),
    JobTypeSpec(
        job_type="asset.process_audio",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-008",
        description="Validate and analyse an audio version (reserved).",
    ),
    JobTypeSpec(
        job_type="asset.analyze_animation",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-009",
        description="Inspect the animation clips, skins and joints of a GLB model version.",
    ),
    JobTypeSpec(
        job_type="asset.optimize",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-010",
        description="Produce optimised derived artifacts for a version (reserved).",
    ),
)

JOB_TYPES: Final[Mapping[str, JobTypeSpec]] = MappingProxyType({s.job_type: s for s in _SPECS})


def job_type_spec(job_type: object) -> JobTypeSpec:
    if not isinstance(job_type, str) or job_type not in JOB_TYPES:
        raise ProcessingError(ErrorCode.UNSUPPORTED_JOB_TYPE, {"field": "job_type"})
    return JOB_TYPES[job_type]
