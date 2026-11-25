"""Asset inspection in the background (`asset.inspect`; apps.jobs).

The media worker reads a stored asset object and returns read-only metadata (glTF structure and
counts, image dimensions, audio basics). The metadata is kept on the job only: an asset version's
own `metadata` is its validation record and is immutable once published, so a background
inspection never rewrites it. Staff start an inspection from the asset version admin.
"""

import logging

from apps.jobs.core.envelope import ASSET_INSPECT
from apps.jobs.core.tasks import TaskError

from .storage import ObjectMissing, StorageError, get_storage

logger = logging.getLogger("lai.assets")

SUBJECT = "assets.assetversion"


def submit_inspection(version, user):
    """Submit `asset.inspect` for `version`. A GLB carries the GLB limit as `max_bytes`
    (`max_glb_bytes()`), and one above it is refused here with `JobsError("object_too_large")`
    before any job exists. Other formats keep the worker's 64 MiB ceiling."""
    from apps.jobs import services as jobs

    from .validation import max_glb_bytes

    payload = {"storage_key": version.storage_key, "format": version.format}
    if version.format == "glb":
        limit = max_glb_bytes()
        if version.size_bytes > limit:
            raise jobs.JobsError("object_too_large")
        payload["max_bytes"] = limit
    return jobs.submit(ASSET_INSPECT, payload, user=user, subject=version)


def inspection_in_progress(version) -> bool:
    """True when `version` has an `asset.inspect` job, queued or running, for its stored file.
    Other job kinds for the version (a validation, an optimization) do not count."""
    from apps.jobs.models import JobStatus, ProcessingJob

    return ProcessingJob.objects.filter(
        kind=ASSET_INSPECT,
        subject_type=SUBJECT,
        subject_id=str(version.pk),
        payload__storage_key=version.storage_key,
        status__in=[JobStatus.PENDING, JobStatus.RUNNING],
    ).exists()


def submit_inspection_once(version, user):
    """`submit_inspection`, unless one is already queued or running: returns None then.

    The check and the submission run in one transaction under a row lock on the version, so two
    simultaneous submissions queue one job (the second waits for the first to commit, then sees
    its job). A finished (completed or failed) inspection never blocks a new one."""
    from django.db import transaction

    from .models import AssetVersion

    with transaction.atomic():
        locked = AssetVersion.objects.select_for_update().filter(pk=version.pk).first()
        if locked is None or inspection_in_progress(locked):
            return None
        return submit_inspection(version, user)


def apply(job) -> None:
    logger.info(
        "asset inspection finished id=%s status=%s code=%s",
        job.pk,
        job.status,
        job.error_code or "-",
    )


class InlinePorts:
    def asset_object_size(self, key: str) -> int | None:
        try:
            with get_storage().open(key) as stream:
                return stream.seek(0, 2)
        except ObjectMissing:
            return None
        except StorageError:
            raise TaskError("storage", retryable=True) from None

    def read_asset(self, key: str, start: int, length: int) -> bytes:
        try:
            with get_storage().open(key) as stream:
                stream.seek(start)
                return stream.read(length)
        except ObjectMissing:
            # Gone between the size check and the read: permanent, like the worker's NoSuchKey.
            raise TaskError("object_missing") from None
        except StorageError:
            raise TaskError("storage", retryable=True) from None


def inline_ports(job) -> InlinePorts:
    return InlinePorts()
