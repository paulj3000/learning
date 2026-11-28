"""Independent child sign-in: the domain rules (LAI-AUTH-02 to 07, ADR-075).

Design: docs/platform/FAMILY_CHILD_AUTHENTICATION.md. Every child has their own sign-in in the
separate child Cognito pool; the parent creates, manages, pauses and removes it. Views call this
module; nothing else creates a credential, a child session or a remembered device.

Rules kept here, so every caller gets them:

1. Ownership: a parent reaches a child only through `services.get_owned_child_profile`. Another
   family's child, an unknown id and an inactive child give one answer.
2. Identity: a child-pool token maps to a child only through `(issuer, sub)` of a credential,
   and its `username` claim must be the credential's opaque `provider_username`. Login names are
   never identity keys and nothing the browser says about which child it is counts.
3. Django is the revocation authority. `tokens_valid_after` moves on every reset, suspension,
   resume, sign-out-everywhere and consent withdrawal; tokens, sessions and remembered devices
   from before it are refused at once, whatever Cognito still accepts.
4. Consent (gate G9) fails closed: without a live `ParentConsent` for the approved policy text
   (`LAI_CHILD_SIGN_IN_CONSENT_VERSION`), no credential is created and no session opens.
5. Credentials are 256-bit random values; only SHA-256 digests are stored. No password, token,
   cookie value, login name or child id is ever logged, returned or put in an audit record.
6. Every check runs again on every use (session and remembered device), not only at sign-in.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables

from . import services
from .authentication import LEEWAY_SECONDS, VerifiedToken
from .child_identity import (
    ChildIdentityError,
    LoginNameTaken,
    PasswordRejected,
    get_child_identity_provider,
    new_provider_username,
)
from .models import (
    LOGIN_NAME_MAX_LENGTH,
    LOGIN_NAME_MIN_LENGTH,
    ChildAccountAction,
    ChildAccountEvent,
    ChildCredential,
    ChildCredentialStatus,
    ChildDevice,
    ChildPlaySession,
    ChildProfile,
    ConsentPurpose,
    ParentAccount,
    ParentConsent,
)

logger = logging.getLogger("lai.auth")

LOGIN_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64
MAX_CREDENTIAL_LENGTH = 128
# `last_seen_at` is written at most this often, so a busy session is not one UPDATE per request.
TOUCH_INTERVAL = timedelta(seconds=60)


class ChildAuthError(Exception):
    code = "child_auth_error"


class ProfileUnavailable(ChildAuthError):
    """Not this parent's child, unknown, or inactive: one answer, so ids cannot be probed."""

    code = "profile_unavailable"


class LoginNameInvalid(ChildAuthError):
    code = "login_name_invalid"


class LoginNameUnavailable(ChildAuthError):
    """Already used by another child (in Django or the pool)."""

    code = "login_name_unavailable"


class PasswordInvalid(ChildAuthError):
    code = "password_invalid"


class CredentialUnavailable(ChildAuthError):
    """No sign-in to act on, or it is not in a state that allows the action."""

    code = "child_sign_in_not_found"


class AlreadyEnabled(ChildAuthError):
    code = "child_sign_in_exists"


class ConsentRequired(ChildAuthError):
    code = "consent_required"


class ConsentUnavailable(ChildAuthError):
    """No approved consent text is configured (gate G9), so consent cannot be given."""

    code = "consent_unavailable"


class IdentityServiceUnavailable(ChildAuthError):
    """The child pool could not complete the call. Nothing changed; safe to retry."""

    code = "child_identity_unavailable"


class SignInRefused(ChildAuthError):
    """A child cannot start a session. One answer for every cause; the cause is logged as a code.

    The child is told to ask their parent; the parent sees the account state on the dashboard.
    """

    code = "child_sign_in_unavailable"

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# --- small helpers -------------------------------------------------------------------------------


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii", "ignore")).hexdigest()


def _now(now=None):
    return now or timezone.now()


def _usable_value(value) -> bool:
    return isinstance(value, str) and 20 <= len(value) <= MAX_CREDENTIAL_LENGTH


def _owned_child(parent: ParentAccount, child_id, *, lock=False) -> ChildProfile:
    try:
        if lock:
            child = services.lock_owned_child_profile(parent, child_id)
        else:
            child = services.get_owned_child_profile(parent, child_id)
    except services.ChildProfileNotFound:
        raise ProfileUnavailable from None
    return child


def _record(parent: ParentAccount, child: ChildProfile, action: str, at) -> None:
    ChildAccountEvent.objects.create(child=child, parent=parent, action=action, occurred_at=at)


def _live_credential(child: ChildProfile, *, lock=False) -> ChildCredential | None:
    queryset = ChildCredential.objects.filter(child=child).exclude(
        status=ChildCredentialStatus.REVOKED
    )
    if lock:
        queryset = queryset.select_for_update()
    return queryset.first()


def _cut_off(credential: ChildCredential, at) -> None:
    """Move the revocation line and end every session and remembered device of this sign-in."""
    credential.tokens_valid_after = at
    ChildPlaySession.objects.filter(credential=credential, revoked_at__isnull=True).update(
        revoked_at=at
    )
    ChildDevice.objects.filter(credential=credential, revoked_at__isnull=True).update(revoked_at=at)


def _best_effort(call, *args) -> bool:
    """A provider call whose failure must not undo a protective change Django already made."""
    try:
        call(*args)
    except ChildIdentityError as error:
        logger.warning("child identity follow-up deferred: %s", error.code)
        return False
    return True


# --- validation ----------------------------------------------------------------------------------


def validate_login_name(name, *, nickname: str = "") -> str:
    """Normalize and check a parent-chosen username.

    Lower case letters, digits, `.`, `_` and `-`; 4 to 20 characters; starts with a letter or
    digit. It must not be the child's nickname, so the name typed on a shared screen is not the
    name the island shows (data minimization). Uniqueness is checked by the database and the pool.
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


@sensitive_variables("password")
def validate_password(password, *, login_name: str, nickname: str = "") -> str:
    """A child password the parent chose: 8 to 64 characters, not the username or nickname.

    Child-friendly on purpose (no symbol rules); the pool's own policy is the same minimum
    (OD-6 in the design). Never logged, never stored, never echoed back.
    """
    if not isinstance(password, str):
        raise PasswordInvalid
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        raise PasswordInvalid
    if password != password.strip() or any(ord(c) < 32 for c in password):
        raise PasswordInvalid
    lowered = password.lower()
    if login_name and login_name in lowered:
        raise PasswordInvalid
    if nickname and nickname.strip().lower() == lowered:
        raise PasswordInvalid
    return password


# --- consent (gate G9) ---------------------------------------------------------------------------


def approved_consent_version() -> str:
    return settings.LAI_CHILD_SIGN_IN_CONSENT_VERSION


def has_sign_in_consent(child: ChildProfile) -> bool:
    """A live consent for the currently approved text. A new text needs a new consent."""
    version = approved_consent_version()
    if not version:
        return False
    return ParentConsent.objects.filter(
        child=child,
        parent_id=child.parent_id,
        purpose=ConsentPurpose.CHILD_INDEPENDENT_SIGN_IN,
        policy_version=version,
        withdrawn_at__isnull=True,
    ).exists()


def grant_sign_in_consent(parent: ParentAccount, child_id, *, now=None) -> ParentConsent:
    """The parent consents to this child signing in on their own (recent sign-in required)."""
    at = _now(now)
    version = approved_consent_version()
    if not version:
        raise ConsentUnavailable
    with transaction.atomic():
        child = _owned_child(parent, child_id, lock=True)
        live = ParentConsent.objects.filter(
            child=child,
            purpose=ConsentPurpose.CHILD_INDEPENDENT_SIGN_IN,
            withdrawn_at__isnull=True,
        ).first()
        if live is not None and live.policy_version == version:
            return live
        if live is not None:  # consent to an older text: replaced, never silently upgraded
            live.withdrawn_at = at
            live.save(update_fields=["withdrawn_at"])
        consent = ParentConsent.objects.create(
            child=child,
            parent=parent,
            purpose=ConsentPurpose.CHILD_INDEPENDENT_SIGN_IN,
            policy_version=version,
            granted_at=at,
        )
        _record(parent, child, ChildAccountAction.CONSENT_GRANTED, at)
    return consent


def withdraw_sign_in_consent(parent: ParentAccount, child_id, *, now=None) -> bool:
    """Withdraw consent. Every session and remembered device of the child ends at once."""
    at = _now(now)
    with transaction.atomic():
        child = _owned_child(parent, child_id, lock=True)
        changed = ParentConsent.objects.filter(
            child=child,
            purpose=ConsentPurpose.CHILD_INDEPENDENT_SIGN_IN,
            withdrawn_at__isnull=True,
        ).update(withdrawn_at=at)
        credential = _live_credential(child, lock=True)
        if credential is not None:
            _cut_off(credential, at)
            credential.save(update_fields=["tokens_valid_after"])
        if changed:
            _record(parent, child, ChildAccountAction.CONSENT_WITHDRAWN, at)
    if credential is not None and credential.subject:
        _best_effort(
            get_child_identity_provider().sign_out_everywhere, credential.provider_username
        )
    return bool(changed)


# --- parent-managed provisioning -----------------------------------------------------------------


@sensitive_variables("password")
def enable_sign_in(
    parent: ParentAccount, child_id, *, login_name, password, now=None
) -> ChildCredential:
    """Give an existing child their own sign-in (recent parent sign-in required).

    The child keeps their id and every progress record: only a `ChildCredential` is added. The
    row is written as PROVISIONING before the pool is called, so a failure part-way leaves a
    retryable state, never a pool user Django does not know about.
    """
    at = _now(now)
    provider = get_child_identity_provider()
    with transaction.atomic():
        child = _owned_child(parent, child_id, lock=True)
        if not child.active:
            raise ProfileUnavailable
        if not has_sign_in_consent(child):
            raise ConsentRequired
        name = validate_login_name(login_name, nickname=child.nickname)
        validate_password(password, login_name=name, nickname=child.nickname)
        credential = _live_credential(child, lock=True)
        if credential is not None and credential.status != ChildCredentialStatus.PROVISIONING:
            raise AlreadyEnabled
        try:
            with transaction.atomic():
                if credential is None:
                    credential = ChildCredential.objects.create(
                        child=child,
                        login_name=name,
                        provider_username=new_provider_username(),
                        created_at=at,
                        status_changed_at=at,
                        tokens_valid_after=at,
                    )
                elif credential.login_name != name:
                    credential.login_name = name
                    credential.save(update_fields=["login_name"])
        except IntegrityError:
            raise LoginNameUnavailable from None
    try:
        subject = provider.create_user(credential.provider_username, name, password)
    except LoginNameTaken:
        ChildCredential.objects.filter(
            pk=credential.pk, status=ChildCredentialStatus.PROVISIONING
        ).delete()
        raise LoginNameUnavailable from None
    except PasswordRejected:
        raise PasswordInvalid from None
    except ChildIdentityError:
        raise IdentityServiceUnavailable from None
    with transaction.atomic():
        credential = ChildCredential.objects.select_for_update().get(pk=credential.pk)
        credential.issuer = provider.issuer()
        credential.subject = subject
        credential.status = ChildCredentialStatus.ACTIVE
        credential.status_changed_at = at
        credential.password_set_at = at
        credential.tokens_valid_after = at
        credential.save()
        _record(parent, child, ChildAccountAction.SIGN_IN_ENABLED, at)
    return credential


def _managed_credential(parent, child_id, *, lock=True):
    child = _owned_child(parent, child_id, lock=lock)
    credential = _live_credential(child, lock=lock)
    if credential is None or credential.status == ChildCredentialStatus.PROVISIONING:
        raise CredentialUnavailable
    return child, credential


@sensitive_variables("password")
def set_password(parent: ParentAccount, child_id, *, password, now=None) -> ChildCredential:
    """Parent-managed recovery: set a new password (recent parent sign-in required).

    The pool is changed first; only then does Django cut off every earlier session, remembered
    device and token. The old password is never read: Cognito cannot return one.
    """
    at = _now(now)
    provider = get_child_identity_provider()
    with transaction.atomic():
        child, credential = _managed_credential(parent, child_id)
        validate_password(password, login_name=credential.login_name, nickname=child.nickname)
        try:
            provider.set_password(credential.provider_username, password)
        except PasswordRejected:
            raise PasswordInvalid from None
        except ChildIdentityError:
            raise IdentityServiceUnavailable from None
        _cut_off(credential, at)
        credential.password_set_at = at
        credential.save(update_fields=["tokens_valid_after", "password_set_at"])
        _record(parent, child, ChildAccountAction.PASSWORD_SET, at)
    _best_effort(provider.sign_out_everywhere, credential.provider_username)
    return credential


def change_login_name(parent: ParentAccount, child_id, *, login_name, now=None) -> ChildCredential:
    """Change the username the child types. Identity (`sub`) and progress are unchanged."""
    at = _now(now)
    provider = get_child_identity_provider()
    with transaction.atomic():
        child, credential = _managed_credential(parent, child_id)
        name = validate_login_name(login_name, nickname=child.nickname)
        if name == credential.login_name:
            return credential
        try:
            with transaction.atomic():
                credential.login_name = name
                credential.save(update_fields=["login_name"])
        except IntegrityError:
            raise LoginNameUnavailable from None
        try:
            provider.set_login_name(credential.provider_username, name)
        except LoginNameTaken:
            raise LoginNameUnavailable from None  # rolls the Django change back
        except ChildIdentityError:
            raise IdentityServiceUnavailable from None
        _record(parent, child, ChildAccountAction.LOGIN_NAME_CHANGED, at)
    return credential


@dataclass(frozen=True)
class ProtectiveResult:
    credential: ChildCredential | None
    # False when Django's change is in force but the pool follow-up (disable, sign-out) failed.
    provider_synced: bool


def suspend_sign_in(parent: ParentAccount, child_id, *, now=None) -> ProtectiveResult:
    """Pause the child's sign-in. Effective in Django at once; the pool follows, best effort."""
    at = _now(now)
    with transaction.atomic():
        child, credential = _managed_credential(parent, child_id)
        if credential.status != ChildCredentialStatus.ACTIVE:
            raise CredentialUnavailable
        credential.status = ChildCredentialStatus.SUSPENDED
        credential.status_changed_at = at
        _cut_off(credential, at)
        credential.save(update_fields=["status", "status_changed_at", "tokens_valid_after"])
        _record(parent, child, ChildAccountAction.SUSPENDED, at)
    provider = get_child_identity_provider()
    synced = _best_effort(provider.disable_user, credential.provider_username)
    synced = _best_effort(provider.sign_out_everywhere, credential.provider_username) and synced
    return ProtectiveResult(credential, synced)


def resume_sign_in(parent: ParentAccount, child_id, *, now=None) -> ChildCredential:
    """Re-enable a paused sign-in (recent parent sign-in required). Old tokens stay refused."""
    at = _now(now)
    provider = get_child_identity_provider()
    with transaction.atomic():
        child, credential = _managed_credential(parent, child_id)
        if credential.status != ChildCredentialStatus.SUSPENDED:
            raise CredentialUnavailable
        if not has_sign_in_consent(child):
            raise ConsentRequired
        try:
            provider.enable_user(credential.provider_username)
        except ChildIdentityError:
            raise IdentityServiceUnavailable from None
        credential.status = ChildCredentialStatus.ACTIVE
        credential.status_changed_at = at
        credential.tokens_valid_after = at
        credential.save(update_fields=["status", "status_changed_at", "tokens_valid_after"])
        _record(parent, child, ChildAccountAction.RESUMED, at)
    return credential


def remove_sign_in(parent: ParentAccount, child_id, *, now=None) -> ProtectiveResult:
    """Remove the child's own sign-in (recent parent sign-in required).

    The profile and all progress stay. The credential becomes a tombstone (login name cleared,
    so it can be reused; identity kept, so the `sub` never maps to a child again), and the pool
    user is deleted. If the pool cannot be reached, Django's refusal still holds and
    `provider_cleanup_pending` lets a retry (or the child's deletion) finish the job.
    """
    at = _now(now)
    with transaction.atomic():
        child = _owned_child(parent, child_id, lock=True)
        credential = _live_credential(child, lock=True)
        if credential is not None:
            _cut_off(credential, at)
            credential.status = ChildCredentialStatus.REVOKED
            credential.status_changed_at = at
            credential.login_name = ""
            credential.provider_cleanup_pending = True
            credential.save()
            _record(parent, child, ChildAccountAction.REVOKED, at)
    pending = finish_provider_cleanup(child)
    if credential is None and pending is None:
        # Nothing was live and nothing was left to clean up.
        raise CredentialUnavailable
    return ProtectiveResult(credential, pending is not None and pending == 0)


def finish_provider_cleanup(child: ChildProfile) -> int | None:
    """Delete pool users of revoked credentials still pending. Returns how many remain pending,
    or None when there was nothing to do."""
    pending = list(
        ChildCredential.objects.filter(
            child=child, status=ChildCredentialStatus.REVOKED, provider_cleanup_pending=True
        )
    )
    if not pending:
        return None
    provider = get_child_identity_provider()
    remaining = 0
    for credential in pending:
        if _best_effort(provider.delete_user, credential.provider_username):
            ChildCredential.objects.filter(pk=credential.pk).update(provider_cleanup_pending=False)
        else:
            remaining += 1
    return remaining


def sign_out_everywhere(parent: ParentAccount, child_id, *, now=None) -> ProtectiveResult:
    """End every session and remembered device the child has, on every device."""
    at = _now(now)
    with transaction.atomic():
        child, credential = _managed_credential(parent, child_id)
        _cut_off(credential, at)
        credential.save(update_fields=["tokens_valid_after"])
        _record(parent, child, ChildAccountAction.SESSIONS_REVOKED, at)
    synced = _best_effort(
        get_child_identity_provider().sign_out_everywhere, credential.provider_username
    )
    return ProtectiveResult(credential, synced)


def list_devices(parent: ParentAccount, child_id, *, now=None) -> list[ChildDevice]:
    at = _now(now)
    child = _owned_child(parent, child_id)
    return list(
        ChildDevice.objects.filter(
            child=child, revoked_at__isnull=True, expires_at__gt=at
        ).order_by("-last_used_at")
    )


def revoke_device(parent: ParentAccount, child_id, device_id, *, now=None) -> None:
    """Forget one remembered device of this child, and end the sessions it opened."""
    at = _now(now)
    with transaction.atomic():
        child = _owned_child(parent, child_id)
        try:
            device = ChildDevice.objects.select_for_update().get(
                child=child, pk=device_id, revoked_at__isnull=True
            )
        except (ChildDevice.DoesNotExist, ValueError, TypeError):
            raise CredentialUnavailable from None
        device.revoked_at = at
        device.save(update_fields=["revoked_at"])
        ChildPlaySession.objects.filter(device=device, revoked_at__isnull=True).update(
            revoked_at=at
        )
        _record(parent, child, ChildAccountAction.DEVICE_REVOKED, at)


def account_overview(parent: ParentAccount, child_id, *, now=None) -> dict:
    """What the parent dashboard shows. Never a password, token or device detail."""
    at = _now(now)
    child = _owned_child(parent, child_id)
    credential = _live_credential(child)
    consent = has_sign_in_consent(child)
    overview = {
        "consent": {
            "given": consent,
            "available": bool(approved_consent_version()),
        },
        "sign_in": None,
    }
    if credential is not None:
        overview["sign_in"] = {
            "status": credential.status,
            "username": credential.login_name,
            "created_at": credential.created_at,
            "password_set_at": credential.password_set_at,
            "active_sessions": ChildPlaySession.objects.filter(
                credential=credential, revoked_at__isnull=True, expires_at__gt=at
            ).count(),
            "remembered_devices": ChildDevice.objects.filter(
                credential=credential, revoked_at__isnull=True, expires_at__gt=at
            ).count(),
        }
    overview["recent_changes"] = [
        {"action": event.action, "occurred_at": event.occurred_at}
        for event in ChildAccountEvent.objects.filter(child=child).order_by("-occurred_at")[:10]
    ]
    return overview


# --- child sessions ------------------------------------------------------------------------------


def _new_device(credential: ChildCredential, at) -> tuple[str, ChildDevice]:
    value = secrets.token_urlsafe(32)
    device = ChildDevice.objects.create(
        child=credential.child,
        credential=credential,
        token_hash=_digest(value),
        created_at=at,
        last_used_at=at,
        expires_at=at + timedelta(seconds=settings.LAI_CHILD_DEVICE_REMEMBER_SECONDS),
    )
    return value, device


def _new_session(credential: ChildCredential, at, device=None) -> tuple[str, ChildPlaySession]:
    value = secrets.token_urlsafe(32)
    session = ChildPlaySession.objects.create(
        child=credential.child,
        credential=credential,
        device=device,
        token_hash=_digest(value),
        created_at=at,
        last_seen_at=at,
        expires_at=at + timedelta(seconds=settings.LAI_CHILD_SESSION_MAX_SECONDS),
    )
    return value, session


def _refuse_unless_usable(credential: ChildCredential | None, since, at) -> ChildCredential:
    """The checks every sign-in path and every request repeat. Raises SignInRefused."""
    if credential is None:
        raise SignInRefused("unknown_identity")
    if credential.status != ChildCredentialStatus.ACTIVE:
        raise SignInRefused("not_active")
    if since < credential.tokens_valid_after.replace(microsecond=0):
        raise SignInRefused("cut_off")
    child = credential.child
    if not child.active or not child.parent.is_active:
        raise SignInRefused("profile_inactive")
    if not has_sign_in_consent(child):
        raise SignInRefused("consent_required")
    return credential


def _end_browser_state(session_value, device_value, at) -> None:
    """Whatever this browser held before (any child's) ends: no fixation, no silent switch."""
    if _usable_value(session_value):
        ChildPlaySession.objects.filter(
            token_hash=_digest(session_value), revoked_at__isnull=True
        ).update(revoked_at=at)
    if _usable_value(device_value):
        device = ChildDevice.objects.filter(
            token_hash=_digest(device_value), revoked_at__isnull=True
        ).first()
        if device is not None:
            ChildDevice.objects.filter(pk=device.pk).update(revoked_at=at)
            ChildPlaySession.objects.filter(device=device, revoked_at__isnull=True).update(
                revoked_at=at
            )


@dataclass(frozen=True)
class SignInResult:
    session_value: str
    session: ChildPlaySession
    # Set only when the child chose "remember me"; otherwise the device cookie is cleared.
    device_value: str | None


@sensitive_variables("session_value", "device_value")
def sign_in_with_token(
    issuer: str,
    verified: VerifiedToken,
    *,
    remember: bool,
    session_value=None,
    device_value=None,
    now=None,
) -> SignInResult:
    """Exchange a verified child-pool access token for a child session.

    Accepted only right after the child signed in (`auth_time` at most
    `LAI_CHILD_SIGN_IN_MAX_AGE_SECONDS` old), so a copied or long-lived token cannot be replayed
    into a fresh session. The browser discards its Cognito tokens after this call.
    """
    at = _now(now)
    credential = None
    if issuer and verified.sub:
        credential = (
            ChildCredential.objects.select_related("child", "child__parent")
            .filter(issuer=issuer, subject=verified.sub)
            .first()
        )
    if credential is not None and verified.username != credential.provider_username:
        credential = None
    auth_time, issued_at = verified.auth_time, verified.issued_at
    if auth_time is None or issued_at is None:
        raise SignInRefused("missing_claim")
    now_ts = int(at.timestamp())
    if auth_time > now_ts + LEEWAY_SECONDS or now_ts - auth_time > (
        settings.LAI_CHILD_SIGN_IN_MAX_AGE_SECONDS
    ):
        raise SignInRefused("stale_sign_in")
    # The sign-in itself must come after the revocation line (a reset, suspension, resume).
    # Token times are whole seconds, so a sign-in in the same second as the line is refused
    # (the child simply signs in again) rather than letting an older token through.
    if credential is not None and auth_time < math.ceil(credential.tokens_valid_after.timestamp()):
        raise SignInRefused("cut_off")
    _refuse_unless_usable(credential, datetime.fromtimestamp(auth_time, tz=UTC), at)
    with transaction.atomic():
        _end_browser_state(session_value, device_value, at)
        new_device_value, device = (None, None)
        if remember:
            new_device_value, device = _new_device(credential, at)
        new_session_value, session = _new_session(credential, at, device)
    return SignInResult(new_session_value, session, new_device_value)


@sensitive_variables("device_value", "session_value")
def sign_in_with_device(device_value, *, session_value=None, now=None) -> SignInResult:
    """Reopen a session from a remembered device ("remember me"). Every check runs again.

    The device value is rotated each time, so a copied cookie and the real one cannot both keep
    working: whichever is used second is refused.
    """
    at = _now(now)
    if not _usable_value(device_value):
        raise SignInRefused("no_device")
    with transaction.atomic():
        device = (
            ChildDevice.objects.select_for_update()
            .select_related("credential", "credential__child", "credential__child__parent")
            .filter(token_hash=_digest(device_value), revoked_at__isnull=True, expires_at__gt=at)
            .first()
        )
        if device is None:
            raise SignInRefused("no_device")
        _refuse_unless_usable(device.credential, device.created_at, at)
        if _usable_value(session_value):
            ChildPlaySession.objects.filter(
                token_hash=_digest(session_value), revoked_at__isnull=True
            ).update(revoked_at=at)
        ChildPlaySession.objects.filter(device=device, revoked_at__isnull=True).update(
            revoked_at=at
        )
        rotated = secrets.token_urlsafe(32)
        device.token_hash = _digest(rotated)
        device.last_used_at = at
        device.save(update_fields=["token_hash", "last_used_at"])
        new_session_value, session = _new_session(device.credential, at, device)
    return SignInResult(new_session_value, session, rotated)


def session_for_value(value, *, now=None) -> ChildPlaySession | None:
    """The live child session a cookie value names, or None. Re-checks everything, every time."""
    if not _usable_value(value):
        return None
    at = _now(now)
    session = (
        ChildPlaySession.objects.select_related(
            "child", "child__parent", "credential", "credential__child", "device"
        )
        .filter(token_hash=_digest(value), revoked_at__isnull=True, expires_at__gt=at)
        .first()
    )
    if session is None:
        return None
    if at - session.last_seen_at >= timedelta(seconds=settings.LAI_CHILD_SESSION_IDLE_SECONDS):
        return None
    if session.credential.child_id != session.child_id:  # defence in depth
        return None
    if session.device is not None and (
        session.device.revoked_at is not None or session.device.expires_at <= at
    ):
        return None
    try:
        _refuse_unless_usable(session.credential, session.created_at, at)
    except SignInRefused:
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


@sensitive_variables("session_value", "device_value")
def sign_out(session_value=None, device_value=None, *, now=None) -> None:
    """The child signs out: this browser's session ends and its remembered device is forgotten."""
    with transaction.atomic():
        _end_browser_state(session_value, device_value, _now(now))
