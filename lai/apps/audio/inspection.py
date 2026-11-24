"""Audio inspection in the background (`asset.process_audio`, LAI-LAMBDA-008 phase 1; ADR-064).

Sound Manager audio files are Asset Library versions (`apps.assets.AssetVersion` with format
`mp3`, `wav` or `ogg`); a sound cue points at the asset and, through `version_for`, at one
version. This module inspects exactly one stored version:

- `submit_audio_inspection(version, user=)` builds an ADR-061 `ProcessingJobRequest` for the
  version's stored object and submits it with `apps.jobs.services.submit` (the media queue, the
  transactional outbox). The `ik1:` idempotency key covers the namespace, job type, subject
  (the version uuid), profile, input (store, key, SHA-256, size, declared content type), options
  and processor version, so the same logical work returns the existing waiting, running or
  applied job; a failed or refused one may be submitted again. Staff trigger it from Django
  Admin; nothing submits it on upload, and `LAI_ASSET_ASYNC_VALIDATION` does not apply to audio.
- `apply(job)` is the kind's handler (`jobs_consume_results` or the inline backend, once, under
  the job row lock, in the transaction that records the result). It verifies the contract result
  against the request (`apps.assets.processing.result_mismatch`), then the request against the
  version as it is now (`identity_mismatch`), and records a safe outcome code. **It never writes
  the version**: audio versions are created `VALIDATED` by the synchronous upload checks and
  become immutable once published, so phase 1 keeps every inspection result on the job only
  (`subject_outcome = "inspection_recorded"`), whatever the version's status. Nothing is
  published, and no published bytes or metadata change.

Logs carry ids and codes only. Never used for child speech or recordings.
"""

import dataclasses
import logging
import uuid
from datetime import UTC, datetime

logger = logging.getLogger("lai.audio")

JOB_TYPE = "asset.process_audio"
PROFILE = ("audio-inspect", 1)
#: Asset Library formats the inspector applies to (lai/apps/assets/formats.py, family audio).
AUDIO_FORMATS = frozenset({"mp3", "wav", "ogg"})
#: The contract subject type and the job row's subject (the same as the model validator).
SUBJECT_TYPE = "asset_version"
JOB_SUBJECT = "assets.assetversion"
#: The only outcome of an accepted result (the version is never changed).
RECORDED = "inspection_recorded"
APPLIED_OUTCOMES = frozenset({RECORDED})


def _registry():
    from apps.assets.processing import _registry as shared

    return shared()


def current_processor() -> tuple[str, str]:
    """The (processor_id, version) this build runs for the audio inspection profile."""
    from lai_processing.contracts.common import ProfileRef

    processor, _profile = _registry().resolve(JOB_TYPE, ProfileRef(*PROFILE))
    return processor.processor_id, processor.version


# --- submission --------------------------------------------------------------------------------


def inspection_request(version, *, job_id: str) -> dict:
    """The ADR-061 request for `version` as a dict (no database writes). Raises
    `ProcessingError` when the contract refuses it (for example a file above 20 MiB)."""
    from apps.assets.processing import MAX_EXECUTION_SECONDS, REQUEST_TTL, namespace
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key

    space = namespace()
    subject = SubjectRef(subject_type=SUBJECT_TYPE, subject_id=str(version.version_id))
    profile_ref = ProfileRef(*PROFILE)
    processor, profile = _registry().resolve(JOB_TYPE, profile_ref)
    options = profile.resolve_options({})
    source = InputObject(
        ref=ObjectRef("assets", version.storage_key, None, space),
        content_type=version.content_type,
        size_bytes=version.size_bytes,
        sha256=version.sha256,
    )
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
        expires_at=stamp + REQUEST_TTL,
        options=options,
        limits=dataclasses.replace(
            profile.limits,
            max_execution_seconds=min(profile.limits.max_execution_seconds, MAX_EXECUTION_SECONDS),
        ),
    )
    return request.to_dict()


def submit_audio_inspection(version, *, user):
    """Submit (or return) the audio inspection job for `version`. Never changes the version.

    Raises `apps.jobs.services.JobsError`: `not_audio` for a non-audio version, a contract code
    (for example `resource_limit_exceeded`) when the request is refused, `JobsDisabled` when the
    jobs backend is off."""
    from django.db.models import Q

    from apps.jobs import services as jobs
    from apps.jobs.models import JobStatus
    from lai_processing.core.errors import ProcessingError

    if version.format not in AUDIO_FORMATS:
        raise jobs.JobsError("not_audio")
    job_id = str(uuid.uuid4())
    try:
        payload = inspection_request(version, job_id=job_id)
    except ProcessingError as error:
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
        logger.info("audio inspection existing job=%s version=%s", existing.pk, version.pk)
        return existing
    return jobs.submit(
        JOB_TYPE,
        payload,
        user=user,
        # The model reference, not the instance: a Sound Manager `AudioFile` proxy would
        # otherwise label the job "audio.audiofile".
        subject=(JOB_SUBJECT, str(version.pk)),
        job_id=job_id,
        idempotency_key=payload["idempotency_key"],
    )


def inspection_jobs(version):
    """This version's `asset.process_audio` jobs, newest first (never locked)."""
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(
        kind=JOB_TYPE, subject_type=JOB_SUBJECT, subject_id=str(version.pk)
    ).order_by("-created_at")


def latest_job(version):
    """The version's newest inspection job, read once per object (never locked)."""
    if not hasattr(version, "_lai_audio_inspection"):
        version._lai_audio_inspection = inspection_jobs(version).first()
    return version._lai_audio_inspection


# --- verification ------------------------------------------------------------------------------


def identity_mismatch(job, version, *, require_current_processor: bool = False) -> str | None:
    """None when `job` is an audio inspection of exactly `version`'s stored bytes, else a safe
    reason code: kind, subject, namespace, asset context, input (store `assets`, key, no object
    version, SHA-256, size, declared content type), profile and, optionally, the processor
    version of the result (`processor_outdated`)."""
    from apps.assets.processing import namespace

    payload = job.payload if isinstance(job.payload, dict) else {}
    if job.kind != JOB_TYPE:
        return "kind_mismatch"
    if job.subject_type != JOB_SUBJECT or job.subject_id != str(version.pk):
        return "subject_mismatch"
    subject = payload.get("subject") or {}
    if (subject.get("subject_type"), subject.get("subject_id")) != (
        SUBJECT_TYPE,
        str(version.version_id),
    ):
        return "subject_mismatch"
    if payload.get("namespace") != namespace():
        return "namespace_mismatch"
    context = payload.get("asset") or {}
    if (
        context.get("asset_id") != version.asset.asset_id
        or context.get("asset_version_id") != str(version.version_id)
        or context.get("asset_version_number") != version.number
    ):
        return "asset_mismatch"
    source = payload.get("input") or {}
    ref = source.get("ref") or {}
    if (
        ref.get("store") != "assets"
        or ref.get("key") != version.storage_key
        or ref.get("version_id") not in (None, "")
    ):
        return "storage_mismatch"
    if source.get("sha256") != version.sha256:
        return "checksum_mismatch"
    if source.get("size_bytes") != version.size_bytes:
        return "size_mismatch"
    if source.get("content_type") != version.content_type:
        return "content_type_mismatch"
    profile = payload.get("profile") or {}
    if (profile.get("profile_id"), profile.get("version")) != PROFILE:
        return "profile_mismatch"
    if require_current_processor:
        processor = (job.result or {}).get("processor") or {}
        if (processor.get("processor_id"), processor.get("processor_version")) != (
            current_processor()
        ):
            return "processor_outdated"
    return None


# --- the kind's handler (jobs_consume_results / inline) ---------------------------------------


def apply(job) -> None:
    """Record what a finished `asset.process_audio` job means for its version (see the module
    docstring). Sets `job.subject_outcome`; never writes the version. Raises only for a database
    error, which rolls the whole result application back (SQS retries the message)."""
    code = _apply(job)
    job.subject_outcome = code[:64]
    job.save(update_fields=["subject_outcome"])
    level = logging.WARNING if is_mismatch(code) else logging.INFO
    logger.log(level, "audio inspection outcome job=%s code=%s", job.pk, code)


def _apply(job) -> str:
    from apps.assets.models import AssetVersion
    from apps.assets.processing import result_mismatch
    from apps.jobs.models import JobStatus

    if job.status != JobStatus.COMPLETED:
        return "processing_failed"
    reason = result_mismatch(job)
    if reason is not None:
        return reason
    if (job.result or {}).get("job_type") != JOB_TYPE:
        return "identity_mismatch"
    if not str(job.subject_id).isdigit():
        return "version_missing"
    version = AssetVersion.objects.select_related("asset").filter(pk=job.subject_id).first()
    if version is None:
        return "version_missing"
    reason = identity_mismatch(job, version)
    if reason is not None:
        return reason  # stale: the version's stored file is no longer the one inspected
    return RECORDED


def inline_ports(job):
    from apps.assets.jobs import InlinePorts

    return InlinePorts()


def is_mismatch(code: str) -> bool:
    return code.endswith("_mismatch") or code == "result_invalid"


# --- presentation (Django Admin) ---------------------------------------------------------------

_SUMMARY_KEYS = (
    "detected_format",
    "container",
    "codec",
    "file_size_bytes",
    "declared_content_type",
    "declared_format",
    "declared_type_matches",
    "duration_seconds",
    "duration_kind",
    "sample_rate_hz",
    "channels",
    "sample_width_bits",
    "bitrate_bps",
    "bitrate_mode",
)
MAX_FINDINGS = 100


def inspection_summary(job) -> dict | None:
    """The normalized summary of a completed, accepted inspection job, or None. Values come from
    the job's stored result; Django Admin renders every one escaped."""
    if job is None or job.status != "completed" or job.subject_outcome != RECORDED:
        return None
    result = job.result if isinstance(job.result, dict) else None
    if not result or result.get("status") != "succeeded":
        return None
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    processor = result.get("processor") or {}
    profile = result.get("profile") or {}
    findings = []
    for finding in (result.get("findings") or [])[:MAX_FINDINGS]:
        if isinstance(finding, dict):
            findings.append(
                {
                    "code": str(finding.get("code", ""))[:64],
                    "severity": str(finding.get("severity", ""))[:16],
                    "message": str(finding.get("message", ""))[:500],
                    "path": str(finding.get("path", ""))[:200],
                }
            )
    limitations = [
        str(item.get("message", ""))[:500]
        for item in (metadata.get("limitations") or [])[:20]
        if isinstance(item, dict)
    ]
    summary = {
        "job_id": str(job.pk),
        "processor_id": processor.get("processor_id"),
        "processor_version": processor.get("processor_version"),
        "profile_id": profile.get("profile_id"),
        "profile_version": profile.get("version"),
        "verdict": result.get("verdict"),
        "completed_at": result.get("completed_at"),
        "findings": findings,
        "run_warnings": [
            str(w.get("code", ""))[:64] for w in result.get("warnings") or [] if isinstance(w, dict)
        ][:50],
        "limitations": limitations,
    }
    for key in _SUMMARY_KEYS:
        summary[key] = metadata.get(key)
    return summary
