"""Django Admin access (LAI-0404, ADR-034): who gets in, what they see, and what stays untouched.

Uses the real login form with CSRF checks on, real sessions, and the real database. Passwords are
synthetic and generated per test.
"""

import secrets

import pytest
from django.apps import apps
from django.contrib import admin
from django.test import Client
from django.urls import reverse

from apps.core.models import ChildOwnedModel
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, AdminAccount, ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ADMIN = "/admin/"
LOGIN = "/admin/login/"


def make_admin(username, *, superuser=False, active=True, cognito_sub=None):
    password = secrets.token_urlsafe(18)
    account = (
        ParentAccount.objects.get(cognito_sub=cognito_sub)
        if cognito_sub
        else ParentAccount(cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}")
    )
    account.admin_username = username
    account.is_staff = True
    account.is_superuser = superuser
    account.is_active = active
    account.set_password(password)
    account.save()
    return account, password


def sign_in(username, password):
    """Signs in through the login page, CSRF token and all, like a browser would."""
    client = Client(enforce_csrf_checks=True)
    page = client.get(LOGIN)
    assert page.status_code == 200
    token = page.cookies["lai_admin_csrftoken"].value
    response = client.post(
        LOGIN,
        {"username": username, "password": password, "csrfmiddlewaretoken": token, "next": ADMIN},
    )
    return client, response


def test_the_admin_is_mounted_at_admin():
    assert reverse("admin:index") == ADMIN
    assert reverse("admin:login") == LOGIN


@pytest.mark.parametrize("path", [ADMIN, "/admin/catalog/world/", "/admin/users/adminaccount/"])
def test_anonymous_visitors_are_sent_to_the_login_page(path):
    response = Client().get(path)
    assert response.status_code == 302
    assert response["Location"].startswith(LOGIN)


def test_the_login_page_asks_for_an_admin_username_and_sets_scoped_cookies():
    response = Client().get(LOGIN)
    assert response.status_code == 200
    assert b"Admin username" in response.content
    cookie = response.cookies["lai_admin_csrftoken"]
    assert cookie["path"] == ADMIN and cookie["httponly"]


def test_staff_sign_in_with_csrf_and_get_a_scoped_session_cookie():
    _account, password = make_admin("catalog-editor")
    client, response = sign_in("catalog-editor", password)
    assert response.status_code == 302 and response["Location"] == ADMIN
    session = response.cookies["lai_admin_session"]
    assert session["path"] == ADMIN and session["httponly"]
    assert client.get(ADMIN).status_code == 200


def test_a_login_post_without_the_csrf_token_is_refused():
    _account, password = make_admin("no-token")
    client = Client(enforce_csrf_checks=True)
    response = client.post(LOGIN, {"username": "no-token", "password": password})
    assert response.status_code == 403


@pytest.mark.parametrize("case", ["wrong_password", "inactive", "not_staff", "parent_sub"])
def test_who_cannot_sign_in(case):
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-ordinary-parent")
    account, password = make_admin("someone")
    username = "someone"
    if case == "wrong_password":
        password = "not-" + password
    elif case == "inactive":
        ParentAccount.objects.filter(pk=account.pk).update(is_active=False)
    elif case == "not_staff":
        ParentAccount.objects.filter(pk=account.pk).update(is_staff=False)
    elif case == "parent_sub":
        username = parent.cognito_sub  # a Cognito parent's identifier is not an admin login
    client, response = sign_in(username, password)
    assert response.status_code == 200  # the form again, with an error
    assert "_auth_user_id" not in client.session
    assert client.get(ADMIN).status_code == 302


def test_a_non_staff_session_is_refused_even_if_one_exists():
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-ordinary-parent")
    client = Client()
    client.force_login(parent, backend="apps.users.backends.AdminPasswordBackend")
    response = client.get(ADMIN)
    assert response.status_code == 302 and response["Location"].startswith(LOGIN)


def test_revoking_staff_ends_access_on_the_next_request():
    account, password = make_admin("leaver")
    client, _ = sign_in("leaver", password)
    assert client.get(ADMIN).status_code == 200
    ParentAccount.objects.filter(pk=account.pk).update(is_staff=False)
    assert client.get(ADMIN).status_code == 302


def test_staff_see_the_catalog_but_not_admin_accounts():
    _account, password = make_admin("staff-only")
    client, _ = sign_in("staff-only", password)
    index = client.get(ADMIN)
    assert b"/admin/catalog/world/" in index.content
    assert b"/admin/users/adminaccount/" not in index.content
    assert client.get("/admin/catalog/world/").status_code == 200
    assert client.get("/admin/users/adminaccount/").status_code == 403


def test_superusers_can_open_every_registered_admin_page():
    _account, password = make_admin("root", superuser=True)
    client, _ = sign_in("root", password)
    for model in admin.site._registry:
        meta = model._meta
        url = reverse(f"admin:{meta.app_label}_{meta.model_name}_changelist")
        assert client.get(url).status_code == 200, url


def test_the_admin_accounts_page_lists_admins_and_never_parents():
    ParentAccount.objects.get_or_create_for_cognito("sub-ordinary-parent", "Visible Parent Name")
    _account, password = make_admin("root", superuser=True)
    client, _ = sign_in("root", password)
    page = client.get("/admin/users/adminaccount/")
    assert b"root" in page.content
    assert b"sub-ordinary-parent" not in page.content
    assert b"Visible Parent Name" not in page.content
    assert list(admin.site._registry[AdminAccount].get_queryset(page.wsgi_request)) == [
        AdminAccount.objects.get(admin_username="root")
    ]


def test_a_superuser_flag_without_staff_is_rejected_by_the_database():
    from django.db import IntegrityError, transaction

    parent = ParentAccount.objects.get_or_create_for_cognito("sub-ordinary-parent")
    parent.is_superuser = True
    with pytest.raises(IntegrityError), transaction.atomic():
        parent.save()


def test_no_child_data_model_is_registered():
    registered = set(admin.site._registry)
    child_models = {
        model
        for model in apps.get_models()
        if issubclass(model, ChildOwnedModel) or model is ChildProfile
    }
    assert child_models, "the check must find the child-owned models"
    assert not registered & child_models
    # Only these apps have anything in the admin.
    assert {model._meta.app_label for model in registered} == {"assets", "auth", "catalog", "users"}


def test_an_admin_session_never_authenticates_the_api():
    _account, password = make_admin("staff-only")
    client, _ = sign_in("staff-only", password)
    # The browser would not even send the cookie outside /admin/; force it to prove DRF ignores it.
    client.cookies["lai_admin_session"]["path"] = "/"
    response = client.get("/api/v1/me/")
    assert response.status_code == 401
    assert client.get("/api/v1/health/").status_code == 200


# --- the whole journey (owner acceptance, 2026-10-25) --------------------------------------------


@pytest.fixture
def typed_password(monkeypatch):
    from apps.users.management.commands import create_admin_account

    password = secrets.token_urlsafe(18)
    monkeypatch.setattr(create_admin_account.getpass, "getpass", lambda prompt: password)
    return password


def test_the_initial_superuser_on_an_empty_database(typed_password):
    from django.core.management import call_command

    assert not ParentAccount.objects.exists()
    call_command("create_admin_account", "first-root", "--superuser")
    client, response = sign_in("first-root", typed_password)
    assert response.status_code == 302
    assert client.get("/admin/users/adminaccount/").status_code == 200


def test_a_signed_up_parent_is_created_upgraded_to_superuser_and_signs_in(api, typed_password):
    """1. Signing in creates the Django user; 2. it is upgraded; 3. it reaches the admin."""
    from django.core.management import call_command

    sub = "4b5c6d7e-0000-4000-8000-00000000abcd"  # what Cognito puts in `sub`
    # 1. React's POST /me/ after sign-in creates the account, with no admin rights.
    created = api(sub).post("/api/v1/me/")
    assert created.status_code == 201 and created.json()["django_admin"] is False
    parent = ParentAccount.objects.get(cognito_sub=sub)
    assert not parent.is_staff and not parent.is_superuser

    # 2. An operator gives that parent an admin login, then makes it superuser.
    call_command("create_admin_account", "parent-root", "--cognito-sub", sub)
    call_command("set_admin_role", "parent-root", "superuser")
    parent.refresh_from_db()
    assert parent.is_staff and parent.is_superuser and parent.cognito_sub == sub
    assert ParentAccount.objects.count() == 1  # the same row, not a second account

    # The React menu now learns it is staff from the same call.
    assert api(sub).post("/api/v1/me/").json() == {"id": str(parent.pk), "django_admin": True}

    # 3. The admin site lets it in, with superuser pages.
    client, response = sign_in("parent-root", typed_password)
    assert response.status_code == 302 and response["Location"] == ADMIN
    assert client.get("/admin/users/adminaccount/").status_code == 200
    assert client.get("/admin/catalog/world/").status_code == 200


def test_the_admin_accounts_page_will_not_demote_the_last_superuser():
    account, password = make_admin("root", superuser=True)
    client, _ = sign_in("root", password)
    url = reverse("admin:users_adminaccount_change", args=[account.pk])
    form = {
        "is_active": "on",
        "is_staff": "on",  # superuser unticked
        "csrfmiddlewaretoken": client.cookies["lai_admin_csrftoken"].value,
    }
    response = client.post(url, form)
    assert response.status_code == 200 and b"last active superuser" in response.content
    account.refresh_from_db()
    assert account.is_superuser
    make_admin("second", superuser=True)
    response = client.post(url, form)
    assert response.status_code == 302
    account.refresh_from_db()
    assert account.is_staff and not account.is_superuser
