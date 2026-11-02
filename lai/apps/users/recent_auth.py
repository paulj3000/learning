"""Recent sign-in verification for sensitive actions (LAI-0209, ADR-024 A3, ADR-043).

A valid Cognito access token is enough for ordinary requests. It is not enough for a sensitive
action (deleting a child, an asset administrator's change, and future account or consent
changes). Those also need proof, checked here in Django and never in the browser, that:

1. **The parent signed in recently.** The evidence is the verified access token's `auth_time`,
   which Cognito signs and defines as the time the user completed authentication. It must be
   at most `LAI_RECENT_AUTH_MAX_AGE_SECONDS` old (default 300). Clock skew is handled
   conservatively: a future `auth_time` is accepted only within the authentication leeway and
   counts as "now"; the window itself is never widened. `iat` before `auth_time` is
   inconsistent and refused. Nothing the client sends (a header, a body field) is read.
2. **A refresh did not reset it.** The token must carry `origin_jti` (Cognito's identifier for
   the sign-in session behind the refresh token). The first `auth_time` Django sees for a
   session is recorded (`AuthSessionAnchor`); a later token from the same session with a
   different `auth_time` is refused. So a silent refresh can never count as a new sign-in,
   whatever the identity provider does with `auth_time` on refresh. Whether Cognito keeps
   `auth_time` unchanged on refresh is verified live (the LAI-0209 Cognito acceptance gate).
3. **The token is not revoked.** Local JWT verification cannot see a sign-out or a revoked
   refresh token, so Cognito's `GetUser` is called with the presented access token (an
   unsigned call; no AWS credentials). Cognito refuses a revoked token. The `sub` it returns
   must be the token's `sub`. If the check cannot run, the action is refused (fails closed).

Answers (docs/ARCHITECTURE.md, "Recent sign-in verification"):

- `403 recent_auth_required`: signed in, but not recently enough, or the evidence is missing,
  malformed or inconsistent. Deliberately not 401, so clients do not answer it with a token
  refresh (which could never help) and do not sign the parent out.
- `401 authentication_failed`: Cognito says the token is revoked, or names another identity.
- `503 recent_auth_unavailable`: the revocation check could not run. Never a sign-out.

Logs carry a coarse reason code only: never the token, claims, `sub`, or `origin_jti`.
"""

import hashlib
import logging
import time
from datetime import timedelta
from functools import lru_cache

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.views.decorators.debug import sensitive_variables
from rest_framework.authentication import get_authorization_header
from rest_framework.exceptions import APIException, AuthenticationFailed, PermissionDenied

from .authentication import LEEWAY_SECONDS, VerifiedToken
from .models import AuthSessionAnchor, ParentAccount

logger = logging.getLogger("lai.auth")

# The scope Cognito requires on an access token for `GetUser`. Tokens from Cognito API sign-in
# (Amplify SRP) always carry it; hosted-UI tokens carry it only if the client requests it.
SELF_SERVICE_SCOPE = "aws.cognito.signin.user.admin"

# Anchors older than this are pruned. Longer than the default refresh-token lifetime (30 days).
ANCHOR_RETENTION = timedelta(days=35)

GET_USER_CONNECT_TIMEOUT = 3
GET_USER_READ_TIMEOUT = 5


class RecentAuthRequired(PermissionDenied):
    default_code = "recent_auth_required"
    default_detail = "Please confirm your sign-in to continue."


class RecentAuthUnavailable(APIException):
    status_code = 503
    default_code = "recent_auth_unavailable"
    default_detail = "Sign-in confirmation is temporarily unavailable."


# --- revocation check (Cognito GetUser) --------------------------------------------------------


class TokenRevoked(Exception):
    """Cognito no longer accepts the access token (signed out, or refresh token revoked)."""


class RevocationCheckUnavailable(Exception):
    """The check could not run: network, throttling, a Cognito fault, or a missing scope."""


class CognitoRevocationCheck:
    """Calls Cognito `GetUser` with the presented access token and returns the user's `sub`."""

    @sensitive_variables("access_token")
    def __call__(self, access_token: str) -> str:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            response = _cognito_client(settings.COGNITO_REGION).get_user(AccessToken=access_token)
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            message = str(error.response.get("Error", {}).get("Message", ""))
            if code == "NotAuthorizedException" and "scope" not in message.lower():
                raise TokenRevoked from None
            if code in {"UserNotFoundException", "PasswordResetRequiredException"}:
                raise TokenRevoked from None
            raise RevocationCheckUnavailable(code or "client_error") from None
        except BotoCoreError:
            raise RevocationCheckUnavailable("network") from None
        for attribute in response.get("UserAttributes", []):
            if attribute.get("Name") == "sub" and isinstance(attribute.get("Value"), str):
                return attribute["Value"]
        raise RevocationCheckUnavailable("no_sub")


@lru_cache(maxsize=4)
def _cognito_client(region: str):
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    # GetUser is authorized by the access token alone; it is never signed with AWS credentials.
    return boto3.client(
        "cognito-idp",
        region_name=region,
        config=Config(
            signature_version=UNSIGNED,
            connect_timeout=GET_USER_CONNECT_TIMEOUT,
            read_timeout=GET_USER_READ_TIMEOUT,
            retries={"max_attempts": 1, "mode": "standard"},
        ),
    )


_default_check = CognitoRevocationCheck()


def get_revocation_check():
    """The revocation check in use. Tests replace this function; production never does."""
    return _default_check


# --- the guard ----------------------------------------------------------------------------------


def max_age_seconds() -> int:
    return int(settings.LAI_RECENT_AUTH_MAX_AGE_SECONDS)


@sensitive_variables("token")
def require_recent_authentication(request) -> None:
    """Raise unless the request's verified token shows a recent, unrevoked sign-in.

    Call it only after the request is authenticated and authorized for the action, so that a
    caller who may not do the action learns nothing more by being asked to sign in again.
    """
    verified = request.auth
    account = request.user
    if not isinstance(verified, VerifiedToken) or not isinstance(account, ParentAccount):
        raise _required("not_cognito")
    now = int(time.time())
    auth_time, issued_at = verified.auth_time, verified.issued_at
    if auth_time is None or issued_at is None or not verified.origin_jti:
        raise _required("missing_evidence")
    if auth_time > now + LEEWAY_SECONDS:
        raise _required("future_auth_time")
    if issued_at < auth_time - LEEWAY_SECONDS:
        raise _required("inconsistent_evidence")
    if now - auth_time > max_age_seconds():
        raise _required("stale")
    if SELF_SERVICE_SCOPE not in verified.scopes:
        # GetUser would refuse the token, so the revocation check cannot run (fails closed).
        logger.warning("recent authentication unavailable: token lacks the self-service scope")
        raise RecentAuthUnavailable
    _check_session_anchor(account, verified.origin_jti, auth_time)

    token = _bearer_token(request)
    try:
        cognito_sub = get_revocation_check()(token)
    except TokenRevoked:
        logger.info("recent authentication rejected: revoked")
        raise AuthenticationFailed from None
    except RevocationCheckUnavailable as error:
        logger.warning("recent authentication unavailable: %s", _reason(error))
        raise RecentAuthUnavailable from None
    if cognito_sub != verified.sub or cognito_sub != account.cognito_sub:
        logger.warning("recent authentication rejected: identity_mismatch")
        raise AuthenticationFailed
    logger.info("recent authentication accepted")


def record_session_anchor(account: ParentAccount, verified: VerifiedToken) -> None:
    """Remember a session's first `auth_time` (called after sign-in by `POST /api/v1/me/`).

    Best effort: a token without the evidence is simply not anchored, and nothing is raised.
    """
    if verified.origin_jti and verified.auth_time is not None:
        _anchor(account, verified.origin_jti, verified.auth_time)


def _check_session_anchor(account: ParentAccount, origin_jti: str, auth_time: int) -> None:
    anchored = _anchor(account, origin_jti, auth_time)
    if anchored != auth_time:
        raise _required("auth_time_changed_in_session")


def _anchor(account: ParentAccount, origin_jti: str, auth_time: int) -> int:
    """The anchored `auth_time` for this session, creating the anchor if it is new."""
    digest = hashlib.sha256(origin_jti.encode()).hexdigest()
    existing = AuthSessionAnchor.objects.filter(account=account, session_digest=digest).first()
    if existing is not None:
        return existing.auth_time
    try:
        with transaction.atomic():
            AuthSessionAnchor.objects.create(
                account=account, session_digest=digest, auth_time=auth_time
            )
    except IntegrityError:  # a concurrent request anchored it first
        return AuthSessionAnchor.objects.get(account=account, session_digest=digest).auth_time
    AuthSessionAnchor.objects.filter(
        account=account, first_seen_at__lt=timezone.now() - ANCHOR_RETENTION
    ).delete()
    return auth_time


@sensitive_variables()
def _bearer_token(request) -> str:
    parts = get_authorization_header(request).split()
    if len(parts) != 2:  # cannot happen after CognitoJWTAuthentication, but never guess
        raise _required("not_cognito")
    return parts[1].decode("ascii")


def _reason(error: RevocationCheckUnavailable) -> str:
    reason = str(error.args[0]) if error.args else "unknown"
    return reason if reason.replace("_", "").isalnum() else "unknown"


def _required(reason: str) -> RecentAuthRequired:
    logger.info("recent authentication required: %s", reason)  # reason code only
    return RecentAuthRequired()
