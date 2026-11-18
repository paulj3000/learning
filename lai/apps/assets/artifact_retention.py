"""Retention and cleanup of derived artifacts (ADR-066, DERIVED_ARTIFACTS.md section 12).

`run_retention(apply=False)` is the engine of `manage.py asset_artifact_retention` (a dry run
unless `apply`). It runs on Django's role, never a worker's: workers cannot delete.

1. **Expire.** `pending_review`, `rejected` and `superseded` rows whose `expires_at` has passed
   become `expired`, unless the row is held, or its job is still pending or running. `accepted`
   and `promoted` rows have no deadline and are never touched. Each row is locked (asset first,
   then the row, the asset services' order) and re-checked, so a concurrent review, promotion or
   hold wins.
2. **Delete objects.** `expired` rows lose their object through the Django-side storage, then
   become `deleted` and drop the link to their job (so job pruning is never blocked). A storage
   failure leaves the row `expired`; the next run retries. A 403 is a failure, never "gone".
3. **Orphans.** Objects under this environment's `processing/artifacts/` with no row, older than
   `LAI_ARTIFACT_ORPHAN_GRACE_HOURS`, whose job (if any) is not pending or running. The job row is
   locked and the database re-checked before each delete, so an attempt that is being recorded, or
   a row created meanwhile, keeps its object.

Idempotent: a second run finds nothing more. Logs and the report carry counts, ids and codes only.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils.timezone import now

from . import artifact_storage as store
from .artifact_storage import ArtifactStorageUnavailable
from .models import ArtifactState, DerivedArtifact

logger = logging.getLogger("lai.assets")

EXPIRABLE = (ArtifactState.PENDING_REVIEW, ArtifactState.REJECTED, ArtifactState.SUPERSEDED)
#: Rows handled per run before the next run continues (bounds one pass).
BATCH = 500


def run_retention(*, apply: bool = False, at=None, grace: timedelta | None = None) -> dict:
    """Run the three phases. Returns lists of artifact ids and orphan keys per outcome."""
    stamp = at or now()
    grace = (
        grace if grace is not None else timedelta(hours=settings.LAI_ARTIFACT_ORPHAN_GRACE_HOURS)
    )
    report = {
        "apply": apply,
        "expired": [],
        "protected_hold": [],
        "protected_active_job": [],
        "deleted": [],
        "delete_failed": [],
        "orphans": [],
        "orphans_deleted": [],
        "orphans_kept_recent": [],
        "orphans_kept_active": [],
        "storage_unavailable": False,
    }
    _expire(report, stamp, apply)
    _delete_objects(report, stamp, apply)
    try:
        _orphans(report, stamp, apply, grace)
    except ArtifactStorageUnavailable:
        report["storage_unavailable"] = True
        logger.warning("artifact retention: the store could not be listed")
    logger.info(
        "artifact retention apply=%s expired=%s deleted=%s orphans=%s orphans_deleted=%s",
        apply,
        len(report["expired"]),
        len(report["deleted"]),
        len(report["orphans"]),
        len(report["orphans_deleted"]),
    )
    return report


def _active_job(artifact) -> bool:
    job = artifact.job
    return job is not None and job.status in ("pending", "running")


def _expire(report, stamp, apply) -> None:
    due = (
        DerivedArtifact.objects.filter(state__in=EXPIRABLE, expires_at__lte=stamp)
        .select_related("job")
        .order_by("expires_at")[:BATCH]
    )
    for artifact in list(due):
        if artifact.retention_hold:
            report["protected_hold"].append(str(artifact.pk))
            continue
        if _active_job(artifact):
            report["protected_active_job"].append(str(artifact.pk))
            continue
        if not apply:
            report["expired"].append(str(artifact.pk))
            continue
        with transaction.atomic():
            _lock_asset(artifact)
            row = (
                DerivedArtifact.objects.select_for_update(of=("self",))
                .select_related("job")
                .filter(pk=artifact.pk)
                .first()
            )
            # Re-check under the lock: a review, hold, promotion or new job may have won.
            if (
                row is None
                or row.state not in EXPIRABLE
                or row.expires_at is None
                or row.expires_at > stamp
                or row.retention_hold
                or _active_job(row)
            ):
                continue
            row.state = ArtifactState.EXPIRED
            row.save(update_fields=["state"])
            report["expired"].append(str(row.pk))


def _lock_asset(artifact) -> None:
    from apps.catalog.models import ContentAsset

    ContentAsset.objects.select_for_update().filter(pk=artifact.asset_id).first()


def _delete_objects(report, stamp, apply) -> None:
    rows = DerivedArtifact.objects.filter(state=ArtifactState.EXPIRED).order_by("created_at")[
        :BATCH
    ]
    for artifact in list(rows):
        if not apply:
            report["deleted"].append(str(artifact.pk))
            continue
        try:
            store.delete_object(artifact.storage_key)
        except ArtifactStorageUnavailable:
            report["delete_failed"].append(str(artifact.pk))
            continue
        with transaction.atomic():
            _lock_asset(artifact)
            row = DerivedArtifact.objects.select_for_update().filter(pk=artifact.pk).first()
            if row is None or row.state != ArtifactState.EXPIRED:
                continue
            row.state = ArtifactState.DELETED
            row.object_deleted_at = stamp
            row.job = None  # the lineage stays in `job_id_text`; the job may now be pruned
            row.save(update_fields=["state", "object_deleted_at", "job"])
            report["deleted"].append(str(row.pk))


def _orphans(report, stamp, apply, grace) -> None:
    from apps.jobs.models import ProcessingJob

    cutoff = stamp - grace
    known = set(DerivedArtifact.objects.values_list("storage_key", flat=True))
    for item in store.list_objects():
        if item.key in known:
            continue
        if item.last_modified > cutoff:
            report["orphans_kept_recent"].append(item.key)
            continue
        parsed = store.parse_job_key(item.key)
        if not apply:
            if parsed and _job_active(parsed["job_id"]):
                report["orphans_kept_active"].append(item.key)
            else:
                report["orphans"].append(item.key)
            continue
        with transaction.atomic():
            if parsed:
                job = ProcessingJob.objects.select_for_update().filter(pk=parsed["job_id"]).first()
                if job is not None and job.status in ("pending", "running"):
                    report["orphans_kept_active"].append(item.key)
                    continue
            if DerivedArtifact.objects.filter(storage_key=item.key).exists():
                continue  # a row appeared meanwhile: it owns the object now
            report["orphans"].append(item.key)
            try:
                store.delete_object(item.key)
            except ArtifactStorageUnavailable:
                report["delete_failed"].append(item.key)
                continue
            report["orphans_deleted"].append(item.key)


def _job_active(job_id: str) -> bool:
    from apps.jobs.models import ProcessingJob

    return ProcessingJob.objects.filter(pk=job_id, status__in=["pending", "running"]).exists()
