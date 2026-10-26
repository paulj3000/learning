"""The native app's sign-in sequence (LAI-ANDROID-API-001; docs/android/ANDROID_AUTH_FLOW.md).

`POST /api/v1/me/` is the one provisioning call for web and Android alike. Token verification,
duplicate and concurrent provisioning are covered in depth by test_authentication.py; this file
proves the sequence the Kotlin app follows and that it grants nothing extra.
"""

import json

import pytest

from apps.users.backends import AdminPasswordBackend
from apps.users.models import ParentAccount

from .helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"
CHILDREN = "/api/v1/children/"


def test_first_sign_in_provisions_then_children_work(api):
    client = api("sub-android-parent")
    assert client.get(CHILDREN).json()["error"]["code"] == "account_not_provisioned"
    first = client.post(ME)
    assert first.status_code == 201 and first.json()["django_admin"] is False
    assert client.get(CHILDREN).json() == {"children": []}


def test_every_later_sign_in_returns_the_same_account(api, token_for):
    first = api("sub-android-parent").post(ME).json()["id"]
    for _ in range(3):  # a fresh token each time, as after each Cognito sign-in or refresh
        again = api(token=token_for("sub-android-parent")).post(ME)
        assert again.status_code == 200 and again.json()["id"] == first
    assert ParentAccount.objects.filter(cognito_sub="sub-android-parent").count() == 1


@pytest.mark.parametrize(
    "claims",
    [
        {"token_use": "id"},
        {"client_id": "some-other-app-client"},
        {"iss": "https://cognito-idp.us-test-1.amazonaws.com/other-pool"},
        {"exp": 1},
    ],
)
def test_tokens_the_app_must_not_use_are_rejected(api, cognito, claims):
    token = cognito.sign(access_claims("sub-android-parent", **claims))
    response = api(token=token).post(ME)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_failed"
    assert ParentAccount.objects.count() == 0


def test_cognito_groups_never_grant_staff(api, cognito):
    token = cognito.sign(
        access_claims("sub-android-parent", **{"cognito:groups": ["Admins", "Superusers"]})
    )
    body = api(token=token).post(ME).json()
    account = ParentAccount.objects.get(pk=body["id"])
    assert body["django_admin"] is False
    assert not account.is_staff and not account.is_superuser and account.admin_username is None
    backend = AdminPasswordBackend()
    assert backend.authenticate(None, username=account.cognito_sub, password="") is None


def test_the_request_body_cannot_shape_the_account(api):
    response = api("sub-android-parent").post(
        ME,
        json.dumps({"is_staff": True, "cognito_sub": "sub-other", "id": "x"}),
        content_type="application/json",
    )
    account = ParentAccount.objects.get(pk=response.json()["id"])
    assert account.cognito_sub == "sub-android-parent" and not account.is_staff
