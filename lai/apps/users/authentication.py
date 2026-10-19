"""Cognito access-token authentication for DRF (LAI-0402, ADR-024).

Accepts only `Authorization: Bearer <access token>`. Every failure to verify a presented token
raises the same fixed `AuthenticationFailed` (401, `WWW-Authenticate: Bearer`); the cause goes to
the log as a coarse reason code only, never the token and never claims. A missing header, or a
different scheme, authenticates nobody and is left to the permission layer (which answers 401
`not_authenticated` for the default permission). Verified claims are the only thing trusted.
"""

import logging
from dataclasses import dataclass
from functools import lru_cache

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import APIException, AuthenticationFailed

from .jwks import JwksCache, JwksUnavailable, UnknownSigningKey
from .models import ParentAccount

logger = logging.getLogger("lai.auth")

ALGORITHM = "RS256"
LEEWAY_SECONDS = 30
MAX_TOKEN_LENGTH = 4096
REQUIRED_CLAIMS = ["exp", "iss", "sub", "token_use", "client_id"]


class AuthenticationUnavailable(APIException):
    """The signing keys cannot be obtained. Fails closed, but is not the caller's fault."""

    status_code = 503
    default_code = "authentication_unavailable"
    default_detail = "Authentication is temporarily unavailable."


@dataclass(frozen=True)
class VerifiedToken:
    """The claims we use, taken only from a fully verified token. Never contains the raw token."""

    sub: str
    client_id: str
    groups: tuple[str, ...]
    expires_at: int
    auth_time: int | None


@dataclass(frozen=True)
class UnprovisionedParent:
    """A verified Cognito user with no `ParentAccount` yet (ADR-024 A2). Not a database row."""

    cognito_sub: str
    is_authenticated: bool = True
    is_anonymous: bool = False
    is_active: bool = True

    def __str__(self) -> str:
        return "unprovisioned-parent"


def _cognito_settings() -> tuple[str, str, frozenset[str]] | None:
    region = settings.COGNITO_REGION
    pool_id = settings.COGNITO_USER_POOL_ID
    clients = frozenset(settings.COGNITO_ALLOWED_CLIENT_IDS)
    if not (region and pool_id and clients):
        return None
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}", pool_id, clients


@lru_cache(maxsize=4)
def _cache_for(issuer: str) -> JwksCache:
    return JwksCache(f"{issuer}/.well-known/jwks.json")


def get_jwks_cache(issuer: str) -> JwksCache:
    """One shared cache per issuer (so the refresh cooldown holds across requests)."""
    return _cache_for(issuer)


def verify_access_token(token: str) -> VerifiedToken:
    """Verify a Cognito access token; raises AuthenticationFailed or AuthenticationUnavailable."""
    configured = _cognito_settings()
    if configured is None:
        raise _reject("not_configured")
    issuer, _pool, allowed_clients = configured
    if not token or len(token) > MAX_TOKEN_LENGTH:
        raise _reject("malformed")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _reject("malformed") from None
    kid = header.get("kid")
    if header.get("alg") != ALGORITHM:
        raise _reject("bad_algorithm")
    if not isinstance(kid, str) or not kid:
        raise _reject("malformed")
    try:
        key = get_jwks_cache(issuer).get_key(kid)
    except UnknownSigningKey:
        raise _reject("unknown_key") from None
    except JwksUnavailable:
        logger.warning("authentication unavailable: signing keys not obtainable")
        raise AuthenticationUnavailable from None
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[ALGORITHM],
            issuer=issuer,
            leeway=LEEWAY_SECONDS,
            options={"require": REQUIRED_CLAIMS, "verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise _reject("expired") from None
    except jwt.ImmatureSignatureError:
        raise _reject("not_yet_valid") from None
    except jwt.InvalidIssuerError:
        raise _reject("bad_issuer") from None
    except jwt.MissingRequiredClaimError:
        raise _reject("missing_claim") from None
    except jwt.InvalidSignatureError:
        raise _reject("bad_signature") from None
    except jwt.PyJWTError:
        raise _reject("malformed") from None
    if claims.get("token_use") != "access":
        raise _reject("bad_token_use")
    client_id = claims.get("client_id")
    if not isinstance(client_id, str) or client_id not in allowed_clients:
        raise _reject("bad_client")
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise _reject("missing_claim")
    groups = claims.get("cognito:groups")
    auth_time = claims.get("auth_time")
    return VerifiedToken(
        sub=sub,
        client_id=client_id,
        groups=tuple(g for g in groups if isinstance(g, str)) if isinstance(groups, list) else (),
        expires_at=int(claims["exp"]),
        auth_time=auth_time if isinstance(auth_time, int) else None,
    )


def _reject(reason: str) -> AuthenticationFailed:
    logger.info("authentication rejected: %s", reason)  # reason code only
    return AuthenticationFailed()


class CognitoJWTAuthentication(BaseAuthentication):
    keyword = "bearer"

    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != self.keyword.encode():
            return None
        if len(parts) != 2:
            raise _reject("malformed")
        try:
            token = parts[1].decode("ascii")
        except UnicodeDecodeError:
            raise _reject("malformed") from None
        verified = verify_access_token(token)
        account = ParentAccount.objects.filter(cognito_sub=verified.sub).first()
        return (account or UnprovisionedParent(cognito_sub=verified.sub)), verified
