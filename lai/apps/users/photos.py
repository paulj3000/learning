"""Child profile photos: upload, replace, read and delete (LAI-0904, ADR-042).

Django is the authority. Every operation resolves the child through the authenticated parent
(`services.get_owned_child_profile`), so another family's child and an unknown id fail the same
way. Clients never see a storage key: they get photo metadata and either a short-lived presigned
GET (S3) or the authenticated `photo/content/` route (local and test stores).

Failure ordering, so a storage failure can never corrupt the database:

- Upload: validate and clean the bytes, then write a *new* object (fresh UUID key, never an
  overwrite), then switch the database in one transaction. If S3 fails, nothing in the database
  changed. If the database fails, the new object is deleted again; if even that fails, the
  object has no row and `manage.py child_photo_storage_audit --delete` removes it.
- Replace and delete: the old row becomes `DELETING` in the same transaction, so it is never
  served again; its object is deleted after commit. A failed delete leaves the `DELETING` row for
  the audit command to retry. Deleting an object in the versioned bucket leaves a noncurrent
  version that S3 expires after the retention window (docs/platform/CHILD_PHOTO_STORAGE.md).

Logs carry counts and outcomes only: never a key, child id, nickname or image byte.
"""

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.utils.timezone import now

from . import services
from .models import ChildPhoto, ChildPhotoStatus, ChildProfile, ParentAccount
from .photo_storage import (
    PhotoStorageError,
    get_photo_storage,
    parse_key,
    photo_key,
)
from .photo_validation import PhotoRejected, check_content_type, clean_jpeg

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PhotoAccess:
    url: str | None  # None: the caller builds the authenticated content route
    expires_at: datetime | None


def current_photo(child: ChildProfile) -> ChildPhoto | None:
    return ChildPhoto.objects.for_child(child).filter(status=ChildPhotoStatus.CURRENT).first()


def has_current_photo(child: ChildProfile) -> bool:
    return ChildPhoto.objects.for_child(child).filter(status=ChildPhotoStatus.CURRENT).exists()


def owned_current_photo(parent: ParentAccount, child_id) -> ChildPhoto | None:
    """The current photo of one of `parent`'s children; `ChildProfileNotFound` otherwise."""
    return current_photo(services.get_owned_child_profile(parent, child_id))


def validate_upload(data: bytes, content_type: str):
    """The cleaned photo, or `PhotoRejected` with a stable code. Touches no storage."""
    if len(data) > settings.LAI_CHILD_PHOTO_MAX_BYTES:
        raise PhotoRejected("photo_too_large")
    if not data:
        raise PhotoRejected("photo_invalid")
    check_content_type(content_type)
    return clean_jpeg(data, max_dimension=settings.LAI_CHILD_PHOTO_MAX_DIMENSION)


def replace_photo(parent: ParentAccount, child_id, data: bytes, content_type: str) -> ChildPhoto:
    """Store a new photo for one of `parent`'s children, superseding any current one.

    Raises `ChildProfileNotFound`, `PhotoRejected`, or `PhotoStorageError` (nothing changed).
    """
    child = services.get_owned_child_profile(parent, child_id)
    clean = validate_upload(data, content_type)
    digest = hashlib.sha256(clean.data).hexdigest()
    photo_id = uuid.uuid4()
    key = photo_key(child.pk, photo_id)
    storage = get_photo_storage()
    storage.put(key, clean.data, sha256=digest)  # a failure here leaves the database untouched
    try:
        with transaction.atomic():
            locked = services.lock_owned_child_profile(parent, child.pk)  # may be gone by now
            superseded = _retire(locked)
            photo = ChildPhoto.objects.create(
                id=photo_id,
                child=locked,
                storage_key=key,
                status=ChildPhotoStatus.CURRENT,
                content_type="image/jpeg",
                byte_size=len(clean.data),
                sha256=digest,
                width=clean.width,
                height=clean.height,
            )
            transaction.on_commit(lambda: purge_photos(superseded), robust=True)
    except BaseException:
        _discard_unreferenced(storage, key)
        raise
    return photo


def delete_photo(parent: ParentAccount, child_id) -> bool:
    """Stop serving the child's current photo and delete its object. False when there was none.

    The database change does not depend on S3: if the object delete fails, the row stays
    `DELETING` (never served) and the audit command retries it.
    """
    child = services.get_owned_child_profile(parent, child_id)
    with transaction.atomic():
        locked = services.lock_owned_child_profile(parent, child.pk)
        retired = _retire(locked)
        transaction.on_commit(lambda: purge_photos(retired), robust=True)
    return bool(retired)


def delete_all_child_photos(child: ChildProfile) -> bool:
    """For child deletion (LAI-0602): retire every photo row and delete every object now.

    Returns True when every object is gone. The caller must not delete the child (which
    cascades the rows away) unless this returned True, or the objects lose their only record.
    """
    with transaction.atomic():
        ChildPhoto.objects.for_child(child).filter(status=ChildPhotoStatus.CURRENT).update(
            status=ChildPhotoStatus.DELETING, status_changed_at=now()
        )
        ids = list(ChildPhoto.objects.for_child(child).values_list("id", flat=True))
    return purge_photos(ids) == len(ids)


def _retire(child: ChildProfile) -> list[uuid.UUID]:
    """Mark the child's current photo `DELETING` (inside the caller's transaction)."""
    rows = (
        ChildPhoto.objects.for_child(child)
        .select_for_update()
        .filter(status=ChildPhotoStatus.CURRENT)
    )
    ids = list(rows.values_list("id", flat=True))
    ChildPhoto.objects.filter(pk__in=ids).update(
        status=ChildPhotoStatus.DELETING, status_changed_at=now()
    )
    return ids


def purge_photos(photo_ids) -> int:
    """Delete the objects of `DELETING` rows, then the rows. Returns how many were purged."""
    storage = get_photo_storage()
    purged = failed = 0
    rows = ChildPhoto.objects.filter(pk__in=list(photo_ids), status=ChildPhotoStatus.DELETING)
    for photo in rows:
        try:
            storage.delete(photo.storage_key)
        except PhotoStorageError:
            failed += 1
            continue
        photo.delete()
        purged += 1
    if failed:
        logger.warning("child photo delete deferred", extra={"photos_deferred": failed})
    return purged


def _discard_unreferenced(storage, key: str) -> None:
    try:
        storage.delete(key)
    except PhotoStorageError:
        logger.warning("child photo upload rollback left an unreferenced object")


def photo_access(photo: ChildPhoto) -> PhotoAccess:
    """A presigned GET for S3, or (None, None) when Django must stream the bytes."""
    ttl = settings.LAI_CHILD_PHOTO_URL_TTL_SECONDS
    url = get_photo_storage().presigned_url(photo.storage_key, expires_in=ttl)
    if url is None:
        return PhotoAccess(None, None)
    return PhotoAccess(url, now() + timedelta(seconds=ttl))


def read_photo(photo: ChildPhoto) -> bytes:
    """The stored bytes. Raises `PhotoStorageError` (including a missing object)."""
    return get_photo_storage().read(photo.storage_key)


# --- Audit (manage.py child_photo_storage_audit) -------------------------------------------------


@dataclass
class PhotoAuditReport:
    objects: int = 0
    current_rows: int = 0
    deleting_rows: int = 0
    missing_objects: int = 0  # a CURRENT row whose object is gone
    orphan_objects: list[str] = field(default_factory=list)  # objects with no row (keys)
    young_orphans: int = 0  # too new to judge: an upload may still be committing
    purged_rows: int = 0
    deleted_orphans: int = 0


def audit_photo_storage(*, delete: bool, min_orphan_age: timedelta) -> PhotoAuditReport:
    """Compare the bucket with the photo table. Read-only unless `delete`.

    With `delete`: retry every `DELETING` row, and delete orphan objects older than
    `min_orphan_age` (a younger one may belong to an upload whose transaction is still open).
    """
    storage = get_photo_storage()
    report = PhotoAuditReport()
    known = dict(ChildPhoto.objects.values_list("storage_key", "status"))
    report.current_rows = sum(status == ChildPhotoStatus.CURRENT for status in known.values())
    report.deleting_rows = len(known) - report.current_rows
    cutoff = now() - min_orphan_age
    seen: set[str] = set()
    for stored in storage.list():
        report.objects += 1
        seen.add(stored.key)
        if stored.key in known:
            continue
        if parse_key(stored.key) is None or stored.last_modified > cutoff:
            report.young_orphans += parse_key(stored.key) is not None
            continue
        report.orphan_objects.append(stored.key)
    report.missing_objects = sum(
        1 for key, status in known.items() if status == ChildPhotoStatus.CURRENT and key not in seen
    )
    if delete:
        deleting = ChildPhoto.objects.filter(status=ChildPhotoStatus.DELETING)
        report.purged_rows = purge_photos(deleting.values_list("id", flat=True))
        for key in report.orphan_objects:
            try:
                storage.delete(key)
                report.deleted_orphans += 1
            except PhotoStorageError:
                continue
    return report
