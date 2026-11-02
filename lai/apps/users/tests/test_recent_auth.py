"""Recent sign-in verification (LAI-0209, ADR-043) and the child deletion route (LAI-0602).

Locally signed tokens and a fake Cognito `GetUser` (`cognito_revocation`); nothing contacts AWS.
These tests prove the guard's logic. They do not prove what Cognito puts in `auth_time` after a
refresh: that is the separate live Cognito acceptance gate (docs/platform/RECENT_SIGN_IN.md).
"""

import hashlib
import json
import logging
import time
import uuid

import pytest
from botocore import UNSIGNED
from botocore.stub import Stubber

from apps.users import deletion, photos, recent_auth
from apps.users.models import AuthSessionAnchor, ChildPhoto, ChildProfile, ParentAccount
from apps.users.photo_storage import (
    MemoryPhotoStorage,
    get_photo_storage,
    reset_photo_storage_cache,
)

from .test_child_photos import EXIF_JPEG

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CHILDREN = "/api/v1/children/"
ME = "/api/v1/me/"


def detail(child_or_id) -> str:
    return f"{CHILDREN}{getattr(child_or_id, 'pk', child_or_id)}/"


def code(response) -> str:
    return response.json()["error"]["code"]


def now() -> int:
    return int(time.time())


@pytest.fixture
def signed_in(api, token_for):
    """signed_in(parent, **claims) -> a client whose token has those claim overrides."""

    def make(parent, **claims):
        return api(token=token_for(parent.cognito_sub, **claims))

    return make


@pytest.fixture(autouse=True)
def fresh_photo_store():
    reset_photo_storage_cache()
    yield
    reset_photo_storage_cache()


# --- accepted -----------------------------------------------------------------------------------


def test_a_recent_sign_in_deletes_the_parents_own_child(families, signed_in, cognito_revocation):
    response = signed_in(families.a, auth_time=now() - 30, iat=now() - 30).delete(
        detail(families.a1)
    )
    assert response.status_code == 204 and response.content == b""
    assert not ChildProfile.objects.filter(pk=families.a1.pk).exists()
    assert ChildProfile.objects.count() == 3
    assert cognito_revocation.calls == 1  # revocation-aware: Cognito was asked


def test_the_window_is_configurable(families, signed_in, settings):
    settings.LAI_RECENT_AUTH_MAX_AGE_SECONDS = 120
    stale = signed_in(families.a, auth_time=now() - 150, iat=now() - 150)
    assert code(stale.delete(detail(families.a1))) == "recent_auth_required"
    fresh = signed_in(families.a, auth_time=now() - 90, iat=now() - 90)
    assert fresh.delete(detail(families.a1)).status_code == 204


def test_slight_clock_skew_in_the_future_is_tolerated(families, signed_in):
    response = signed_in(families.a, auth_time=now() + 10, iat=now() + 10).delete(
        detail(families.a1)
    )
    assert response.status_code == 204


# --- rejected: not recent, or no trustworthy evidence --------------------------------------------


def assert_recent_auth_required(response, families, cognito_revocation):
    assert response.status_code == 403, response.content
    assert code(response) == "recent_auth_required"
    assert response.json()["error"]["message"] == "Please confirm your sign-in to continue."
    assert "WWW-Authenticate" not in response  # not a 401: clients must not refresh and retry
    assert ChildProfile.objects.count() == 4
    assert cognito_revocation.calls == 0  # refused locally, before any network call


def test_a_stale_but_valid_session_cannot_delete_a_child(families, signed_in, cognito_revocation):
    client = signed_in(families.a, auth_time=now() - 301, iat=now() - 301)
    assert client.get(detail(families.a1)).status_code == 200  # the session itself is fine
    assert_recent_auth_required(client.delete(detail(families.a1)), families, cognito_revocation)


@pytest.mark.parametrize(
    "claims",
    [
        {"auth_time": None},
        {"iat": None},
        {"origin_jti": None},
        {"auth_time": "1700000000"},
        {"auth_time": 1.5e9},
        {"auth_time": True},
        {"origin_jti": ""},
    ],
    ids=["no-auth-time", "no-iat", "no-origin-jti", "text", "float", "bool", "blank-origin"],
)
def test_missing_or_malformed_evidence_is_refused(families, signed_in, cognito_revocation, claims):
    response = signed_in(families.a, **claims).delete(detail(families.a1))
    assert_recent_auth_required(response, families, cognito_revocation)


def test_an_auth_time_in_the_future_is_refused(families, signed_in, cognito_revocation):
    response = signed_in(families.a, auth_time=now() + 120, iat=now()).delete(detail(families.a1))
    assert_recent_auth_required(response, families, cognito_revocation)


def test_a_token_issued_before_its_authentication_is_refused(
    families, signed_in, cognito_revocation
):
    response = signed_in(families.a, auth_time=now() - 10, iat=now() - 200).delete(
        detail(families.a1)
    )
    assert_recent_auth_required(response, families, cognito_revocation)


def test_client_supplied_timestamps_are_never_read(families, signed_in, cognito_revocation):
    client = signed_in(families.a, auth_time=now() - 3600, iat=now() - 3600)
    response = client.generic(
        "DELETE",
        detail(families.a1),
        json.dumps({"auth_time": now(), "authTime": now(), "recent": True}),
        content_type="application/json",
        HTTP_X_AUTH_TIME=str(now()),
        HTTP_X_RECENT_AUTH="true",
    )
    assert_recent_auth_required(response, families, cognito_revocation)


# --- refresh never counts as a new sign-in -----------------------------------------------------


def test_a_refreshed_token_keeps_the_original_sign_in_time(families, signed_in, cognito_revocation):
    """A refresh issues a new token (new `iat`) for the same session and `auth_time`."""
    session, signed = str(uuid.uuid4()), now() - 900
    assert signed_in(families.a, origin_jti=session, auth_time=signed, iat=signed).post(ME)
    refreshed = signed_in(families.a, origin_jti=session, auth_time=signed, iat=now())
    assert_recent_auth_required(refreshed.delete(detail(families.a1)), families, cognito_revocation)


def test_a_refresh_that_moved_auth_time_is_refused(families, signed_in, cognito_revocation):
    """If a refreshed token ever claimed a newer `auth_time`, the session anchor catches it."""
    session = str(uuid.uuid4())
    sign_in = signed_in(families.a, origin_jti=session, auth_time=now() - 900, iat=now() - 900)
    assert sign_in.post(ME).status_code == 200  # the app's call after sign-in anchors it
    moved = signed_in(families.a, origin_jti=session, auth_time=now() - 5, iat=now() - 5)
    assert_recent_auth_required(moved.delete(detail(families.a1)), families, cognito_revocation)


def test_a_new_sign_in_is_a_new_session_and_is_accepted(families, signed_in):
    old = str(uuid.uuid4())
    signed_in(families.a, origin_jti=old, auth_time=now() - 900, iat=now() - 900).post(ME)
    again = signed_in(families.a, origin_jti=str(uuid.uuid4()), auth_time=now(), iat=now())
    assert again.delete(detail(families.a1)).status_code == 204


def test_a_refresh_inside_the_window_still_works(families, signed_in):
    session, signed = str(uuid.uuid4()), now() - 60
    signed_in(families.a, origin_jti=session, auth_time=signed, iat=signed).post(ME)
    refreshed = signed_in(families.a, origin_jti=session, auth_time=signed, iat=now())
    assert refreshed.delete(detail(families.a1)).status_code == 204


def test_the_anchor_stores_a_digest_and_no_token_data(families, signed_in):
    session = "origin-" + uuid.uuid4().hex
    signed_in(families.a, origin_jti=session, auth_time=now() - 5, iat=now() - 5).post(ME)
    anchor = AuthSessionAnchor.objects.get()
    assert anchor.account == families.a
    assert anchor.session_digest == hashlib.sha256(session.encode()).hexdigest()
    assert session not in anchor.session_digest
    signed_in(families.a, origin_jti=session, auth_time=now() - 5, iat=now()).post(ME)
    assert AuthSessionAnchor.objects.count() == 1  # one per session, idempotent


def test_anchors_go_with_the_account(families, signed_in):
    signed_in(families.b, auth_time=now(), iat=now()).post(ME)
    families.b1.delete()
    families.b2.delete()
    families.b.delete()
    assert AuthSessionAnchor.objects.count() == 0


# --- revocation-aware check (Cognito GetUser) --------------------------------------------------


def test_a_revoked_token_is_refused_as_unauthenticated(families, signed_in, cognito_revocation):
    cognito_revocation.revoked = True
    response = signed_in(families.a).delete(detail(families.a1))
    assert response.status_code == 401 and code(response) == "authentication_failed"
    assert ChildProfile.objects.count() == 4


def test_the_check_fails_closed_when_cognito_cannot_answer(families, signed_in, cognito_revocation):
    cognito_revocation.unavailable = True
    response = signed_in(families.a).delete(detail(families.a1))
    assert response.status_code == 503 and code(response) == "recent_auth_unavailable"
    assert ChildProfile.objects.count() == 4


def test_cognito_naming_another_identity_is_refused(families, signed_in, cognito_revocation):
    cognito_revocation.sub_override = families.b.cognito_sub
    response = signed_in(families.a).delete(detail(families.a1))
    assert response.status_code == 401
    assert ChildProfile.objects.count() == 4


def test_a_token_without_the_self_service_scope_fails_closed(
    families, signed_in, cognito_revocation
):
    response = signed_in(families.a, scope="openid email").delete(detail(families.a1))
    assert response.status_code == 503 and code(response) == "recent_auth_unavailable"
    assert cognito_revocation.calls == 0 and ChildProfile.objects.count() == 4


def test_the_presented_token_itself_is_what_cognito_checks(
    families, api, token_for, cognito_revocation
):
    token = token_for(families.a.cognito_sub)
    assert api(token=token).delete(detail(families.a1)).status_code == 204
    assert cognito_revocation.tokens == [token]


# --- authentication and authorization still come first -----------------------------------------


def test_no_token_or_a_bad_token_is_unauthenticated(families, api, cognito_revocation):
    assert code(api().delete(detail(families.a1))) == "not_authenticated"
    bad = api(token="not.a.token").delete(detail(families.a1))
    assert bad.status_code == 401 and code(bad) == "authentication_failed"
    assert ChildProfile.objects.count() == 4 and cognito_revocation.calls == 0


def test_an_unprovisioned_account_is_refused_before_recency(cognito, api, cognito_revocation):
    response = api("sub-never-provisioned").delete(detail(uuid.uuid4()))
    assert response.status_code == 403 and code(response) == "account_not_provisioned"
    assert cognito_revocation.calls == 0


def test_another_familys_child_is_not_found_and_kept(families, signed_in):
    response = signed_in(families.a).delete(detail(families.b1))
    assert response.status_code == 404 and code(response) == "not_found"
    assert ChildProfile.objects.filter(pk=families.b1.pk).exists()


def test_a_stale_sign_in_learns_nothing_about_which_children_exist(families, signed_in):
    client = signed_in(families.a, auth_time=now() - 3600, iat=now() - 3600)
    answers = [
        (r.status_code, code(r), r.json()["error"]["message"])
        for r in (
            client.delete(detail(families.a1)),
            client.delete(detail(families.b1)),
            client.delete(detail(uuid.uuid4())),
        )
    ]
    assert len(set(answers)) == 1 and answers[0][1] == "recent_auth_required"


def test_an_unknown_child_is_not_found(families, signed_in):
    assert signed_in(families.a).delete(detail(uuid.uuid4())).status_code == 404


def test_deleting_twice_is_safe(families, signed_in):
    client = signed_in(families.a)
    assert client.delete(detail(families.a1)).status_code == 204
    again = client.delete(detail(families.a1))
    assert again.status_code == 404 and ChildProfile.objects.count() == 3


def test_an_inactive_parent_cannot_delete(families, signed_in):
    ParentAccount.objects.filter(pk=families.a.pk).update(is_active=False)
    assert signed_in(families.a).delete(detail(families.a1)).status_code == 403
    assert ChildProfile.objects.count() == 4


# --- the deletion itself -----------------------------------------------------------------------


def test_deletion_removes_the_photo_objects_too(
    families, signed_in, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        photos.replace_photo(families.a, families.a1.pk, EXIF_JPEG, "image/jpeg")
    storage = get_photo_storage()
    assert isinstance(storage, MemoryPhotoStorage)
    prefix = f"children/{families.a1.pk}/"
    assert [p for p in storage.list() if p.key.startswith(prefix)]
    assert signed_in(families.a).delete(detail(families.a1)).status_code == 204
    assert [p for p in storage.list() if p.key.startswith(prefix)] == []
    assert ChildPhoto.objects.count() == 0


def test_incomplete_deletion_is_a_retryable_503_and_keeps_the_child(
    families, signed_in, monkeypatch
):
    def incomplete(parent, child_id):
        raise deletion.ChildDeletionIncomplete

    monkeypatch.setattr(deletion, "delete_child_profile", incomplete)
    response = signed_in(families.a).delete(detail(families.a1))
    assert response.status_code == 503 and code(response) == "child_deletion_incomplete"
    assert ChildProfile.objects.filter(pk=families.a1.pk).exists()


# --- logging ------------------------------------------------------------------------------------


def test_logs_carry_reason_codes_only(families, api, token_for, caplog):
    session = "origin-secret-" + uuid.uuid4().hex
    stale = token_for(families.a.cognito_sub, origin_jti=session, auth_time=now() - 999)
    fresh = token_for(families.a.cognito_sub, origin_jti=session + "x")
    with caplog.at_level(logging.DEBUG):
        api(token=stale).delete(detail(families.a1))
        api(token=fresh).delete(detail(families.a1))
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "recent authentication required: stale" in text
    assert "recent authentication accepted" in text
    for secret in (stale, fresh, session, families.a.cognito_sub, "Zinnia"):
        assert secret not in text


# --- the Cognito GetUser adapter -----------------------------------------------------------------


@pytest.fixture
def stubbed_cognito(settings, monkeypatch):
    settings.COGNITO_REGION = "us-test-1"
    client = recent_auth._cognito_client.__wrapped__("us-test-1")
    monkeypatch.setattr(recent_auth, "_cognito_client", lambda region: client)
    with Stubber(client) as stubber:
        yield stubber


def test_get_user_returns_the_sub(stubbed_cognito):
    stubbed_cognito.add_response(
        "get_user",
        {"Username": "u", "UserAttributes": [{"Name": "sub", "Value": "sub-1"}]},
        {"AccessToken": "tok"},
    )
    assert recent_auth.CognitoRevocationCheck()("tok") == "sub-1"


@pytest.mark.parametrize(
    "error_code,message,expected",
    [
        ("NotAuthorizedException", "Access Token has been revoked", recent_auth.TokenRevoked),
        ("UserNotFoundException", "User does not exist.", recent_auth.TokenRevoked),
        (
            "NotAuthorizedException",
            "Access Token does not have required scopes",
            recent_auth.RevocationCheckUnavailable,
        ),
        ("TooManyRequestsException", "Rate exceeded", recent_auth.RevocationCheckUnavailable),
        ("InternalErrorException", "oops", recent_auth.RevocationCheckUnavailable),
    ],
)
def test_get_user_errors_are_classified(stubbed_cognito, error_code, message, expected):
    stubbed_cognito.add_client_error(
        "get_user", service_error_code=error_code, service_message=message
    )
    with pytest.raises(expected):
        recent_auth.CognitoRevocationCheck()("tok")


def test_get_user_without_a_sub_is_unavailable(stubbed_cognito):
    stubbed_cognito.add_response("get_user", {"Username": "u", "UserAttributes": []})
    with pytest.raises(recent_auth.RevocationCheckUnavailable):
        recent_auth.CognitoRevocationCheck()("tok")


def test_the_cognito_client_is_unsigned_with_short_timeouts():
    client = recent_auth._cognito_client.__wrapped__("us-test-1")
    config = client.meta.config
    assert config.signature_version is UNSIGNED
    assert config.connect_timeout == 3 and config.read_timeout == 5
