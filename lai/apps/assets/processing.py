"""Asynchronous model validation on the canonical jobs path (`asset.validate_model`; ADR-064,
LAI-LAMBDA-006 and 007, docs/processing/CANONICAL_PATH.md).

- `submit_model_validation(version, user=)` builds an ADR-061 `ProcessingJobRequest` for the
  version's stored object and submits it with `apps.jobs.services.submit` (the media queue, the
  transactional outbox), under the asset row lock. The latest job for the same logical work (same
  version, file and processor: the idempotency key) is returned while it is unfinished or holds an
  accepted pass (unless the version is still a draft, so that pass was lost); otherwise (failed,
  cancelled, refused, not applied) a new job is submitted, at most
  `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` per logical work (docs/processing/
  ASYNC_MODEL_VALIDATION.md, "Retry and resubmission semantics").
- `apply(job)` is the kind's handler: `jobs_consume_results` (or the inline backend) calls it once,
  under the job row lock, inside the transaction that records the result. It verifies the
  contract result against the request, then the request against the version, and only then moves
  a DRAFT version to VALIDATED or REJECTED. It never publishes, never changes a version that is
  not a draft (published versions are immutable, a rejected one stays rejected), and never applies
  a result whose job was superseded by a newer validation job of the version.
- `validation_jobs`, `identity_mismatch`, `model_validation_summary` and `processing_findings` are
  shared by the hook, the publication gate and Django Admin.

Lock order: job row (held by the caller) -> ContentAsset row -> AssetVersion row, the same order
`services.publish_version` uses after its asset lock. Only the inline backend (development and
tests) locks a job after an asset: an upload holding its asset lock runs its own new, uncommitted
job in the same transaction, a row no other transaction can see or wait for, so no cycle forms.
Logs carry ids and codes only.
"""

import dataclasses
import logging
import uuid
from datetime import UTC, datetime, timedelta

from django.conf import settings
from django.utils.timezone import now

logger = logging.getLogger("lai.assets")

MODEL_VALIDATION_JOB_TYPE = "asset.validate_model"
MODEL_VALIDATION_PROFILE = ("glb-default", 1)
#: The contract subject type in the request (the job row uses the model reference).
SUBJECT_TYPE = "asset_version"
#: `ProcessingJob.subject_type` for an asset version (the same as `asset.inspect`).
JOB_SUBJECT = "assets.assetversion"
#: Formats asynchronous validation applies to (the GLB validator reads the GLB container only).
ASYNC_FORMATS = frozenset({"glb"})
#: Handler outcomes of a result that was accepted for its version.
APPLIED_OUTCOMES = frozenset({"version_validated", "version_rejected", "result_recorded"})
#: Outcome of a result whose job is no longer the version's newest validation job.
SUPERSEDED = "result_superseded"
#: Applied outcomes that return the completed job to a resubmission when its verdict is `pass`
#: (a `fail` verdict, a refused or a superseded result may be resubmitted by staff).
_REUSED_PASS_OUTCOMES = frozenset({"version_validated", "result_recorded"})
#: The engine's execution budget for one validation, seconds. It must end well inside the media
#: worker's Lambda timeout (`lai-dev-jobs-media`, 120 s in infra/lib/devPlatformStack.ts), so the
#: engine reports a classified timeout instead of Lambda killing the run with nothing stored. The
#: profile allows 300 s; the request carries the tighter budget.
MAX_EXECUTION_SECONDS = 90
#: A request expires (the worker refuses it) after this long.
REQUEST_TTL = timedelta(hours=72)


def async_validation_enabled() -> bool:
    """`LAI_ASSET_ASYNC_VALIDATION == "on"` (default off in every environment)."""
    return getattr(settings, "LAI_ASSET_ASYNC_VALIDATION", "off") == "on"


def async_validation_applies(version_or_format) -> bool:
    """True when the flag is on and the version (or a format name) is a GLB model."""
    fmt = version_or_format if isinstance(version_or_format, str) else version_or_format.format
    return async_validation_enabled() and fmt in ASYNC_FORMATS


def namespace() -> str:
    """The contract namespace: the deployment environment (`dev`, `prod`) or `local`."""
    return (getattr(settings, "LAI_ENVIRONMENT", "") or "local").strip() or "local"


def _registry():
    from lai_processing.core.registry import default_registry

    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = default_registry()
    return _REGISTRY


_REGISTRY = None


def current_processor() -> tuple[str, str]:
    """The (processor_id, version) this build runs for the model validation profile."""
    from lai_processing.contracts.common import ProfileRef

    processor, _profile = _registry().resolve(
        MODEL_VALIDATION_JOB_TYPE, ProfileRef(*MODEL_VALIDATION_PROFILE)
    )
    return processor.processor_id, processor.version


# --- submission --------------------------------------------------------------------------------


def model_validation_request(version, *, job_id: str) -> dict:
    """The ADR-061 request for `version` as a dict (no database writes).

    `limits.max_input_bytes` is min(profile, `max_glb_bytes()`): a file above it is refused here
    with `ProcessingError(resource_limit_exceeded)`, before any job exists."""
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key

    from .validation import max_glb_bytes

    space = namespace()
    subject = SubjectRef(subject_type=SUBJECT_TYPE, subject_id=str(version.version_id))
    profile_ref = ProfileRef(*MODEL_VALIDATION_PROFILE)
    processor, profile = _registry().resolve(MODEL_VALIDATION_JOB_TYPE, profile_ref)
    options = profile.resolve_options({})
    source = InputObject(
        ref=ObjectRef("assets", version.storage_key, None, space),
        content_type=version.content_type,
        size_bytes=version.size_bytes,
        sha256=version.sha256,
    )
    key = idempotency_key(
        namespace=space,
        job_type=MODEL_VALIDATION_JOB_TYPE,
        subject=subject,
        profile=profile_ref,
        input=source,
        options=options,
        processor_version=processor.version,
    )
    stamp = datetime.now(UTC).replace(microsecond=0)
    request = ProcessingJobRequest(
        job_id=job_id,
        job_type=MODEL_VALIDATION_JOB_TYPE,
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
            max_input_bytes=min(profile.limits.max_input_bytes, max_glb_bytes()),
            max_execution_seconds=min(profile.limits.max_execution_seconds, MAX_EXECUTION_SECONDS),
        ),
    )
    return request.to_dict()


def max_attempts() -> int:
    """`LAI_ASSET_VALIDATION_MAX_ATTEMPTS`: jobs allowed per logical validation (default 5)."""
    return int(getattr(settings, "LAI_ASSET_VALIDATION_MAX_ATTEMPTS", 5))


def reusable(job, *, version_status: str | None = None) -> bool:
    """True when a resubmission of the same logical work returns `job` instead of a new job: it
    is still pending or running, or it completed with an accepted, passing result. A failed job
    (any code, `timeout`, `cancelled` and `marked_failed` included), a `fail` verdict, a refused
    result (a mismatch, `result_invalid`, `version_missing`) and a superseded one are not.

    `version_status` is the version's status now. A passing result whose version is still a
    `DRAFT` is not reused: the pass moved the draft to `VALIDATED` when it was applied, so a draft
    means that change was lost (for example overwritten by a stale save). A new job lets staff
    recover by validating again; the attempt cap still bounds it."""
    from apps.jobs.models import JobStatus

    if job.status in (JobStatus.PENDING, JobStatus.RUNNING):
        return True
    return (
        job.status == JobStatus.COMPLETED
        and job.subject_outcome in _REUSED_PASS_OUTCOMES
        and (job.result or {}).get("verdict") == "pass"
        and version_status != "DRAFT"
    )


def submit_model_validation(version, *, user):
    """Submit (or return) the model validation job for `version`. Never changes the version.

    Under the asset row lock (so concurrent submissions of one version serialize), the newest
    job with the same idempotency key (same version, stored file and processor version) is
    returned when `reusable` (given the version's status, re-read under the lock); otherwise a new
    job with a new attempt id is submitted, unless the logical work already has `max_attempts()`
    jobs (`JobsError("attempts_exhausted")`).

    Raises `apps.jobs.services.JobsError` (`JobsDisabled` when the jobs backend is disabled)."""
    from django.db import transaction

    from apps.catalog.models import ContentAsset
    from apps.jobs import services as jobs
    from lai_processing.core.errors import ProcessingError

    job_id = str(uuid.uuid4())
    try:
        payload = model_validation_request(version, job_id=job_id)
    except ProcessingError as error:
        # The request itself is refused (for example a file above the profile's input limit):
        # a safe code, the same path as any other refused submission.
        raise jobs.JobsError(error.code.value) from None
    with transaction.atomic():
        # Lock order: asset row first, as `upload_version` and `publish_version` do. A second
        # submission waits here and then sees the first one's committed job.
        ContentAsset.objects.select_for_update().filter(pk=version.asset_id).first()
        same_work = validation_jobs(version).filter(idempotency_key=payload["idempotency_key"])
        latest = same_work.first()
        current = type(version).objects.filter(pk=version.pk).values_list("status", flat=True)
        status = current.first()
        if latest is not None and reusable(latest, version_status=status):
            logger.info("asset validation existing job=%s version=%s", latest.pk, version.pk)
            return latest
        if same_work.count() >= max_attempts():
            logger.warning(
                "asset validation refused version=%s code=attempts_exhausted", version.pk
            )
            raise jobs.JobsError("attempts_exhausted")
        return jobs.submit(
            MODEL_VALIDATION_JOB_TYPE,
            payload,
            user=user,
            subject=version,
            job_id=job_id,
            idempotency_key=payload["idempotency_key"],
        )


def validation_jobs(version):
    """This version's `asset.validate_model` jobs, newest first (never locked)."""
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(
        kind=MODEL_VALIDATION_JOB_TYPE, subject_type=JOB_SUBJECT, subject_id=str(version.pk)
    ).order_by("-created_at")


# --- verification ------------------------------------------------------------------------------


def result_mismatch(job) -> str | None:
    """None when `job.result` is a valid ADR-061 result of exactly the request in `job.payload`
    (job, attempt, key, type, namespace, profile, verified input), else a reason code."""
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.contracts.results import ProcessingJobResult, ResultStatus
    from lai_processing.core.errors import ProcessingError

    try:
        request = ProcessingJobRequest.from_dict(job.payload)
        result = ProcessingJobResult.from_dict(job.result)
    except (ProcessingError, KeyError, TypeError, ValueError):
        return "result_invalid"
    # A completed job carries a successful contract result with a verdict; anything else inside
    # a "succeeded" envelope is not a validation of the file.
    if result.status is not ResultStatus.SUCCEEDED or result.verdict is None:
        return "result_invalid"
    if request.job_id != str(job.pk) or result.job_id != str(job.pk):
        return "job_mismatch"
    if (result.attempt_id, result.attempt_number) != (request.attempt_id, request.attempt_number):
        return "attempt_mismatch"
    if result.idempotency_key != request.idempotency_key or (
        job.idempotency_key and result.idempotency_key != job.idempotency_key
    ):
        return "key_mismatch"
    if result.job_type != request.job_type or result.namespace != request.namespace:
        return "identity_mismatch"
    if (result.profile.profile_id, result.profile.version) != (
        request.profile.profile_id,
        request.profile.version,
    ):
        return "profile_mismatch"
    observed, expected = result.input, request.input
    if (
        observed is None
        or not observed.verified
        or observed.ref.store != expected.ref.store
        or observed.ref.key != expected.ref.key
        or observed.sha256 != expected.sha256
        or observed.size_bytes != expected.size_bytes
    ):
        return "input_mismatch"
    return None


def identity_mismatch(
    job,
    version,
    *,
    require_current_processor: bool = False,
    kind: str = MODEL_VALIDATION_JOB_TYPE,
    profile_ref: tuple[str, int] = MODEL_VALIDATION_PROFILE,
) -> str | None:
    """None when `job` is a model validation of exactly `version`'s stored bytes, else a safe
    reason code: kind, subject, namespace, asset context (asset id, version uuid and number), input
    (store `assets`, key, no object version, SHA-256, size), profile and, with
    `require_current_processor` (the publication gate), the processor version of the result.

    `kind` and `profile_ref` let another asset-version contract kind (`asset.analyze_animation`,
    apps.npcs.animation_inspection) use the same checks; the defaults are model validation's."""
    payload = job.payload if isinstance(job.payload, dict) else {}
    if job.kind != kind:
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
    profile = payload.get("profile") or {}
    if (profile.get("profile_id"), profile.get("version")) != tuple(profile_ref):
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
    """Apply a finished `asset.validate_model` job to its version (see the module docstring).

    Records what it did in `job.subject_outcome`. Raises only for a database error, which rolls
    the whole result application back (the message is retried by SQS)."""
    from apps.catalog.models import ContentAsset

    from .models import AssetVersion, VersionStatus

    code = _apply(job, ContentAsset, AssetVersion, VersionStatus)
    job.subject_outcome = code[:64]
    job.save(update_fields=["subject_outcome"])
    level = (
        logging.WARNING if code.endswith("_mismatch") or code == "result_invalid" else logging.INFO
    )
    logger.log(level, "asset validation outcome job=%s code=%s", job.pk, code)


def _apply(job, ContentAsset, AssetVersion, VersionStatus) -> str:  # noqa: N803
    from apps.jobs.models import JobStatus

    if job.status != JobStatus.COMPLETED:
        return "processing_failed"
    reason = result_mismatch(job)
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
    if validation_jobs(version).filter(created_at__gt=job.created_at).exists():
        # A newer validation job of this version exists (a staff resubmission, or a submission
        # by a newer processor version): only the newest job's result may change the version.
        return SUPERSEDED
    if version.status != VersionStatus.DRAFT:
        return "result_recorded"  # a manual revalidation: the result stays on the job
    passed = (job.result or {}).get("verdict") == "pass"
    version.status = VersionStatus.VALIDATED if passed else VersionStatus.REJECTED
    if passed:
        version.validated_at = now()
    version.validation_report = list(version.validation_report or []) + processing_findings(job)
    version.metadata = {
        **(version.metadata or {}),
        "model_validation": model_validation_summary(job),
    }
    version.save(update_fields=["status", "validated_at", "validation_report", "metadata"])
    return "version_validated" if passed else "version_rejected"


def inline_ports(job):
    from .jobs import InlinePorts

    return InlinePorts()


# --- presentation (hook, gate, Django Admin) ---------------------------------------------------

_SUMMARY_METADATA_KEYS = (
    "metadata_version",
    "generator",
    "counts",
    "vertex_count",
    "triangle_count",
    "material_names",
    "images",
    "skins",
    "animations",
    "bounds",
    "extensions_used",
    "extensions_required",
    "unsupported_extensions",
    "lists_truncated",
)
#: Most processing findings copied onto a version's validation report.
MAX_PROCESSING_FINDINGS = 200
#: The `source` of a finding produced by the background validator ("upload" findings, written
#: by the synchronous checks, carry no source key, as before Wave 3).
PROCESSING_SOURCE = "processing"


def model_validation_summary(job) -> dict | None:
    """The normalized summary of a job's applied model validation result, or None when the job
    has no successful result. One shape for the completion hook (stored on the draft version as
    `metadata["model_validation"]`) and for Django Admin (rendered, always escaped).

    Keys: job and attempt identity, processor and profile, `verdict`, `completed_at`,
    `error_count`, `warning_count`, `run_warnings` (codes), and the validator's metadata keys
    (`counts`, `vertex_count`, `triangle_count`, `material_names`, `images`, `skins`,
    `animations` with exact names and `duration_seconds`, `bounds`, extensions, `generator`).
    Findings are not in the summary: `processing_findings(job)` returns them."""
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
        "attempt_number": result.get("attempt_number"),
        "processor_id": processor.get("processor_id"),
        "processor_version": processor.get("processor_version"),
        "profile_id": profile.get("profile_id"),
        "profile_version": profile.get("version"),
        "verdict": result.get("verdict"),
        "completed_at": result.get("completed_at"),
        "error_count": sum(1 for f in findings if f.get("severity") == "error"),
        "warning_count": sum(1 for f in findings if f.get("severity") == "warning"),
        "run_warnings": [
            str(w.get("code", ""))[:64] for w in result.get("warnings") or [] if isinstance(w, dict)
        ][:50],
    }
    for key in _SUMMARY_METADATA_KEYS:
        summary[key] = metadata.get(key)
    return summary


def processing_findings(job) -> list[dict]:
    """The job's findings in the Asset Library report shape plus `source: "processing"`
    (at most `MAX_PROCESSING_FINDINGS`)."""
    result = job.result if isinstance(job.result, dict) else {}
    findings = []
    for finding in (result.get("findings") or [])[:MAX_PROCESSING_FINDINGS]:
        if not isinstance(finding, dict):
            continue
        findings.append(
            {
                "code": str(finding.get("code", ""))[:64],
                "severity": "error" if finding.get("severity") == "error" else "warning",
                "message": str(finding.get("message", ""))[:500],
                "path": str(finding.get("path", ""))[:200],
                "source": PROCESSING_SOURCE,
            }
        )
    return findings
