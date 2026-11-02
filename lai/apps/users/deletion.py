"""Child profile deletion (LAI-0602), photo storage first.

Deleting a child cascades every child-owned row (`ChildOwnedModel`, `ChildPhoto`) from the
`ChildProfile` row. The photo objects in S3 are not rows, so they are removed first: the child is
deleted only once `photos.delete_all_child_photos` reports that every object is gone. If storage
fails, nothing is deleted from the database, the photo rows stay `DELETING` (never served), and a
retry, or `manage.py child_photo_storage_audit --delete`, finishes the job. Running it again is
safe: a retry finds no current photo and only the leftover `DELETING` rows.

Noncurrent S3 versions of the deleted objects are not removed here: Django has no
`s3:DeleteObjectVersion` right, and the bucket lifecycle expires them 7 days later
(docs/platform/CHILD_PHOTO_STORAGE.md section 5).

Reached through `DELETE /api/v1/children/<id>/` (`ChildDetailView`), which requires a recent
sign-in (`RequiresRecentAuthentication`, LAI-0209, ADR-043) and maps `ChildDeletionIncomplete`
to `503 child_deletion_incomplete`.
"""

import logging

from django.db import transaction

from . import photos, services
from .models import ChildPhoto, ParentAccount

logger = logging.getLogger(__name__)


class ChildDeletionIncomplete(Exception):
    """Photo storage cleanup did not finish, so the child was kept. Safe to retry."""


def delete_child_profile(parent: ParentAccount, child_id) -> None:
    """Delete one of `parent`'s children and everything that belongs to it.

    Raises `services.ChildProfileNotFound` for an unknown id and for another family's child
    alike, and `ChildDeletionIncomplete` when a photo object could not be deleted (the child and
    its records are then unchanged, apart from photos no longer being served).
    """
    child = services.get_owned_child_profile(parent, child_id)
    if not photos.delete_all_child_photos(child):
        logger.warning("child deletion deferred: photo storage cleanup incomplete")
        raise ChildDeletionIncomplete
    with transaction.atomic():
        locked = services.lock_owned_child_profile(parent, child.pk)
        # An upload that stored its row between the purge and this lock would lose its only
        # record in the cascade. Refuse instead; the retry purges it. An upload still waiting
        # for this lock finds the child gone and deletes its own object.
        if ChildPhoto.objects.for_child(locked).exists():
            logger.warning("child deletion deferred: a photo was added during deletion")
            raise ChildDeletionIncomplete
        locked.delete()
    logger.info("child profile deleted")
