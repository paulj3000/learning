import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from django.db import connection
from django.test import Client

from apps.users.authentication import verify_access_token
from apps.users.models import ParentAccount

from .helpers import CLIENT_ID, ISSUER, KeyPair, access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"


@pytest.fixture
def key(cognito_key):
    return cognito_key


@pytest.fixture
def network(cognito_network):
    return cognito_network


@pytest.fixture(autouse=True)
def _configured(cognito):
    return cognito


def call(token=None, *, method="get", path=ME, scheme="Bearer", **extra):
    headers = {"HTTP_AUTHORIZATION": f"{scheme} {token}"} if token is not None else {}
    return getattr(Client(raise_request_exception=False), method)(path, **headers, **extra)


def error_of(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    return body


# --- onboarding (A2) -----------------------------------------------------------------


def test_get_me_never_creates_an_account(key):
    response = call(key.sign(access_claims()))
    error_of(response, 403, "account_not_provisioned")
    assert ParentAccount.objects.count() == 0


def test_post_me_provisions_once_and_is_idempotent(key):
    token = key.sign(access_claims())
    first = call(token, method="post")
    assert first.status_code == 201
    second = call(token, method="post")
    assert second.status_code == 200
    assert first.json() == second.json() and set(first.json()) == {"id"}
    account = ParentAccount.objects.get()
    assert account.cognito_sub == "sub-parent-a" and str(account.pk) == first.json()["id"]
    assert call(token).json() == {"id": str(account.pk)}


def test_provisioning_creates_no_children_and_no_privileges(key):
    call(key.sign(access_claims(**{"cognito:groups": ["Admins"]})), method="post")
    account = ParentAccount.objects.get()
    assert account.child_profiles.count() == 0
    assert not account.is_staff and account.is_active


def test_each_sub_gets_its_own_account(key):
    call(key.sign(access_claims("sub-a")), method="post")
    call(key.sign(access_claims("sub-b")), method="post")
    a = call(key.sign(access_claims("sub-a"))).json()["id"]
    b = call(key.sign(access_claims("sub-b"))).json()["id"]
    assert a != b and ParentAccount.objects.count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_requests_create_exactly_one_account(key):
    token = key.sign(access_claims("sub-race"))
    barrier = threading.Barrier(8)

    def request():
        barrier.wait()
        try:
            return call(token, method="post").status_code
        finally:
            connection.close()

    with ThreadPoolExecutor(8) as pool:
        statuses = list(pool.map(lambda _: request(), range(8)))
    assert sorted(set(statuses)) <= [200, 201]
    assert statuses.count(201) == 1
    assert ParentAccount.objects.filter(cognito_sub="sub-race").count() == 1


def test_inactive_account_is_denied(key):
    ParentAccount.objects.create(cognito_sub="sub-parent-a", is_active=False)
    error_of(call(key.sign(access_claims())), 403, "permission_denied")


def test_me_rejects_other_methods(key):
    token = key.sign(access_claims())
    call(token, method="post")  # provision first: permissions are checked before the method
    assert call(token, method="put").status_code == 405
    assert call(token, method="delete").status_code == 405


# --- missing and invalid credentials -------------------------------------------------


@pytest.mark.parametrize("scheme_header", [None, "Basic dXNlcjpwdw==", "Token abc", ""])
def test_missing_or_other_scheme_is_not_authenticated(scheme_header):
    client = Client(raise_request_exception=False)
    extra = {"HTTP_AUTHORIZATION": scheme_header} if scheme_header is not None else {}
    response = client.get(ME, **extra)
    error_of(response, 401, "not_authenticated")
    assert response["WWW-Authenticate"] == "Bearer"


def test_token_in_the_query_string_is_ignored(key):
    token = key.sign(access_claims())
    error_of(call(path=f"{ME}?access_token={token}"), 401, "not_authenticated")


def good_token(key, **overrides):
    return key.sign(access_claims(**overrides))


def bad_tokens(key):
    other = KeyPair("kid-1")  # same kid, different key
    now = int(time.time())
    return {
        "expired": good_token(key, exp=now - 100),
        "not_yet_valid": good_token(key, nbf=now + 100),
        "wrong_issuer": good_token(key, iss=ISSUER + "x"),
        "other_pool": good_token(key, iss=ISSUER.replace("TESTPOOL1", "OTHERPOOL")),
        "wrong_client": good_token(key, client_id="another-client"),
        "id_token": good_token(key, token_use="id", aud=CLIENT_ID),
        "no_token_use": good_token(key, token_use=None),
        "no_sub": good_token(key, sub=None),
        "blank_sub": good_token(key, sub="  "),
        "no_client_id": good_token(key, client_id=None),
        "no_exp": good_token(key, exp=None),
        "bad_signature": other.sign(access_claims()),
        "unknown_kid": key.sign(access_claims(), kid="not-in-jwks"),
        "no_kid": key.sign(access_claims(), kid=None),
        "garbage": "not.a.jwt",
        "empty_parts": "..",
        "too_long": "a" * 5000,
    }


def test_every_kind_of_invalid_token_gets_the_same_401(key):
    bodies = {}
    for name, token in bad_tokens(key).items():
        response = call(token)
        body = error_of(response, 401, "authentication_failed")
        assert response["WWW-Authenticate"] == "Bearer", name
        body.pop("request_id")
        bodies[name] = body
    assert len({str(b) for b in bodies.values()}) == 1  # nothing reveals why


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_algorithm_confusion_and_none_are_rejected(key):
    public_pem = key.private.public_key().public_bytes(
        Encoding.PEM, PublicFormat.SubjectPublicKeyInfo
    )
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT", "kid": key.kid}).encode())
    payload = _b64(json.dumps(access_claims()).encode())
    signature = hmac.new(public_pem, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    hs256 = f"{header}.{payload}.{_b64(signature)}"  # the public key used as an HMAC secret
    none_header = _b64(json.dumps({"alg": "none", "typ": "JWT", "kid": key.kid}).encode())
    unsigned = f"{none_header}.{payload}."
    for token in (hs256, unsigned):
        error_of(call(token), 401, "authentication_failed")


def test_malformed_authorization_headers_are_rejected(key):
    token = key.sign(access_claims())
    error_of(call("", scheme="Bearer"), 401, "authentication_failed")
    error_of(call(f"{token} extra"), 401, "authentication_failed")
    error_of(call("café"), 401, "authentication_failed")


def test_clock_leeway_is_thirty_seconds(key):
    now = int(time.time())
    assert verify_access_token(good_token(key, exp=now - 10)).sub == "sub-parent-a"
    assert verify_access_token(good_token(key, nbf=now + 10)).sub == "sub-parent-a"
    error_of(call(good_token(key, exp=now - 40)), 401, "authentication_failed")
    error_of(call(good_token(key, nbf=now + 40)), 401, "authentication_failed")


def test_fails_closed_when_cognito_is_not_configured(key, settings):
    settings.COGNITO_ALLOWED_CLIENT_IDS = []
    error_of(call(key.sign(access_claims())), 401, "authentication_failed")
    settings.COGNITO_ALLOWED_CLIENT_IDS = [CLIENT_ID]
    settings.COGNITO_USER_POOL_ID = ""
    error_of(call(key.sign(access_claims())), 401, "authentication_failed")


def test_jwks_outage_is_503_fails_closed_and_is_not_hammered(key, network):
    network.error = TimeoutError("down")
    token = key.sign(access_claims())
    first = call(token)
    error_of(first, 503, "authentication_unavailable")
    for _ in range(5):
        error_of(call(token), 503, "authentication_unavailable")
    assert network.calls == 1
    assert ParentAccount.objects.count() == 0


def test_a_token_from_another_key_set_never_authenticates(key):
    rogue = KeyPair("kid-1")
    error_of(call(rogue.sign(access_claims())), 401, "authentication_failed")


# --- claims and verified data --------------------------------------------------------


def test_verified_claims_carry_groups_but_grant_nothing(key):
    verified = verify_access_token(good_token(key, **{"cognito:groups": ["Admins", 5]}))
    assert verified.groups == ("Admins",) and verified.client_id == CLIENT_ID
    assert verify_access_token(good_token(key, **{"cognito:groups": "Admins"})).groups == ()
    token = good_token(key, **{"cognito:groups": ["Admins"]})
    error_of(call(token), 403, "account_not_provisioned")  # a group does not skip onboarding
    assert not any("token" in f for f in verified.__dataclass_fields__)


# --- logging and privacy -------------------------------------------------------------


def test_logs_hold_reason_codes_only(key, caplog):
    secret_token = bad_tokens(key)["expired"]
    with caplog.at_level(logging.DEBUG):
        call(secret_token)
        call(key.sign(access_claims("sub-secret-9", **{"cognito:groups": ["Admins"]})))
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "authentication rejected: expired" in text
    for fragment in (secret_token, secret_token[:20], secret_token.split(".")[1][:15]):
        assert fragment not in text
    assert "sub-secret-9" not in text and "Admins" not in text


def test_jwks_failure_log_does_not_include_the_response(key, network, caplog):
    network.body = b'{"keys": [], "secret": "response-body-secret"}'
    with caplog.at_level(logging.DEBUG):
        call(key.sign(access_claims()))
    assert "response-body-secret" not in " ".join(r.getMessage() for r in caplog.records)


# --- the rest of the API is unchanged ------------------------------------------------


def test_health_stays_public_even_with_a_bad_authorization_header():
    assert Client().get("/api/v1/health/", HTTP_AUTHORIZATION="Bearer garbage").status_code == 200


def test_default_permission_denies_unauthenticated_and_names_the_scheme(settings):
    assert settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] == [
        "apps.users.permissions.IsProvisionedParent"
    ]
    assert settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == [
        "apps.users.authentication.CognitoJWTAuthentication"
    ]


def test_no_sensitive_endpoints_exist_yet():
    from config import urls

    assert sorted(str(p.pattern) for p in urls.urlpatterns[0].url_patterns) == ["health/"]
    assert sorted(str(p.pattern) for p in urls.urlpatterns[1].url_patterns) == ["me/"]


def test_sensitive_actions_stay_blocked_even_for_a_valid_provisioned_parent(key, settings):
    settings.ROOT_URLCONF = "apps.core.tests.urls"
    token = key.sign(access_claims())
    call(token, method="post")  # provision
    response = call(token, method="post", path="/api/v1/example/sensitive/")
    error_of(response, 403, "sensitive_action_unavailable")
    assert response.json()["error"]["message"] == "This action is not available."


def test_a_tampered_payload_fails_the_signature_check(key):
    header, _payload, signature = key.sign(access_claims("sub-victim")).split(".")
    forged_payload = _b64(json.dumps(access_claims("sub-attacker")).encode())
    error_of(call(f"{header}.{forged_payload}.{signature}"), 401, "authentication_failed")
