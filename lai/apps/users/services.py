"""Rules that a database constraint cannot express. Views must call these, not the ORM directly.

Ownership guarantee: a child profile is only ever fetched through a parent. An id that does not
exist and an id that belongs to someone else are indistinguishable to the caller.
"""

from uuid import UUID

from django.db import transaction

from .models import MAX_CHILD_PROFILES, ChildProfile, ParentAccount


class ChildProfileNotFound(Exception):
    """Raised for a missing id and for another parent's id alike (no enumeration)."""


class ChildProfileLimitReached(Exception):
    """The parent already has the maximum number of child profiles."""


def list_child_profiles(parent: ParentAccount):
    return ChildProfile.objects.owned_by(parent).order_by("created_at", "id")


def get_owned_child_profile(parent: ParentAccount, child_id) -> ChildProfile:
    try:
        child_uuid = child_id if isinstance(child_id, UUID) else UUID(str(child_id))
    except ValueError:
        raise ChildProfileNotFound from None
    try:
        return ChildProfile.objects.owned_by(parent).get(pk=child_uuid)
    except ChildProfile.DoesNotExist:
        raise ChildProfileNotFound from None


def create_child_profile(parent: ParentAccount, **fields) -> ChildProfile:
    """Validate and create a profile, enforcing the three-profile cap.

    The cap counts every profile, active or not, as the current app does
    (`childProfiles.length < MAX_CHILD_PROFILES`). The parent row is locked for the check so two
    concurrent requests cannot both pass it. Callers must not pass `parent`, `id` or timestamps
    in `fields`.
    """
    with transaction.atomic():
        locked = ParentAccount.objects.select_for_update().get(pk=parent.pk)
        if ChildProfile.objects.owned_by(locked).count() >= MAX_CHILD_PROFILES:
            raise ChildProfileLimitReached
        child = ChildProfile(parent=locked, **fields)
        child.full_clean()
        child.save()
        return child


def update_child_profile(parent: ParentAccount, child_id, **fields) -> ChildProfile:
    """Validate and apply a parent's edit to their own child, under a row lock.

    The child is resolved through `parent` again (a foreign or unknown id is
    `ChildProfileNotFound`). `fields` are model field names from the closed request serializer;
    ownership, ids, the photo path and timestamps can never be among them.
    """
    allowed = {
        "nickname",
        "age_band",
        "avatar_key",
        "interests",
        "reading_mode",
        "session_minutes",
        "active",
        "ai_enabled",
    }
    if set(fields) - allowed:
        raise ValueError("Only profile settings can be changed.")
    with transaction.atomic():
        try:
            child_uuid = child_id if isinstance(child_id, UUID) else UUID(str(child_id))
            child = ChildProfile.objects.owned_by(parent).select_for_update().get(pk=child_uuid)
        except (ValueError, ChildProfile.DoesNotExist):
            raise ChildProfileNotFound from None
        for name, value in fields.items():
            setattr(child, name, value)
        child.full_clean()
        child.save()
        return child


def provision_parent_account(cognito_sub: str) -> tuple[ParentAccount, bool]:
    """Create the account for a verified Cognito `sub` if absent. Returns (account, created).

    Race-safe: `cognito_sub` is unique and `get_or_create` retries after an IntegrityError, so
    concurrent first requests produce exactly one row. Never rewrites an existing account.
    Callers must pass a `sub` taken from a verified token.
    """
    if not cognito_sub or not cognito_sub.strip():
        raise ValueError("cognito_sub is required")
    return ParentAccount.objects.get_or_create(cognito_sub=cognito_sub)
