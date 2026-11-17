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
    from apps.jobs import services as jobs

    return jobs.submit(
        ASSET_INSPECT,
        {"storage_key": version.storage_key, "format": version.format},
        user=user,
        subject=version,
    )


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
