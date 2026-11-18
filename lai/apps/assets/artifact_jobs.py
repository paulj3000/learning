"""Submit a derived-artifact workload for an asset version (ADR-066, DERIVED_ARTIFACTS.md section 6).

`submit_derived_job` is the one request builder the audio, image and optimize workloads share, so
none reinvents namespace, subject, input identity, idempotency key, expiry or the resubmission
cap. It never changes the source version and never publishes; the result is recorded by
`apps.assets.artifact_results`.
"""

import logging
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime

from django.conf import settings

logger = logging.getLogger("lai.assets")

#: Kinds that read an asset version and may write artifacts.
SUBJECT_TYPE = "asset_version"
JOB_SUBJECT = "assets.assetversion"


def derived_jobs(version, kind: str):
    """This version's jobs of `kind`, newest first (never locked)."""
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(
        kind=kind, subject_type=JOB_SUBJECT, subject_id=str(version.pk)
    ).order_by("-created_at")


def derived_request(
    version,
    *,
    kind: str,
    profile: tuple[str, int],
    processor_version: str,
    options: Mapping | None = None,
    limits=None,
    job_id: str,
) -> dict:
    """The ADR-061 request for `version` as a dict (no database writes). Raises `ProcessingError`
    when the contract refuses it (for example an input above the limits)."""
    from lai_processing.contracts.common import (
        AssetContext,
        InputObject,
        ObjectRef,
        ProfileRef,
        SubjectRef,
    )
    from lai_processing.contracts.jobs import ProcessingJobRequest
    from lai_processing.core.idempotency import idempotency_key
    from lai_processing.core.limits import DEFAULT_LIMITS

    from .processing import REQUEST_TTL, namespace

    space = namespace()
    subject = SubjectRef(subject_type=SUBJECT_TYPE, subject_id=str(version.version_id))
    profile_ref = ProfileRef(*profile)
    source = InputObject(
        ref=ObjectRef("assets", version.storage_key, None, space),
        content_type=version.content_type,
        size_bytes=version.size_bytes,
        sha256=version.sha256,
    )
    resolved = dict(options or {})
    key = idempotency_key(
        namespace=space,
        job_type=kind,
        subject=subject,
        profile=profile_ref,
        input=source,
        options=resolved,
        processor_version=processor_version,
    )
    base = limits if limits is not None else DEFAULT_LIMITS  # the workload sets its own budget
    stamp = datetime.now(UTC).replace(microsecond=0)
    request = ProcessingJobRequest(
        job_id=job_id,
        job_type=kind,
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
        options=resolved,
        limits=base,
    )
    return request.to_dict()


def submit_derived_job(
    version,
    *,
    kind: str,
    profile: tuple[str, int],
    processor_version: str,
    options: Mapping | None = None,
    limits=None,
    variant: str | None = None,
    user=None,
):
    """Submit (or return) the workload job for `version`. Never changes the version.

    Under the asset row lock (so concurrent submissions serialize) the newest job with the same
    idempotency key (same version, stored file, profile, options and processor version) is
    returned while it is pending or running, or when it completed and its artifacts were recorded;
    otherwise a new job with a new attempt id is submitted, at most
    `LAI_ASSET_VALIDATION_MAX_ATTEMPTS` per logical work.

    Raises `apps.jobs.services.WorkloadUnavailable` (control off or queue unset: nothing is
    recorded), `JobsDisabled`, or `JobsError` (`attempts_exhausted`, a contract code such as
    `resource_limit_exceeded`)."""
    from django.db import transaction

    from apps.catalog.models import ContentAsset
    from apps.jobs import services as jobs
    from apps.jobs import workloads
    from apps.jobs.models import JobStatus
    from lai_processing.core.errors import ProcessingError

    from . import artifact_results

    jobs.require_workload(kind, variant=variant)  # refuse before any work or lock
    job_id = str(uuid.uuid4())
    try:
        payload = derived_request(
            version,
            kind=kind,
            profile=profile,
            processor_version=processor_version,
            options=options,
            limits=limits,
            job_id=job_id,
        )
    except ProcessingError as error:
        raise jobs.JobsError(error.code.value) from None
    with transaction.atomic():
        ContentAsset.objects.select_for_update().filter(pk=version.asset_id).first()
        same_work = derived_jobs(version, kind).filter(idempotency_key=payload["idempotency_key"])
        latest = same_work.first()
        if latest is not None and (
            latest.status in (JobStatus.PENDING, JobStatus.RUNNING)
            or (
                latest.status == JobStatus.COMPLETED
                and latest.subject_outcome in artifact_results.APPLIED_OUTCOMES
            )
        ):
            logger.info("derived job existing job=%s kind=%s", latest.pk, kind)
            return latest
        if same_work.count() >= int(getattr(settings, "LAI_ASSET_VALIDATION_MAX_ATTEMPTS", 5)):
            logger.warning("derived job refused kind=%s code=attempts_exhausted", kind)
            raise jobs.JobsError("attempts_exhausted")
        return workloads.submit_workload(
            kind,
            payload,
            variant=variant,
            user=user,
            subject=(JOB_SUBJECT, str(version.pk)),
            job_id=job_id,
            idempotency_key=payload["idempotency_key"],
        )
