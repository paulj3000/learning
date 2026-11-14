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
    try:
        # Generated speech for this child expires on its own; this just removes it sooner.
        from apps.speech.services import purge_child

        purge_child(child.pk)
    except Exception:  # noqa: BLE001 - never block a deletion that already succeeded
        logger.warning("child deletion: speech cleanup deferred to expiry")
    logger.info("child profile deleted")


class StaffAccountNotDeletable(Exception):
    """The account is also Django Admin staff: staff rows are managed only in Django Admin."""


def delete_parent_account(parent: ParentAccount) -> None:
    """Delete a parent's account and everything it owns (AMP-03, right to delete).

    Each child goes through `delete_child_profile` first (photo objects, then the child and its
    cascade), exactly as when a parent deletes one child. A storage failure raises
    `ChildDeletionIncomplete`: the children already deleted stay deleted, the rest and the account
    are kept, and a retry finishes the job. Then, in one transaction, the parent's household co-op
    sessions (their foreign key protects the account) and the account row itself, which cascades
    its sign-in anchors, launch tickets and game sessions.

    The Cognito user is not deleted here: the client deletes it after this succeeds, while its
    token is still valid (Django holds no Cognito administrator right). A staff account (Django
    Admin) is refused: staff rows are created and removed only through Django Admin (ADR-034).
    """
    from apps.game_sessions.models import CoopSession

    if parent.is_staff or parent.admin_username:
        raise StaffAccountNotDeletable
    for child_id in list(services.list_child_profiles(parent).values_list("pk", flat=True)):
        try:
            delete_child_profile(parent, child_id)
        except services.ChildProfileNotFound:  # deleted by a concurrent request
            continue
    with transaction.atomic():
        locked = ParentAccount.objects.select_for_update().get(pk=parent.pk)
        if services.list_child_profiles(locked).exists():
            # A child created while the others were being deleted: keep the account, so the
            # child is never orphaned; a retry deletes it too.
            logger.warning("account deletion deferred: a child was added during deletion")
            raise ChildDeletionIncomplete
        CoopSession.objects.filter(host_parent=locked).delete()
        locked.delete()
    logger.info("parent account deleted")
