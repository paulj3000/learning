"""Cognito is the only API authentication (LAI-AUTH-ROLLBACK, ADR-040; supersedes ADR-038).

The token checks themselves (signature, issuer, expiry, token use, client id) are in
test_authentication.py; the Django Admin login is in apps/core/tests/test_django_admin.py. This
module pins what the rollback removed: no provider switch, no local parent sign-in, no session
that reaches a gameplay route, Treasure Rush included.
"""

import json
import secrets

import pytest
from django.conf import settings as django_settings
from django.core.management import CommandError, call_command
from django.test import Client

from apps.game_sessions.models import AdventureSession
from apps.game_sessions.runtime_auth import GameRuntimeAccessMixin
from apps.users.authentication import CognitoJWTAuthentication
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
REMOVED_ROUTES = ("/api/v1/auth/csrf/", "/api/v1/auth/login/", "/api/v1/auth/logout/")


def region_url(child):
    return f"/api/v1/children/{child.pk}/regions/{REGION}/"


def start_url(child):
    return f"{region_url(child)}session/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def admin_session_for(account):
    """Makes `account` Django Admin staff and signs it in through the admin login page."""
    password = secrets.token_urlsafe(18)
    account.admin_username = f"staff-{account.pk.hex[:8]}"
    account.is_staff = True
    account.set_password(password)
    account.save()
    client = Client(raise_request_exception=False)
    response = client.post(
        "/admin/login/",
        {"username": account.admin_username, "password": password, "next": "/admin/"},
    )
    assert response.status_code == 302  # the admin login itself still works
    # A browser would not send the admin cookie outside /admin/; force it to prove DRF ignores it.
    client.cookies[django_settings.SESSION_COOKIE_NAME]["path"] = "/"
    return client


def test_there_is_no_provider_switch_and_no_local_parent_backend():
    assert not hasattr(django_settings, "AUTH_PROVIDER")
    assert not hasattr(django_settings, "LOCAL_PARENT_BACKEND")
    assert django_settings.AUTHENTICATION_BACKENDS == ["apps.users.backends.AdminPasswordBackend"]
    assert django_settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"] == [
        "apps.users.authentication.CognitoJWTAuthentication"
    ]
    # The game runtime's own cookie grant comes second; the parent credential is Cognito only.
    assert GameRuntimeAccessMixin.authentication_classes[0] is CognitoJWTAuthentication


def test_local_parent_tooling_is_gone():
    assert not hasattr(ParentAccount.objects, "create_local_parent")
    with pytest.raises(CommandError):
        call_command("create_local_parent", "someone")
    with pytest.raises(NotImplementedError):
        ParentAccount.objects.create_user("someone", "a-password")


@pytest.mark.parametrize("route", REMOVED_ROUTES)
def test_the_local_sign_in_endpoints_no_longer_exist(route, cognito, api, families):
    for client in (Client(raise_request_exception=False), api(families.a)):
        assert client.get(route).status_code == 404
        assert post(client, route, {"username": "x", "password": "y"}).status_code == 404


def test_cognito_tokens_authenticate_treasure_rush(cognito, api, treasure):
    child = treasure.families.a1
    client = api(treasure.families.a)
    assert client.get(region_url(child)).status_code == 200
    assert post(client, start_url(child)).status_code in (200, 201)


def test_a_cognito_parent_cannot_play_another_familys_child(cognito, api, treasure):
    client = api(treasure.families.a)
    other = treasure.families.b1
    assert client.get(region_url(other)).status_code == 404
    assert post(client, start_url(other)).status_code == 404
    assert not AdventureSession.objects.filter(child=other).exists()


def test_a_django_session_never_authenticates_gameplay_even_for_the_owner(cognito, treasure):
    """The family's own parent, signed in to Django Admin, still cannot play through a session."""
    parent, child = treasure.families.a, treasure.families.a1
    client = admin_session_for(parent)
    for response in (
        client.get("/api/v1/me/"),
        client.get("/api/v1/children/"),
        client.get(region_url(child)),
        post(client, start_url(child)),
    ):
        assert response.status_code == 401
        assert response["WWW-Authenticate"] == "Bearer"
    assert not AdventureSession.objects.filter(child=child).exists()
    # The same session still opens the admin.
    client.cookies[django_settings.SESSION_COOKIE_NAME]["path"] = django_settings.SESSION_COOKIE_PATH
    assert client.get("/admin/").status_code == 200
