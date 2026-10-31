"""Environment-selectable API authentication (LAI-AUTH-DUAL, ADR-038).

The local Django sign-in (AUTH_PROVIDER=django) and its isolation from the Cognito provider. The
Cognito cases themselves (valid, expired, wrong issuer, wrong client or token use, account
mapping, unknown identities) are in test_authentication.py and run under the production
provider, which is what test settings select.

Browsers are imitated with CSRF checks on (`Client(enforce_csrf_checks=True)`). Passwords are
synthetic and generated per test.
"""

import json
import secrets

import pytest
from django.contrib.sessions.models import Session
from django.core.management import CommandError, call_command
from django.test import Client

from apps.users import services
from apps.users.backends import LocalParentPasswordBackend
from apps.users.models import LOCAL_PARENT_SUB_PREFIX, ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CSRF = "/api/v1/auth/csrf/"
LOGIN = "/api/v1/auth/login/"
LOGOUT = "/api/v1/auth/logout/"
ME = "/api/v1/me/"
CHILD = {
    "age_band": "PATHFINDER",
    "avatar_key": "FOX",
    "reading_mode": "READ_ALONG",
    "session_minutes": 10,
}


@pytest.fixture
def local_mode(settings):
    settings.AUTH_PROVIDER = "django"
    return settings


def local_parent(username="local-a"):
    password = secrets.token_urlsafe(18)
    return ParentAccount.objects.create_local_parent(username, password), password


class Browser:
    """A test client that behaves like the React app: CSRF token from the API, then JSON."""

    def __init__(self):
        self.client = Client(enforce_csrf_checks=True, raise_request_exception=False)
        self.token = None

    def refresh_csrf(self):
        response = self.client.get(CSRF)
        assert response.status_code == 200
        self.token = response.json()["csrfToken"]

    def post(self, url, body=None, *, csrf=True):
        headers = {"HTTP_X_CSRFTOKEN": self.token} if csrf and self.token else {}
        return self.client.post(
            url, json.dumps(body or {}), content_type="application/json", **headers
        )

    def patch(self, url, body):
        return self.client.patch(
            url, json.dumps(body), content_type="application/json", HTTP_X_CSRFTOKEN=self.token
        )

    def get(self, url, **extra):
        return self.client.get(url, **extra)

    def login(self, username, password):
        self.refresh_csrf()
        response = self.post(LOGIN, {"username": username, "password": password})
        self.refresh_csrf()  # Django rotates the token on sign-in
        return response


def code_of(response):
    return response.json()["error"]["code"]


# --- sign-in, me, sign-out ---------------------------------------------------------------------


def test_local_login_with_valid_credentials_starts_a_session(local_mode):
    account, password = local_parent()
    browser = Browser()
    response = browser.login("local-a", password)
    assert response.status_code == 200
    assert response.json() == {"id": str(account.pk), "django_admin": False}
    assert browser.get(ME).json()["id"] == str(account.pk)


def test_me_returns_the_signed_in_parent_and_nobody_else(local_mode):
    first, first_password = local_parent("local-a")
    second, second_password = local_parent("local-b")
    a, b = Browser(), Browser()
    a.login("local-a", first_password)
    b.login("local-b", second_password)
    assert a.get(ME).json()["id"] == str(first.pk)
    assert b.get(ME).json()["id"] == str(second.pk)
    # POST me/ (the onboarding call the app makes after every sign-in) is idempotent here too.
    assert a.post(ME).status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"username": "local-a", "password": "wrong-password-123"},
        {"username": "nobody-here", "password": "wrong-password-123"},
        {"username": "local-a"},
        {"username": "", "password": ""},
        {"username": ["local-a"], "password": "x"},
        {"username": "local-a", "password": "x" * 300},
    ],
)
def test_invalid_credentials_get_one_consistent_error(local_mode, body):
    local_parent()
    browser = Browser()
    browser.refresh_csrf()
    response = browser.post(LOGIN, body)
    assert response.status_code == 400
    assert response.json()["error"] == {
        "code": "invalid_credentials",
        "message": "That username and password did not match.",
    }
    assert browser.get(ME).status_code == 401


def test_an_inactive_local_parent_cannot_sign_in(local_mode):
    account, password = local_parent()
    account.is_active = False
    account.save()
    browser = Browser()
    assert browser.login("local-a", password).status_code == 400


def test_logout_ends_the_session(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.login("local-a", password)
    session_key = browser.client.session.session_key
    assert browser.post(LOGOUT).status_code == 204
    assert not Session.objects.filter(session_key=session_key).exists()
    response = browser.get(ME)
    assert response.status_code == 401
    assert response["WWW-Authenticate"] == 'Session realm="api"'


def test_an_old_session_cookie_is_useless_after_logout(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.login("local-a", password)
    stolen = browser.client.cookies["lai_admin_session"].value
    browser.post(LOGOUT)
    replay = Client()
    replay.cookies["lai_admin_session"] = stolen
    assert replay.get(ME).status_code == 401


# --- CSRF ---------------------------------------------------------------------------------------


def test_login_without_the_csrf_token_is_refused(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.refresh_csrf()
    response = browser.post(LOGIN, {"username": "local-a", "password": password}, csrf=False)
    assert response.status_code == 403 and code_of(response) == "csrf_failed"
    assert browser.get(ME).status_code == 401


def test_login_from_another_origin_is_refused(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.refresh_csrf()
    response = browser.client.post(
        LOGIN,
        json.dumps({"username": "local-a", "password": password}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=browser.token,
        HTTP_ORIGIN="https://evil.example",
        secure=True,
    )
    assert response.status_code == 403 and code_of(response) == "csrf_failed"


def test_unsafe_session_requests_need_the_csrf_token(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.login("local-a", password)
    body = {
        "nickname": "Pip",
        "ageBand": "PATHFINDER",
        "avatarKey": "FOX",
        "readingMode": "READ_ALONG",
        "sessionMinutes": 10,
    }
    refused = browser.post("/api/v1/children/", body, csrf=False)
    assert refused.status_code == 403 and code_of(refused) == "csrf_failed"
    assert not ChildProfile.objects.exists()
    assert browser.post("/api/v1/children/", body).status_code == 201
    # Safe methods need no token.
    assert browser.get("/api/v1/children/").status_code == 200


def test_logout_without_the_csrf_token_is_refused(local_mode):
    _account, password = local_parent()
    browser = Browser()
    browser.login("local-a", password)
    assert browser.post(LOGOUT, csrf=False).status_code == 403
    assert browser.get(ME).status_code == 200


# --- who the local sign-in can never authenticate ----------------------------------------------


def test_a_cognito_parent_cannot_sign_in_locally(local_mode):
    ParentAccount.objects.get_or_create_for_cognito("11111111-2222-3333-4444-555555555555")
    browser = Browser()
    browser.refresh_csrf()
    response = browser.post(
        LOGIN, {"username": "11111111-2222-3333-4444-555555555555", "password": "anything-at-all"}
    )
    assert response.status_code == 400


def test_admin_credentials_never_start_a_gameplay_session(local_mode):
    from apps.core.tests.test_django_admin import make_admin

    _staff, password = make_admin("staff-local")
    browser = Browser()
    assert browser.login("staff-local", password).status_code == 400
    assert browser.get(ME).status_code == 401


def test_a_django_admin_session_does_not_authenticate_the_api_locally(local_mode):
    from apps.core.tests.test_django_admin import make_admin, sign_in

    _staff, password = make_admin("staff-local")
    client, response = sign_in("staff-local", password)
    assert response.status_code == 302
    assert client.get(ME).status_code == 401


def test_a_bearer_token_is_not_a_fallback_in_django_mode(local_mode, token_for):
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-cognito")
    response = Client().get(ME, HTTP_AUTHORIZATION=f"Bearer {token_for(parent.cognito_sub)}")
    assert response.status_code == 401


# --- the Cognito provider (production) ignores every local credential ---------------------------


@pytest.mark.parametrize(("method", "url"), [("get", CSRF), ("post", LOGIN), ("post", LOGOUT)])
def test_the_local_sign_in_routes_do_not_exist_under_cognito(method, url):
    response = getattr(Client(), method)(url)
    assert response.status_code == 404 and code_of(response) == "not_found"


def test_a_local_session_never_authenticates_the_api_under_cognito(settings):
    settings.AUTH_PROVIDER = "django"
    _account, password = local_parent()
    browser = Browser()
    browser.login("local-a", password)
    assert browser.get(ME).status_code == 200
    settings.AUTH_PROVIDER = "cognito"
    response = browser.get(ME)
    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Bearer"


def test_the_local_backend_refuses_everything_under_cognito():
    account, password = local_parent()
    backend = LocalParentPasswordBackend()
    assert backend.authenticate(None, username="local-a", password=password) is None
    assert backend.get_user(account.pk) is None


def test_django_admin_sign_in_still_works_under_cognito(settings):
    from apps.core.tests.test_django_admin import ADMIN, make_admin, sign_in

    assert settings.AUTH_PROVIDER == "cognito"
    _staff, password = make_admin("staff-cognito")
    client, response = sign_in("staff-cognito", password)
    assert response.status_code == 302
    assert client.get(ADMIN).status_code == 200
    assert client.get(ME).status_code == 401  # the admin session is not an API credential


def test_an_unknown_provider_at_run_time_authenticates_nobody(settings):
    settings.AUTH_PROVIDER = "something-else"
    response = Client().get(ME, HTTP_AUTHORIZATION="Bearer x.y.z")
    assert response.status_code == 401


# --- authorization is the same in both modes ---------------------------------------------------


def test_a_local_parent_reaches_their_own_child_and_not_another(local_mode):
    first, first_password = local_parent("local-a")
    second, _ = local_parent("local-b")
    own = services.create_child_profile(first, nickname="Own-Kid", **CHILD)
    other = services.create_child_profile(second, nickname="Other-Kid", **CHILD)
    browser = Browser()
    browser.login("local-a", first_password)
    assert browser.get(f"/api/v1/children/{own.pk}/").status_code == 200
    listed = browser.get("/api/v1/children/").json()["children"]
    assert [child["id"] for child in listed] == [str(own.pk)]
    response = browser.get(f"/api/v1/children/{other.pk}/")
    assert response.status_code == 404 and code_of(response) == "not_found"
    patched = browser.patch(f"/api/v1/children/{other.pk}/", {"nickname": "Taken"})
    assert patched.status_code == 404
    assert browser.patch(f"/api/v1/children/{own.pk}/", {"nickname": "Renamed"}).status_code == 200
    other.refresh_from_db()
    assert other.nickname == "Other-Kid"


def test_treasure_rush_plays_end_to_end_under_local_auth(local_mode, treasure):
    from apps.game_sessions.models import ChallengeAttempt

    account, password = local_parent()
    child = services.create_child_profile(account, nickname="Cove-Kid", **CHILD)
    browser = Browser()
    browser.login("local-a", password)
    root = f"/api/v1/children/{child.pk}/"
    region = "treasure-rush-cove"
    assert browser.get(f"{root}regions/{region}/").status_code == 200
    assert browser.post(f"{root}quests/{region}/accept/").status_code in (200, 201)
    session = browser.post(f"{root}regions/{region}/session/").json()
    issued = browser.post(f"{root}sessions/{session['sessionId']}/chests/cove-chest/challenge/")
    assert issued.status_code in (200, 201)
    attempt_id = issued.json()["attemptId"]
    right = ChallengeAttempt.objects.get(pk=attempt_id).answer
    answered = browser.post(f"{root}attempts/{attempt_id}/answer/", {"answer": right})
    assert answered.status_code == 200 and answered.json()["chestOpened"] is True
    assert browser.get(f"{root}progress/").status_code == 200
    # Another family's child stays invisible on the play routes too.
    stranger = treasure.families.b1
    assert browser.get(f"/api/v1/children/{stranger.pk}/regions/{region}/").status_code == 404


# --- manage.py create_local_parent ----------------------------------------------------------------


@pytest.fixture
def typed_password(monkeypatch):
    from apps.users.management.commands import create_local_parent

    password = secrets.token_urlsafe(18)
    monkeypatch.setattr(create_local_parent.getpass, "getpass", lambda prompt: password)
    return password


def test_the_command_creates_a_parent_and_child_who_can_sign_in(local_mode, typed_password):
    call_command("create_local_parent", "dev-parent", "--child", "Dev-Kid")
    account = ParentAccount.objects.get(cognito_sub=LOCAL_PARENT_SUB_PREFIX + "dev-parent")
    assert not account.is_staff and not account.is_superuser and account.admin_username is None
    child = ChildProfile.objects.get(parent=account)
    assert child.age_band == "PATHFINDER"
    assert Browser().login("dev-parent", typed_password).status_code == 200


def test_the_command_refuses_under_cognito(typed_password):
    with pytest.raises(CommandError, match="AUTH_PROVIDER=django"):
        call_command("create_local_parent", "dev-parent")
    assert not ParentAccount.objects.exists()


@pytest.mark.parametrize("username", ["has space", "-leading", "x" * 101, ""])
def test_the_command_refuses_bad_usernames(local_mode, typed_password, username):
    with pytest.raises(CommandError):
        call_command("create_local_parent", username)


def test_the_command_enforces_the_password_validators(local_mode, monkeypatch):
    from apps.users.management.commands import create_local_parent

    monkeypatch.setattr(create_local_parent.getpass, "getpass", lambda prompt: "short")
    with pytest.raises(CommandError):
        call_command("create_local_parent", "dev-parent")
    assert not ParentAccount.objects.exists()


def test_the_command_resets_a_password_and_refuses_duplicates(local_mode, typed_password):
    call_command("create_local_parent", "dev-parent")
    with pytest.raises(CommandError, match="already exists"):
        call_command("create_local_parent", "dev-parent")
    call_command("create_local_parent", "dev-parent", "--reset-password")
    assert Browser().login("dev-parent", typed_password).status_code == 200
