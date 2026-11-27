"""Family accounts and child sessions: the domain rules (LAI-AUTH-01, ADR-NNN).

Design: docs/platform/FAMILY_CHILD_AUTHENTICATION.md. This module holds the rules both sign-in
modes share; it has no views and no authenticator, so nothing here is reachable from the API
until LAI-AUTH-02/03/04 wire it (after ADR-NNN is accepted).

- Mode A, family login: a parent signed in with Cognito opens a `FamilyDevice`; from it, a child
  (after their PIN, if the parent set one) gets a `ChildPlaySession`.
- Mode B, independent child login: a verified child-pool access token, mapped through its
  `ChildCredential` to the same `ChildProfile`, is exchanged for a `ChildPlaySession`.

Rules kept here, so every caller gets them:

1. Ownership: a child is always resolved through the parent (`services.get_owned_child_profile`).
   Another family's child, an unknown id and an inactive child give one answer.
2. Credentials are 256-bit random values; only SHA-256 digests are stored. PINs are Django
   password hashes. No value, PIN, login name or child id is ever logged.
3. Every check runs again on every use: parent active, child active and still the parent's,
   device live, credential active and not reset since the session began.
4. Lockout state is in PostgreSQL (row-locked), so it holds across workers and restarts.
5. Consent (gate G9) fails closed: mode B cannot open a session until LAI-0308 records consent.
"""

import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone

from . import services
from .models import (
    LOGIN_NAME_MAX_LENGTH,
    LOGIN_NAME_MIN_LENGTH,
    ChildCredential,
    ChildCredentialStatus,
    ChildPin,
    ChildPlaySession,
    ChildProfile,
    ChildSessionSource,
    FamilyDevice,
    ParentAccount,
)

PIN_PATTERN = re.compile(r"^[0-9]{4}$")
LOGIN_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
MAX_CREDENTIAL_LENGTH = 128
# `last_seen_at` is written at most this often, so a busy session is not one UPDATE per request.
TOUCH_INTERVAL = timedelta(seconds=60)


class FamilyAuthError(Exception):
    code = "family_auth_error"


class ProfileUnavailable(FamilyAuthError):
    """Not this parent's child, unknown, or inactive: one answer, so ids cannot be probed."""

    code = "profile_unavailable"


class PinInvalid(FamilyAuthError):
    """The PIN does not have the required shape (setting it)."""

    code = "pin_invalid"


class PinRequired(FamilyAuthError):
    code = "pin_required"


class PinIncorrect(FamilyAuthError):
    code = "pin_incorrect"


class PinLocked(FamilyAuthError):
    """Too many wrong PINs for this child. The parent can clear it by setting a new PIN."""

    code = "pin_locked"


class LoginNameInvalid(FamilyAuthError):
    code = "login_name_invalid"


class CredentialUnavailable(FamilyAuthError):
    """Unknown, suspended, revoked, still provisioning, or reset after the token was issued."""

    code = "credential_unavailable"


class ConsentRequired(FamilyAuthError):
    """Gate G9: no recorded parental consent covers independent child login."""

    code = "consent_required"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii", "ignore")).hexdigest()


def _now(now=None):
    return now or timezone.now()


def _usable_value(value) -> bool:
    return isinstance(value, str) and 20 <= len(value) <= MAX_CREDENTIAL_LENGTH


def _owned_active_child(parent: ParentAccount, child_id) -> ChildProfile:
    try:
        child = services.get_owned_child_profile(parent, child_id)
    except services.ChildProfileNotFound:
        raise ProfileUnavailable from None
    if not child.active:
        raise ProfileUnavailable
    return child


# --- PINs ----------------------------------------------------------------------------------------


def validate_pin(pin) -> str:
    """Four digits. Anything else (including non-ASCII digits) is refused."""
    if not isinstance(pin, str) or not PIN_PATTERN.fullmatch(pin):
        raise PinInvalid
    return pin


def set_pin(parent: ParentAccount, child_id, pin, *, now=None) -> ChildPin:
    """Set or replace a child's PIN. Clears any lockout. The caller enforces recent sign-in."""
    validate_pin(pin)
    at = _now(now)
    with transaction.atomic():
        child = services.lock_owned_child_profile(parent, child_id)  # ChildProfileNotFound
        row, _ = ChildPin.objects.select_for_update().get_or_create(
            child=child, defaults={"pin_hash": make_password(pin), "updated_at": at}
        )
        row.pin_hash = make_password(pin)
        row.failed_attempts = 0
        row.locked_until = None
        row.updated_at = at
        row.save(update_fields=["pin_hash", "failed_attempts", "locked_until", "updated_at"])
    return row


def clear_pin(parent: ParentAccount, child_id) -> bool:
    child = services.get_owned_child_profile(parent, child_id)  # ChildProfileNotFound
    deleted, _ = ChildPin.objects.filter(child=child).delete()
    return bool(deleted)


def has_pin(child: ChildProfile) -> bool:
    return ChildPin.objects.filter(child=child).exists()


def check_pin(child: ChildProfile, pin, *, now=None) -> None:
    """Pass silently if the child has no PIN or `pin` matches; otherwise raise.

    The attempt is counted under a row lock, so concurrent guesses cannot exceed the limit. A
    locked PIN is refused before it is compared, even when the guess is right.
    """
    at = _now(now)
    with transaction.atomic():
        row = ChildPin.objects.select_for_update().filter(child=child).first()
        if row is None:
            return
        if row.locked_until is not None and row.locked_until > at:
            raise PinLocked
        if pin is None or pin == "":
            raise PinRequired
        if (
            isinstance(pin, str)
            and PIN_PATTERN.fullmatch(pin)
            and check_password(pin, row.pin_hash)
        ):
            if row.failed_attempts or row.locked_until:
                row.failed_attempts = 0
                row.locked_until = None
                row.save(update_fields=["failed_attempts", "locked_until"])
            return
        row.failed_attempts += 1
        locked = row.failed_attempts >= settings.LAI_CHILD_PIN_MAX_ATTEMPTS
        if locked:
            row.failed_attempts = 0
            row.locked_until = at + timedelta(seconds=settings.LAI_CHILD_PIN_LOCKOUT_SECONDS)
        row.save(update_fields=["failed_attempts", "locked_until"])
    # Raised after the transaction commits, so the counted attempt is kept.
    raise PinLocked if locked else PinIncorrect


# --- Family devices (mode A) ---------------------------------------------------------------------


def create_family_device(
    parent: ParentAccount, *, remembered: bool, now=None
) -> tuple[str, FamilyDevice]:
    """A new device credential for `parent`. The caller enforces recent sign-in (ADR-043)."""
    if not parent.is_active:
        raise ProfileUnavailable
    at = _now(now)
    lifetime = (
        settings.LAI_FAMILY_DEVICE_REMEMBER_SECONDS
        if remembered
        else settings.LAI_FAMILY_DEVICE_SESSION_SECONDS
    )
    value = secrets.token_urlsafe(32)
    device = FamilyDevice.objects.create(
        parent=parent,
        token_hash=_digest(value),
        remembered=bool(remembered),
        created_at=at,
        last_used_at=at,
        expires_at=at + timedelta(seconds=lifetime),
    )
    return value, device


def _device_live(device: FamilyDevice, at) -> bool:
    return device.revoked_at is None and device.expires_at > at and device.parent.is_active


def device_for_value(value, *, now=None) -> FamilyDevice | None:
    """The live device a cookie value names, or None."""
    if not _usable_value(value):
        return None
    at = _now(now)
    device = FamilyDevice.objects.select_related("parent").filter(token_hash=_digest(value)).first()
    if device is None or not _device_live(device, at):
        return None
    if at - device.last_used_at >= TOUCH_INTERVAL:
        FamilyDevice.objects.filter(pk=device.pk).update(last_used_at=at)
    return device


def device_profiles(device: FamilyDevice) -> list[ChildProfile]:
    """What the profile picker may show: the device parent's active children, nothing else."""
    return [c for c in services.list_child_profiles(device.parent) if c.active]


def revoke_family_device(parent: ParentAccount, device_id, *, now=None) -> bool:
    """End one of `parent`'s devices and every child session opened from it."""
    at = _now(now)
    with transaction.atomic():
        ended = FamilyDevice.objects.filter(
            pk=device_id, parent=parent, revoked_at__isnull=True
        ).update(revoked_at=at)
        ChildPlaySession.objects.filter(
            family_device_id=device_id, parent=parent, revoked_at__isnull=True
        ).update(revoked_at=at)
    return bool(ended)


def revoke_all_family_devices(parent: ParentAccount, *, now=None) -> int:
    at = _now(now)
    with transaction.atomic():
        ChildPlaySession.objects.filter(
            parent=parent, source=ChildSessionSource.FAMILY_DEVICE, revoked_at__isnull=True
        ).update(revoked_at=at)
        return FamilyDevice.objects.filter(parent=parent, revoked_at__isnull=True).update(
            revoked_at=at
        )


# --- Child play sessions (the child principal) -------------------------------------------------


def _new_session(child, *, now, **links) -> tuple[str, ChildPlaySession]:
    value = secrets.token_urlsafe(32)
    session = ChildPlaySession.objects.create(
        child=child,
        parent_id=child.parent_id,
        token_hash=_digest(value),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(seconds=settings.LAI_CHILD_SESSION_MAX_SECONDS),
        **links,
    )
    return value, session


def start_session_from_device(
    device: FamilyDevice, child_id, pin=None, *, now=None
) -> tuple[str, ChildPlaySession]:
    """Open a child session on a family device (profile picker, sibling switch).

    The child must be the device parent's and active, and pass their PIN if they have one. One
    player per device: the device's earlier sessions end, so a sibling switch cannot leave the
    previous child's session usable.
    """
    at = _now(now)
    if not _device_live(device, at):
        raise ProfileUnavailable
    child = _owned_active_child(device.parent, child_id)
    check_pin(child, pin, now=at)  # PinRequired, PinIncorrect, PinLocked
    with transaction.atomic():
        ChildPlaySession.objects.filter(family_device=device, revoked_at__isnull=True).update(
            revoked_at=at
        )
        return _new_session(
            child, now=at, source=ChildSessionSource.FAMILY_DEVICE, family_device=device
        )


def child_login_consent_recorded(child: ChildProfile) -> bool:
    """Gate G9 (LAI-0308). No `ParentConsent` model exists yet, so this is always False.

    Mode B processes a new kind of child data (a login name) and lets a child start a session
    without a parent present, so it must not run before consent is designed and recorded.
    LAI-0308 replaces this body; until then mode B fails closed.
    """
    return False


def credential_for_identity(issuer: str, subject: str) -> ChildCredential | None:
    if not issuer or not subject:
        return None
    return (
        ChildCredential.objects.select_related("child", "child__parent")
        .filter(issuer=issuer, subject=subject)
        .exclude(status=ChildCredentialStatus.REVOKED)
        .first()
    )


def start_session_from_credential(
    credential: ChildCredential, *, token_issued_at: int, now=None
) -> tuple[str, ChildPlaySession]:
    """Mode B exchange: a verified child-pool access token becomes a child session.

    `token_issued_at` is the verified token's `iat`. A token issued before the credential's
    `tokens_valid_after` (a reset, suspension or resume) is refused even if Cognito still accepts
    it, so Django's revocation never waits for the token to expire.
    """
    at = _now(now)
    if credential.status != ChildCredentialStatus.ACTIVE:
        raise CredentialUnavailable
    if not isinstance(token_issued_at, int) or isinstance(token_issued_at, bool):
        raise CredentialUnavailable
    if token_issued_at < int(credential.tokens_valid_after.timestamp()):
        raise CredentialUnavailable
    child = credential.child
    parent = child.parent
    if not parent.is_active or not child.active:
        raise CredentialUnavailable
    if not child_login_consent_recorded(child):
        raise ConsentRequired
    return _new_session(child, now=at, source=ChildSessionSource.CHILD_LOGIN, credential=credential)


def session_for_value(value, *, now=None) -> ChildPlaySession | None:
    """The live child session a cookie value names, or None. Re-checks everything, every time."""
    if not _usable_value(value):
        return None
    at = _now(now)
    session = (
        ChildPlaySession.objects.select_related(
            "parent", "child", "family_device", "family_device__parent", "credential"
        )
        .filter(token_hash=_digest(value), revoked_at__isnull=True, expires_at__gt=at)
        .first()
    )
    if session is None:
        return None
    idle = timedelta(seconds=settings.LAI_CHILD_SESSION_IDLE_SECONDS)
    if at - session.last_seen_at >= idle:
        return None
    if not session.parent.is_active or not session.child.active:
        return None
    if session.child.parent_id != session.parent_id:  # defence in depth; the FK cannot move
        return None
    if session.source == ChildSessionSource.FAMILY_DEVICE:
        if session.family_device is None or not _device_live(session.family_device, at):
            return None
    else:
        credential = session.credential
        if credential is None or credential.status != ChildCredentialStatus.ACTIVE:
            return None
        if session.created_at < credential.tokens_valid_after:
            return None
    if at - session.last_seen_at >= TOUCH_INTERVAL:
        ChildPlaySession.objects.filter(pk=session.pk).update(last_seen_at=at)
    return session


def session_csrf_token(session: ChildPlaySession) -> str:
    """The value a child-session write must echo in a header. Derived, never stored."""
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, f"lai-child-csrf:{session.token_hash}".encode(), "sha256").hexdigest()


def session_csrf_matches(session: ChildPlaySession, presented) -> bool:
    return isinstance(presented, str) and hmac.compare_digest(
        session_csrf_token(session), presented
    )


def end_session(session: ChildPlaySession, *, now=None) -> None:
    """Explicit logout or "switch player"."""
    ChildPlaySession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=_now(now)
    )


def revoke_child_sessions(parent: ParentAccount, child_id, *, now=None) -> int:
    """The parent ends every session one of their children has, on every device."""
    child = services.get_owned_child_profile(parent, child_id)  # ChildProfileNotFound
    return ChildPlaySession.objects.filter(child=child, revoked_at__isnull=True).update(
        revoked_at=_now(now)
    )


def revoke_all_child_sessions(parent: ParentAccount, *, now=None) -> int:
    return ChildPlaySession.objects.filter(parent=parent, revoked_at__isnull=True).update(
        revoked_at=_now(now)
    )


# --- Independent child credentials (mode B), Django side only ---------------------------------


def validate_login_name(name, *, nickname: str = "") -> str:
    """Normalize and check a parent-chosen login name.

    Lower case letters, digits, `.`, `_` and `-`; 4 to 20 characters; starts with a letter or
    digit. It must not be the child's nickname, so the name a child types on a shared screen is
    not the name the island shows (data minimization). Uniqueness is the database's job.
    """
    if not isinstance(name, str):
        raise LoginNameInvalid
    normalized = name.strip().lower()
    if not LOGIN_NAME_MIN_LENGTH <= len(normalized) <= LOGIN_NAME_MAX_LENGTH:
        raise LoginNameInvalid
    if not LOGIN_NAME_PATTERN.fullmatch(normalized):
        raise LoginNameInvalid
    if nickname and normalized == nickname.strip().lower():
        raise LoginNameInvalid
    return normalized


def _live_credential(parent: ParentAccount, child_id) -> ChildCredential:
    child = services.get_owned_child_profile(parent, child_id)  # ChildProfileNotFound
    credential = (
        ChildCredential.objects.select_for_update()
        .filter(child=child)
        .exclude(status=ChildCredentialStatus.REVOKED)
        .first()
    )
    if credential is None:
        raise CredentialUnavailable
    return credential


def _set_status(credential: ChildCredential, status: str, at) -> None:
    credential.status = status
    credential.status_changed_at = at
    credential.tokens_valid_after = at
    credential.save(update_fields=["status", "status_changed_at", "tokens_valid_after"])
    ChildPlaySession.objects.filter(credential=credential, revoked_at__isnull=True).update(
        revoked_at=at
    )


def suspend_credential(parent: ParentAccount, child_id, *, now=None) -> ChildCredential:
    """Pause independent login. Effective in Django at once: sessions end, tokens are refused.

    The Cognito side (disable the user, global sign-out) follows in LAI-AUTH-05 and is not
    needed for the refusal to hold.
    """
    at = _now(now)
    with transaction.atomic():
        credential = _live_credential(parent, child_id)
        if credential.status != ChildCredentialStatus.ACTIVE:
            raise CredentialUnavailable
        _set_status(credential, ChildCredentialStatus.SUSPENDED, at)
    return credential


def resume_credential(parent: ParentAccount, child_id, *, now=None) -> ChildCredential:
    """Re-enable a suspended login. Tokens from before the suspension stay refused."""
    at = _now(now)
    with transaction.atomic():
        credential = _live_credential(parent, child_id)
        if credential.status != ChildCredentialStatus.SUSPENDED:
            raise CredentialUnavailable
        _set_status(credential, ChildCredentialStatus.ACTIVE, at)
    return credential


def revoke_credential(parent: ParentAccount, child_id, *, now=None) -> ChildCredential:
    """Remove independent login. The profile and all progress stay; only the sign-in goes."""
    at = _now(now)
    with transaction.atomic():
        credential = _live_credential(parent, child_id)
        _set_status(credential, ChildCredentialStatus.REVOKED, at)
    return credential


def record_password_reset(parent: ParentAccount, child_id, *, now=None) -> ChildCredential:
    """After the parent set a new password in Cognito (LAI-AUTH-05): end old sessions and
    refuse every token issued before now. The password itself never reaches this module."""
    at = _now(now)
    with transaction.atomic():
        credential = _live_credential(parent, child_id)
        credential.tokens_valid_after = at
        credential.save(update_fields=["tokens_valid_after"])
        ChildPlaySession.objects.filter(credential=credential, revoked_at__isnull=True).update(
            revoked_at=at
        )
    return credential
