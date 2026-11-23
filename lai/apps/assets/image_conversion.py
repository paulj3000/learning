"""Image conversion for the Asset Library (LAI-LAMBDA-013a, ADR-068, ADR-066).

Staff submit one of three actions for a validated, published or retired image version:

| Action | Contract profile | Output role |
|---|---|---|
| Convert image | `image-convert` | `image.converted` |
| Resize image | `image-resize` | `image.resized` |
| Generate thumbnail | `image-thumbnails` (128, 256, 512) | `image.thumbnail` |

Every action goes through `apps.assets.artifact_jobs.submit_derived_job`, so the control
(`LAI_IMAGE_CONVERSION`), the queue, the request identity, the idempotency key and the attempt
cap are the shared ones. The worker (Pillow, `lai_native.image`) writes private artifacts that
`apps.assets.artifact_results` verifies and records as `pending_review` rows. Nothing here
changes a version, publishes or promotes: review and promotion are `apps.assets.artifact_promotion`
(Django Admin, a separate permission).

This module imports only `lai_native.image.contract`, which has no Pillow dependency.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from lai_native.image import contract
from lai_native.image.errors import ImageError
from lai_processing.core.errors import ProcessingError

from . import artifact_jobs, artifact_results
from .models import VersionStatus

logger = logging.getLogger("lai.assets")

KIND = contract.JOB_TYPE
IMAGE_FORMATS = frozenset({"png", "jpeg", "webp"})
#: The same source states the other derived workloads accept.
ELIGIBLE_STATUSES = frozenset(
    {VersionStatus.VALIDATED, VersionStatus.PUBLISHED, VersionStatus.RETIRED}
)
IMAGE_ROLES = (contract.ROLE_CONVERTED, contract.ROLE_RESIZED, contract.ROLE_THUMBNAIL)

CONVERT, RESIZE, THUMBNAIL = "convert", "resize", "thumbnail"
ACTION_PROFILES = {
    CONVERT: contract.PROFILE_CONVERT,
    RESIZE: contract.PROFILE_RESIZE,
    THUMBNAIL: contract.PROFILE_THUMBNAILS,
}
ACTION_LABELS = {
    CONVERT: "Convert image",
    RESIZE: "Resize image",
    THUMBNAIL: "Generate thumbnail",
}

MESSAGES = {
    "not_image": "Only image versions can be converted.",
    "not_eligible": "Only validated, published or retired images can be converted.",
    "invalid_options": "Those conversion settings are not allowed.",
    "workload_disabled": "Image conversion is switched off.",
    "workload_queue_not_configured": "Image conversion is not set up yet.",
    "jobs_disabled": "Background jobs are switched off.",
    "attempts_exhausted": "This conversion has already been tried several times. "
    "Change the settings or check the background jobs page.",
    "resource_limit_exceeded": "This image is larger than image conversion allows.",
}


class ImageConversionRefused(Exception):
    """A conversion was refused. `message` is safe to show staff (no em dashes)."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code
        self.message = MESSAGES.get(code, "Image conversion is unavailable right now.")


def processor_version_resolver(profile_id: str, profile_version: int):
    return contract.current_processor(profile_id, profile_version)


def register() -> None:
    """Tell the result handler which processor version this build expects, so a result from an
    older processor is `processor_outdated`. Idempotent."""
    artifact_results.PROCESSOR_VERSION_RESOLVERS[KIND] = processor_version_resolver


register()


def enabled() -> bool:
    """True when `LAI_IMAGE_CONVERSION` is on and the image queue is usable."""
    from apps.jobs import workloads

    return workloads.workload_enabled(KIND)


def eligibility(version) -> str | None:
    """Why `version` cannot be converted (a code), or None."""
    if version.format not in IMAGE_FORMATS:
        return "not_image"
    if version.status not in ELIGIBLE_STATUSES:
        return "not_eligible"
    return None


def resolve_options(action: str, version, options: dict | None) -> dict:
    """The profile's resolved options, checked against the version's format. Raises
    `ImageConversionRefused("invalid_options")` for anything the processor would refuse."""
    ref = ACTION_PROFILES[action]
    declared = contract.PROFILE_DECLARATIONS[ref]
    try:
        resolved = dict(declared.resolve_options(options or {}))
        contract.plan(ref, resolved, version.format)
    except (ProcessingError, ImageError):
        raise ImageConversionRefused("invalid_options") from None
    return resolved


def submit(version, action: str, options: dict | None = None, *, user=None):
    """Submit one conversion job (or return the existing one for the same logical work).

    Raises `ImageConversionRefused` with a safe message: not an image, not eligible, bad
    settings, the control off (nothing is recorded, locked or queued), jobs disabled, attempts
    exhausted. Never changes or publishes the version."""
    from apps.jobs import services as jobs

    problem = eligibility(version)
    if problem:
        raise ImageConversionRefused(problem)
    resolved = resolve_options(action, version, options)
    try:
        job = artifact_jobs.submit_derived_job(
            version,
            kind=KIND,
            profile=ACTION_PROFILES[action],
            processor_version=contract.PROCESSOR_VERSION,
            options=resolved,
            limits=contract.IMAGE_LIMITS,
            user=user,
        )
    except jobs.WorkloadUnavailable as error:
        raise ImageConversionRefused(error.code) from None
    except jobs.JobsDisabled:
        raise ImageConversionRefused("jobs_disabled") from None
    except jobs.JobsError as error:
        raise ImageConversionRefused(error.code) from None
    logger.info("image conversion submitted job=%s action=%s", job.pk, action)
    return job


# --- what staff see -----------------------------------------------------------------------------


@dataclass(frozen=True)
class OutputRow:
    artifact_id: str
    logical_id: str
    role: str
    state: str
    format: str
    width: int | None
    height: int | None
    size_bytes: int
    source_width: int | None
    source_height: int | None
    source_size_bytes: int
    colour: str
    sanitized: bool | None
    previewable: bool


def _colour_text(facts: dict) -> str:
    action = facts.get("colour_action")
    klass = facts.get("colour_class")
    if action is None:
        return "not recorded"
    words = {
        "converted_to_srgb": "converted to sRGB",
        "assumed_srgb": "sRGB kept",
        "none": "no profile, read as sRGB",
        "none_data": "data channels, no colour change",
        "cmyk_converted": "CMYK converted to sRGB",
        "gray_profile_ignored": "gray, values kept",
    }
    text = words.get(str(action), str(action))
    return f"{text} (source: {klass})" if klass not in (None, "none") else text


def output_rows(version) -> list[OutputRow]:
    """The recorded outputs of this version's conversions, newest first."""
    from .models import DerivedArtifact

    rows = []
    queryset = DerivedArtifact.objects.filter(source_version=version, role__in=IMAGE_ROLES)
    for artifact in queryset.order_by("-created_at")[:60]:
        facts = artifact.metadata if isinstance(artifact.metadata, dict) else {}
        sanitized = facts.get("sanitized")
        rows.append(
            OutputRow(
                artifact_id=str(artifact.pk),
                logical_id=artifact.logical_id,
                role=artifact.role,
                state=artifact.state,
                format=str(facts.get("format") or artifact.content_type.removeprefix("image/")),
                width=facts.get("width"),
                height=facts.get("height"),
                size_bytes=artifact.size_bytes,
                source_width=facts.get("source_width"),
                source_height=facts.get("source_height"),
                source_size_bytes=version.size_bytes,
                colour=_colour_text(facts),
                sanitized=sanitized if isinstance(sanitized, bool) else None,
                previewable=artifact.state not in ("expired", "deleted"),
            )
        )
    return rows


def latest_job(version):
    return artifact_jobs.derived_jobs(version, KIND).first()
