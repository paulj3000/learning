"""Fixtures for independent child sign-in (ADR-075). Local keys, a fake child pool, no AWS."""

import time
from types import SimpleNamespace

import pytest

CHILD_POOL_ID = "us-test-1_CHILDPOOL1"
CHILD_CLIENT_ID = "test-child-client-0001"
CONSENT_VERSION = "test-consent-v1"
PASSWORD = "Sunny-Meadow-42"  # synthetic test value  # noqa: S105


@pytest.fixture
def child_pool(settings, monkeypatch, cognito):
    """A child pool beside the parent pool: its own issuer, client and signing key."""
    from django.core.cache import cache

    from apps.users import authentication, child_identity
    from apps.users.jwks import JwksCache
    from apps.users.tests.helpers import ISSUER, REGION, KeyPair, Network

    settings.COGNITO_CHILD_USER_POOL_ID = CHILD_POOL_ID
    settings.COGNITO_CHILD_ALLOWED_CLIENT_IDS = [CHILD_CLIENT_ID]
    settings.LAI_CHILD_IDENTITY_PROVIDER = "fake"
    settings.LAI_CHILD_SIGN_IN_CONSENT_VERSION = CONSENT_VERSION
    child_issuer = f"https://cognito-idp.{REGION}.amazonaws.com/{CHILD_POOL_ID}"
    key = KeyPair("kid-child-1")
    parent_cache = authentication.get_jwks_cache(ISSUER)
    child_cache = JwksCache(f"{child_issuer}/.well-known/jwks.json", fetcher=Network(key))
    monkeypatch.setattr(
        authentication,
        "get_jwks_cache",
        lambda issuer: child_cache if issuer == child_issuer else parent_cache,
    )
    cache.clear()  # throttle counters
    provider = child_identity.reset_fake_provider()

    def claims(credential, **overrides):
        now = int(time.time())
        values = {
            "sub": credential.subject,
            "iss": child_issuer,
            "client_id": CHILD_CLIENT_ID,
            "token_use": "access",
            "auth_time": now,
            "iat": now,
            "exp": now + 3600,
            "jti": "child-jti",
            "origin_jti": "child-origin",
            "username": credential.provider_username,
        }
        values.update(overrides)
        return {k: v for k, v in values.items() if v is not None}

    def token(credential, *, key_pair=None, **overrides):
        return (key_pair or key).sign(claims(credential, **overrides))

    yield SimpleNamespace(
        issuer=child_issuer, key=key, provider=provider, token=token, claims=claims
    )
    cache.clear()


@pytest.fixture
def provision(child_pool):
    """provision(parent, child, username=...) -> an ACTIVE credential (consent given first)."""
    from apps.users import child_auth

    def make(parent, child, username="zinnia01", password=PASSWORD):
        from datetime import timedelta

        from apps.users.models import ChildCredential

        child_auth.grant_sign_in_consent(parent, child.pk)
        credential = child_auth.enable_sign_in(
            parent, child.pk, login_name=username, password=password
        )
        # As if set up a few seconds ago, so a token "signed in now" is after its cut-off line.
        earlier = credential.tokens_valid_after - timedelta(seconds=5)
        ChildCredential.objects.filter(pk=credential.pk).update(tokens_valid_after=earlier)
        credential.refresh_from_db()
        return credential

    return make


@pytest.fixture
def child_client():
    """A browser for a child: cookies kept between calls, no parent token."""
    from django.test import Client

    def make():
        return Client(raise_request_exception=False)

    return make


@pytest.fixture
def sign_in(child_pool, child_client):
    """sign_in(credential, client=None, remember=False) -> (client, body)."""

    def run(credential, client=None, remember=False):
        client = client or child_client()
        response = client.post(
            "/api/v1/child-auth/session/",
            {"remember": remember},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential)}",
        )
        assert response.status_code == 201, response.content
        return client, response.json()

    return run
