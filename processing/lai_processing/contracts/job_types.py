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

__all__ = [
    "ARTIFACT_ROLES",
    "CONTENT_TYPE_EXTENSIONS",
    "JOB_TYPES",
    "STAFF_CAPTURE_ROLES",
    "ArtifactRoleSpec",
    "JobTypeSpec",
    "job_type_spec",
    "role_spec",
]

KIB: Final = 1024
MIB: Final = 1024 * 1024

#: The file extensions an artifact key may carry for each content type (a key's extension never
#: comes from a file name; it must agree with the declared content type).
CONTENT_TYPE_EXTENSIONS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "audio/ogg": ("ogg", "opus"),
        "audio/mpeg": ("mp3",),
        "application/json": ("json",),
        "image/webp": ("webp",),
        "image/png": ("png",),
        "image/jpeg": ("jpg", "jpeg"),
        "image/ktx2": ("ktx2",),
        "model/gltf-binary": ("glb",),
    }
)


@dataclass(frozen=True, slots=True)
class ArtifactRoleSpec:
    """One declared output role of a job type (or of staff capture): what a worker may report.

    Django rejects any artifact whose role is not declared for the job's kind, whose content
    type is not listed, whose size is above `max_size_bytes`, or when a result carries more than
    `max_count` files of the role. `promotable` says whether staff may promote the artifact into
    a new unpublished asset version (`apps.assets.artifact_promotion`)."""

    role: str
    content_types: tuple[str, ...]
    max_size_bytes: int
    max_count: int
    promotable: bool
    producer: str = "job"  # "job" (a worker) or "staff_capture" (a browser capture, no job)

    def __post_init__(self) -> None:
        for content_type in self.content_types:
            if content_type not in CONTENT_TYPE_EXTENSIONS:
                raise ValueError(f"role {self.role}: no extension rule for {content_type}")

    def extensions_for(self, content_type: str) -> tuple[str, ...]:
        return CONTENT_TYPE_EXTENSIONS.get(content_type, ())


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
    # The artifact roles this job type may produce. Empty: the type writes no artifacts.
    artifact_roles: tuple[ArtifactRoleSpec, ...] = ()

    def role(self, role: str) -> ArtifactRoleSpec | None:
        for spec in self.artifact_roles:
            if spec.role == role:
                return spec
        return None


ASSET_VERSION_SUBJECT: Final = "asset_version"

_IMAGE_TYPES: Final = ("image/webp", "image/png", "image/jpeg")
_REPORT: Final = "application/json"

# Roles and bounds (docs/processing/DERIVED_ARTIFACTS.md section 3, ADR-066). A bound is a ceiling
# for Django's verification; a workload's own measurement may set a tighter limit in its profile.
_AUDIO_ROLES: Final = (
    ArtifactRoleSpec("audio.transcoded", ("audio/ogg", "audio/mpeg"), 20 * MIB, 2, True),
    ArtifactRoleSpec("audio.report", (_REPORT,), 64 * KIB, 1, False),
)
_IMAGE_ROLES: Final = (
    ArtifactRoleSpec("image.converted", _IMAGE_TYPES, 8 * MIB, 3, True),
    ArtifactRoleSpec("image.resized", _IMAGE_TYPES, 8 * MIB, 4, True),
    ArtifactRoleSpec("image.thumbnail", _IMAGE_TYPES, 512 * KIB, 3, False),
)
_OPTIMIZE_ROLES: Final = (
    ArtifactRoleSpec("model.optimized", ("model/gltf-binary",), 32 * MIB, 1, True),
    ArtifactRoleSpec("texture.compressed", ("image/ktx2",), 16 * MIB, 4, True),
    ArtifactRoleSpec("model.optimize_report", (_REPORT,), 64 * KIB, 1, False),
)
# Opt-in report artifacts (`write_report`) of the inspection job types; never promotable.
_REFERENCE_ROLES: Final = (ArtifactRoleSpec("report.reference", (_REPORT,), 1 * MIB, 16, False),)
_VALIDATE_MODEL_ROLES: Final = (
    ArtifactRoleSpec("report.glb_validation", (_REPORT,), 1 * MIB, 1, False),
)
#: Roles written by Django itself (staff browser capture), never by a worker.
STAFF_CAPTURE_ROLES: Final[tuple[ArtifactRoleSpec, ...]] = (
    ArtifactRoleSpec(
        "model.thumbnail",
        ("image/webp", "image/png"),
        512 * KIB,
        1,
        False,
        producer="staff_capture",
    ),
)

_SPECS: Final = (
    JobTypeSpec(
        job_type="reference.checksum",
        category="reference",
        requires_asset=False,
        requires_input=True,
        subject_type=None,
        owner_task="LAI-LAMBDA-001",
        description="Reference job: verify the input checksum and report deterministic metadata.",
        artifact_roles=_REFERENCE_ROLES,
    ),
    JobTypeSpec(
        job_type="asset.validate_model",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-002",
        description="Validate a GLB/glTF model version and extract its metadata.",
        artifact_roles=_VALIDATE_MODEL_ROLES,
    ),
    JobTypeSpec(
        job_type="asset.process_audio",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-008",
        description="Inspect an audio version's container and codec headers (phase 1; no "
        "transcoding).",
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
        description="Produce optimised derived artifacts for a version (Meshopt, then KTX2).",
        artifact_roles=_OPTIMIZE_ROLES,
    ),
    JobTypeSpec(
        job_type="asset.transcode_audio",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-008",
        description="Transcode and loudness-normalise an audio version (LGPL FFmpeg; Opus "
        "primary, MP3 alternative). Staff-owned audio only.",
        artifact_roles=_AUDIO_ROLES,
    ),
    JobTypeSpec(
        job_type="asset.convert_image",
        category="asset",
        requires_asset=True,
        requires_input=True,
        subject_type=ASSET_VERSION_SUBJECT,
        owner_task="LAI-LAMBDA-013",
        description="Convert, resize or thumbnail an image version (Pillow). Staff-owned "
        "images only.",
        artifact_roles=_IMAGE_ROLES,
    ),
)

JOB_TYPES: Final[Mapping[str, JobTypeSpec]] = MappingProxyType({s.job_type: s for s in _SPECS})


def job_type_spec(job_type: object) -> JobTypeSpec:
    if not isinstance(job_type, str) or job_type not in JOB_TYPES:
        raise ProcessingError(ErrorCode.UNSUPPORTED_JOB_TYPE, {"field": "job_type"})
    return JOB_TYPES[job_type]


#: Every declared role by name: job outputs and staff capture.
ARTIFACT_ROLES: Final[Mapping[str, ArtifactRoleSpec]] = MappingProxyType(
    {
        spec.role: spec
        for spec in (*(r for s in _SPECS for r in s.artifact_roles), *STAFF_CAPTURE_ROLES)
    }
)


def role_spec(role: object) -> ArtifactRoleSpec | None:
    """The declared spec of `role`, or None when no job type or capture declares it."""
    return ARTIFACT_ROLES.get(role) if isinstance(role, str) else None
