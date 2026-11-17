"""The asset library's completion hook for `asset.validate_model` (WAVE3_INTERFACES section 3).

`apply_model_validation(job, attempt, result)` maps an applied model validation result onto the
`AssetVersion` it validated. `apps.jobs.processing` calls it after every APPLY, inside the
completion transaction, under the job row lock and in a savepoint; it never runs for a
duplicate, stale, retried or rejected completion, so a result is mapped at most once.

Rules (the section 3 table):

- a result that is not `succeeded` changes nothing (`processing_failed`);
- a version that no longer exists changes nothing (`version_missing`);
- a job whose recorded identity is not exactly this version's stored bytes changes nothing and is
  logged as `processing.subject_mismatch` (`identity_mismatch` reason code);
- a version that is no longer `DRAFT` (validated, rejected, published, retired) is never changed
  (`result_recorded`): published versions are immutable and a manual revalidation is staff work;
- a `DRAFT` version becomes `VALIDATED` on a `pass` verdict and `REJECTED` on any other verdict,
  with the processing findings appended to its report and the normalized summary stored as
  `metadata["model_validation"]`. `clips` and `dimensions` keep their synchronous values.

It never publishes and never changes the `ContentAsset`. Lock order (section 4): the caller holds
the job row; this hook locks the `ContentAsset` row, then the `AssetVersion` row, the same order
as `services.publish_version`. A `DatabaseError` propagates so the completion is deferred and
redelivered. Logs carry ids and codes only.
"""

from __future__ import annotations

import logging
import uuid

from django.utils.timezone import now

from apps.catalog.models import ContentAsset
from apps.jobs.processing import HookResult
from lai_processing.contracts.results import ResultStatus, Verdict

from .models import AssetVersion, VersionStatus
from .processing import identity_mismatch, model_validation_summary, processing_findings

logger = logging.getLogger("lai.assets")


def _version_pk(subject_id: str) -> tuple[int, int] | None:
    """(version pk, asset pk) of the job's subject, read without a lock, or None."""
    try:
        version_uuid = uuid.UUID(str(subject_id))
    except ValueError:
        return None
    return (
        AssetVersion.objects.filter(version_id=version_uuid).values_list("pk", "asset_id").first()
    )


def apply_model_validation(job, attempt, result) -> HookResult:
    if result.status is not ResultStatus.SUCCEEDED:
        return HookResult("processing_failed")

    found = _version_pk(job.subject_id)
    if found is None:
        return HookResult("version_missing")
    version_pk, asset_pk = found
    # Lock order: job (held by the caller) -> ContentAsset -> AssetVersion.
    ContentAsset.objects.select_for_update().filter(pk=asset_pk).first()
    version = (
        AssetVersion.objects.select_for_update()
        .select_related("asset")
        .filter(pk=version_pk, asset_id=asset_pk)
        .first()
    )
    if version is None:
        return HookResult("version_missing")

    reason = identity_mismatch(job, version)
    if reason is not None:
        logger.warning("processing.subject_mismatch job=%s reason=%s", job.pk, reason)
        return HookResult(reason)

    if version.status != VersionStatus.DRAFT:
        return HookResult("result_recorded", review_ready=True)

    passed = result.verdict is Verdict.PASS
    version.status = VersionStatus.VALIDATED if passed else VersionStatus.REJECTED
    if passed:
        version.validated_at = now()
    version.validation_report = list(version.validation_report or []) + processing_findings(job)
    version.metadata = {
        **(version.metadata or {}),
        "model_validation": model_validation_summary(job),
    }
    version.save(update_fields=["status", "validated_at", "validation_report", "metadata"])
    code = "version_validated" if passed else "version_rejected"
    logger.info("asset version %s: job=%s version=%s", code, job.pk, version.version_id)
    return HookResult(code, review_ready=True)
