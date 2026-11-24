"""NPC animation inspection on the canonical jobs path (`asset.analyze_animation`, LAI-LAMBDA-009,
ADR-064; docs/processing/NPC_ANIMATION_INSPECTION.md).

Staff ask, from the NPC model variant admin, what animation data the variant's model really has.
The media worker runs the read-only `asset.animation_inspector` processor over the stored GLB and
returns facts: exact clip names, durations, channels, samplers, keyframe counts, targets, skins
and the joint hierarchy, plus warnings. Nothing here decides what a clip means:

- `NpcModelVariant.animation_map` is never written by this module. Staff map states through the
  variant form, as before; `suggest_mapping` only *suggests* exact or case-insensitive name
  matches against `vocabulary.ANIMATION_STATES` and never anything for an exporter's default take
  name such as `Armature|mixamo.com|Layer0`.
- Nothing is published, and a published (or retired) version is never changed: its result stays
  on the job (`result_recorded`). Only a version that was never published (draft, validated or
  rejected) gets a copy in `metadata["animation_inspection"]` (`inspection_stored`).

`apply(job)` is the kind's handler. It runs once per job under the job row lock (held by
`apps.jobs.services.apply_result`), verifies the result against the request
(`apps.assets.processing.result_mismatch`) and the request against the version as stored now
(`identity_mismatch` with this kind and profile), then locks the asset and the version, the same
lock order model validation uses. Logs carry ids and codes only.
"""

from __future__ import annotations

import dataclasses
import logging
import uuid
from datetime import UTC, datetime

from django.db.models import Q

from apps.assets import processing as asset_processing

from .vocabulary import ANIMATION_STATES

logger = logging.getLogger("lai.npcs")

JOB_TYPE = "asset.analyze_animation"
PROFILE = ("animation-default", 1)
#: The formats the inspector reads (the GLB container only).
FORMATS = frozenset({"glb"})
#: Where a never-published version keeps its latest inspection summary.
METADATA_KEY = "animation_inspection"
#: Handler outcomes that accepted the result for its version (a resubmission returns the job).
APPLIED_OUTCOMES = frozenset({"inspection_stored", "result_recorded", "duplicate_result"})
#: Outcomes that mean the result does not belong to the version's current file.
MISMATCH_OUTCOMES = frozenset(
    {
        "result_invalid",
        "job_mismatch",
        "attempt_mismatch",
        "key_mismatch",
        "identity_mismatch",
        "profile_mismatch",
        "input_mismatch",
        "kind_mismatch",
        "subject_mismatch",
        "namespace_mismatch",
        "asset_mismatch",
        "storage_mismatch",
        "checksum_mismatch",
        "size_mismatch",
    }
)
MAX_SUMMARY_FINDINGS = 50
_NEVER_PUBLISHED = ("DRAFT", "VALIDATED", "REJECTED")


class InspectionRefused(Exception):
    """The version cannot be inspected; `code` is a safe, stable string."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


# --- submission --------------------------------------------------------------------------------


def inspection_request(version, *, job_id: str) -> dict:
    """The ADR-061 request for `version` as a dict (no database writes)."""
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key

    space = asset_processing.namespace()
    subject = SubjectRef(
        subject_type=asset_processing.SUBJECT_TYPE, subject_id=str(version.version_id)
    )
    profile_ref = ProfileRef(*PROFILE)
    processor, profile = asset_processing._registry().resolve(JOB_TYPE, profile_ref)
    options = profile.resolve_options({})
    source = InputObject(
        ref=ObjectRef("assets", version.storage_key, None, space),
        content_type=version.content_type,
        size_bytes=version.size_bytes,
        sha256=version.sha256,
    )
    # The logical key covers the exact version (subject), its file (key, SHA-256, size) and the
    # processor version: the same bytes inspected by the same code are the same work.
    key = idempotency_key(
        namespace=space,
        job_type=JOB_TYPE,
        subject=subject,
        profile=profile_ref,
        input=source,
        options=options,
        processor_version=processor.version,
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    request = ProcessingJobRequest(
        job_id=job_id,
        job_type=JOB_TYPE,
        namespace=space,
        subject=subject,
        profile=profile_ref,
        idempotency_key=key,
        correlation_id=uuid.uuid4().hex,
        attempt_id=str(uuid.uuid4()),
        attempt_number=1,
        submitted_at=stamp,
        input=source,
        asset=AssetContext(
            asset_id=version.asset.asset_id,
            asset_version_id=str(version.version_id),
            asset_version_number=version.number,
        ),
        expires_at=stamp + asset_processing.REQUEST_TTL,
        options=options,
        limits=dataclasses.replace(
            profile.limits,
            max_execution_seconds=min(
                profile.limits.max_execution_seconds, asset_processing.MAX_EXECUTION_SECONDS
            ),
        ),
    )
    return request.to_dict()


def inspection_jobs(version):
    """This version's `asset.analyze_animation` jobs, newest first (never locked)."""
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(
        kind=JOB_TYPE, subject_type=asset_processing.JOB_SUBJECT, subject_id=str(version.pk)
    ).order_by("-created_at")


def submit_animation_inspection(version, *, user):
    """Submit (or return) the animation inspection of `version`. Never changes the version or any
    variant.

    Reused: a job for the same logical work that is waiting, running, or whose result was
    accepted. A failed job, or one whose result was refused (a mismatch), may be submitted again
    as a new job. Raises `InspectionRefused` for a version that cannot be inspected, and
    `apps.jobs.services.JobsError` (`JobsDisabled` included) when submission is refused."""
    from apps.catalog.models import AssetStatus
    from apps.jobs import services as jobs
    from apps.jobs.models import JobStatus
    from lai_processing.core.errors import ProcessingError

    if version.format not in FORMATS:
        raise InspectionRefused("unsupported_format")
    if version.asset.status != AssetStatus.ACTIVE:
        raise InspectionRefused("asset_retired")
    job_id = str(uuid.uuid4())
    try:
        payload = inspection_request(version, job_id=job_id)
    except ProcessingError as error:
        # For example a file above the profile's input limit (`resource_limit_exceeded`).
        raise jobs.JobsError(error.code.value) from None
    existing = (
        inspection_jobs(version)
        .filter(idempotency_key=payload["idempotency_key"])
        .filter(
            Q(status__in=[JobStatus.PENDING, JobStatus.RUNNING])
            | Q(status=JobStatus.COMPLETED, subject_outcome__in=APPLIED_OUTCOMES)
        )
        .first()
    )
    if existing is not None:
        logger.info("npc animation inspection existing job=%s version=%s", existing.pk, version.pk)
        return existing
    return jobs.submit(
        JOB_TYPE,
        payload,
        user=user,
        subject=version,
        job_id=job_id,
        idempotency_key=payload["idempotency_key"],
    )


# --- the kind's handler (jobs_consume_results / inline) ---------------------------------------


def identity_mismatch(job, version) -> str | None:
    return asset_processing.identity_mismatch(job, version, kind=JOB_TYPE, profile_ref=PROFILE)


def apply(job) -> None:
    """Apply a finished `asset.analyze_animation` job (see the module docstring). Records what it
    did in `job.subject_outcome`; raises only for a database error (the whole result application
    rolls back and SQS retries the message)."""
    from apps.assets.models import AssetVersion
    from apps.catalog.models import ContentAsset

    code = _apply(job, ContentAsset, AssetVersion)
    job.subject_outcome = code[:64]
    job.save(update_fields=["subject_outcome"])
    level = logging.WARNING if code in MISMATCH_OUTCOMES or code == "stale_result" else logging.INFO
    logger.log(level, "npc animation inspection outcome job=%s code=%s", job.pk, code)


def _apply(job, ContentAsset, AssetVersion) -> str:  # noqa: N803
    from apps.jobs.models import JobStatus

    if job.status != JobStatus.COMPLETED:
        return "processing_failed"
    reason = asset_processing.result_mismatch(job)
    if reason is not None:
        return reason
    found = (
        AssetVersion.objects.filter(pk=job.subject_id).values_list("pk", "asset_id").first()
        if str(job.subject_id).isdigit()
        else None
    )
    if found is None:
        return "version_missing"
    version_pk, asset_pk = found
    ContentAsset.objects.select_for_update().filter(pk=asset_pk).first()
    version = (
        AssetVersion.objects.select_for_update()
        .select_related("asset")
        .filter(pk=version_pk, asset_id=asset_pk)
        .first()
    )
    if version is None:
        return "version_missing"
    reason = identity_mismatch(job, version)
    if reason is not None:
        return reason
    if version.was_published or version.status not in _NEVER_PUBLISHED:
        return "result_recorded"  # published metadata is immutable: the result stays on the job
    stored = (version.metadata or {}).get(METADATA_KEY)
    if isinstance(stored, dict) and stored.get("job_id") == str(job.pk):
        return "duplicate_result"
    newer = (
        inspection_jobs(version)
        .filter(created_at__gt=job.created_at, subject_outcome="inspection_stored")
        .exclude(pk=job.pk)
        .exists()
    )
    if newer:
        return "stale_result"  # a later inspection of this version is already stored
    version.metadata = {**(version.metadata or {}), METADATA_KEY: inspection_summary(job)}
    version.save(update_fields=["metadata"])
    return "inspection_stored"


def inline_ports(job):
    from apps.assets.jobs import InlinePorts

    return InlinePorts()


# --- presentation (Django Admin) ---------------------------------------------------------------

_SUMMARY_METADATA_KEYS = (
    "metadata_version",
    "clip_count",
    "generic_clip_count",
    "counts",
    "clips",
    "skins",
    "lists_truncated",
)


def inspection_summary(job) -> dict | None:
    """The normalized summary of a completed inspection, or None without a successful result.
    One shape for the version metadata copy and for Django Admin (always rendered escaped)."""
    result = job.result if isinstance(job.result, dict) else None
    if not result or result.get("status") != "succeeded" or job.status != "completed":
        return None
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    processor = result.get("processor") or {}
    profile = result.get("profile") or {}
    findings = [f for f in result.get("findings") or [] if isinstance(f, dict)]
    summary = {
        "job_id": str(job.pk),
        "attempt_id": result.get("attempt_id"),
        "processor_id": processor.get("processor_id"),
        "processor_version": processor.get("processor_version"),
        "profile_id": profile.get("profile_id"),
        "profile_version": profile.get("version"),
        "verdict": result.get("verdict"),
        "completed_at": result.get("completed_at"),
        "error_count": sum(1 for f in findings if f.get("severity") == "error"),
        "warning_count": sum(1 for f in findings if f.get("severity") == "warning"),
        "findings": [
            {
                "code": str(f.get("code", ""))[:64],
                "severity": "error" if f.get("severity") == "error" else "warning",
                "message": str(f.get("message", ""))[:500],
                "path": str(f.get("path", ""))[:200],
            }
            for f in findings[:MAX_SUMMARY_FINDINGS]
        ],
        "run_warnings": [
            str(w.get("code", ""))[:64] for w in result.get("warnings") or [] if isinstance(w, dict)
        ][:50],
    }
    for key in _SUMMARY_METADATA_KEYS:
        summary[key] = metadata.get(key)
    return summary


def latest_inspection(version):
    """(newest job or None, summary or None) for `version`. The summary is the newest accepted
    result's, else the copy kept on a never-published version (jobs are pruned after
    `LAI_JOBS_RETENTION_DAYS`); a failed or refused job never supplies one."""
    if version is None:
        return None, None
    jobs = inspection_jobs(version)
    newest = jobs.first()
    accepted = jobs.filter(status="completed", subject_outcome__in=APPLIED_OUTCOMES).first()
    summary = inspection_summary(accepted) if accepted is not None else None
    if summary is None:
        stored = (version.metadata or {}).get(METADATA_KEY)
        summary = stored if isinstance(stored, dict) else None
    return newest, summary


def suggest_mapping(summary: dict | None, animation_map: dict | None) -> list[dict]:
    """ADVISORY ONLY: one row per runtime state with a suggested clip, never applied.

    A clip is suggested for a state only when its exact name equals the state (`exact`) or
    equals it ignoring case (`case_insensitive`, for example `Idle` for `idle`), and only when
    exactly one clip matches. No other aliases are defined. A clip whose name was altered for
    display (`name_exact: false`) or that is an exporter's default take name (`generic_name`, for
    example `Armature|mixamo.com|Layer0`) is never suggested: nothing here infers a movement."""
    clips = [c for c in (summary or {}).get("clips") or [] if isinstance(c, dict)]
    names = [
        c["name"]
        for c in clips
        if isinstance(c.get("name"), str) and c.get("name_exact") and not c.get("generic_name")
    ]
    all_names = {c.get("name") for c in clips if isinstance(c.get("name"), str)}
    current_map = animation_map if isinstance(animation_map, dict) else {}
    rows = []
    for state in ANIMATION_STATES:
        exact = [n for n in names if n == state]
        folded = [n for n in names if n != state and n.casefold() == state.casefold()]
        if len(exact) == 1:
            suggestion, match = exact[0], "exact"
        elif not exact and len(folded) == 1:
            suggestion, match = folded[0], "case_insensitive"
        elif exact or folded:
            suggestion, match = None, "ambiguous"
        else:
            suggestion, match = None, "none"
        current = current_map.get(state)
        rows.append(
            {
                "state": state,
                "current": current if isinstance(current, str) else None,
                "current_in_model": (current in all_names) if isinstance(current, str) else None,
                "suggestion": suggestion,
                "match": match,
            }
        )
    return rows
