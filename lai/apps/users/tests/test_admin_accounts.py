"""Admin accounts (LAI-0404, ADR-034): the create command, the sign-in backend, and `/me`."""

import secrets
from io import StringIO

import pytest
from django.core.management import CommandError, call_command

from apps.users.backends import AdminPasswordBackend
from apps.users.management.commands import create_admin_account
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"


@pytest.fixture
def password():
    return secrets.token_urlsafe(18)


@pytest.fixture
def typed(monkeypatch):
    """typed(first, second=None): what the operator types at the two password prompts."""

    def answer(first, second=None):
        answers = iter([first, first if second is None else second])
        monkeypatch.setattr(create_admin_account.getpass, "getpass", lambda prompt: next(answers))

    return answer


def run(*args):
    out = StringIO()
    call_command("create_admin_account", *args, stdout=out)
    return out.getvalue()


def test_creates_a_standalone_staff_account_without_a_cognito_identity(typed, password):
    typed(password)
    output = run("editor")
    account = ParentAccount.objects.get(admin_username="editor")
    assert account.is_staff and account.is_active and not account.is_superuser
    assert account.cognito_sub.startswith(ADMIN_ONLY_SUB_PREFIX)
    assert account.check_password(password)
    assert password not in output and "staff" in output


def test_creates_a_superuser(typed, password):
    typed(password)
    run("root", "--superuser")
    account = ParentAccount.objects.get(admin_username="root")
    assert account.is_staff and account.is_superuser


def test_links_an_existing_parent_without_changing_its_identity(typed, password):
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-real-parent")
    typed(password)
    run("parent-admin", "--cognito-sub", "sub-real-parent")
    linked = ParentAccount.objects.get(pk=parent.pk)
    assert linked.admin_username == "parent-admin" and linked.is_staff
    assert linked.cognito_sub == "sub-real-parent"
    assert ParentAccount.objects.count() == 1


def test_refuses_to_link_an_unknown_sub(typed, password):
    typed(password)
    with pytest.raises(CommandError, match="sign in to the app once"):
        run("ghost", "--cognito-sub", "sub-nobody")
    assert not ParentAccount.objects.exists()


@pytest.mark.parametrize("weak", ["short", "password1234", "123456789012"])
def test_rejects_weak_passwords(typed, weak):
    typed(weak)
    with pytest.raises(CommandError):
        run("editor")
    assert not ParentAccount.objects.exists()


def test_rejects_mismatched_and_empty_passwords(typed, password):
    typed(password, "something-else-entirely")
    with pytest.raises(CommandError, match="do not match"):
        run("editor")
    typed("")
    with pytest.raises(CommandError, match="empty"):
        run("editor")


def test_rejects_a_duplicate_username(typed, password):
    typed(password)
    run("editor")
    typed(password)
    with pytest.raises(CommandError, match="already exists"):
        run("editor")


def test_resets_a_password_and_changes_nothing_else(typed, password):
    typed(password)
    run("editor")
    new_password = secrets.token_urlsafe(18)
    typed(new_password)
    run("editor", "--reset-password")
    account = ParentAccount.objects.get(admin_username="editor")
    assert account.check_password(new_password) and not account.is_superuser
    with pytest.raises(CommandError):
        run("editor", "--reset-password", "--superuser")


def test_no_input_reads_the_password_from_the_environment(monkeypatch, password):
    monkeypatch.delenv(create_admin_account.PASSWORD_ENV, raising=False)
    with pytest.raises(CommandError, match=create_admin_account.PASSWORD_ENV):
        run("editor", "--no-input")
    monkeypatch.setenv(create_admin_account.PASSWORD_ENV, password)
    run("editor", "--no-input")
    assert ParentAccount.objects.get(admin_username="editor").check_password(password)


def test_the_backend_only_signs_in_active_staff_with_a_password(typed, password):
    backend = AdminPasswordBackend()
    typed(password)
    run("editor")
    account = ParentAccount.objects.get(admin_username="editor")
    assert backend.authenticate(None, username="editor", password=password) == account
    assert backend.get_user(str(account.pk)) == account
    assert backend.authenticate(None, username="editor", password="wrong") is None
    assert backend.authenticate(None, username="nobody", password=password) is None
    assert backend.authenticate(None, username=account.cognito_sub, password=password) is None
    ParentAccount.objects.filter(pk=account.pk).update(is_staff=False)
    assert backend.authenticate(None, username="editor", password=password) is None
    assert backend.get_user(str(account.pk)) is None


def test_a_cognito_parent_can_never_be_signed_in_by_the_backend():
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-real-parent")
    # Provisioning stores an empty hash, which never matches (test_users.py has the same rule).
    assert parent.password == "" or not parent.has_usable_password()
    assert not parent.check_password("")
    assert AdminPasswordBackend().get_user(str(parent.pk)) is None


# --- the React menu's indicator -----------------------------------------------------------------


def test_me_reports_django_admin_false_for_a_parent_even_in_the_admins_group(api, token_for):
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-real-parent")
    response = api(token=token_for("sub-real-parent", **{"cognito:groups": ["Admins"]})).get(ME)
    assert response.json() == {"id": str(parent.pk), "displayName": "", "timezone": "", "django_admin": False}
    assert not ParentAccount.objects.get(pk=parent.pk).is_staff


def test_me_reports_django_admin_true_for_a_linked_staff_account(api, typed, password):
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-real-parent")
    typed(password)
    run("parent-admin", "--cognito-sub", "sub-real-parent")
    assert api(parent).get(ME).json() == {"id": str(parent.pk), "displayName": "", "timezone": "", "django_admin": True}
    ParentAccount.objects.filter(pk=parent.pk).update(is_staff=False)
    assert api(parent).get(ME).json()["django_admin"] is False


# --- set_admin_role ------------------------------------------------------------------------------


def role(username, value):
    out = StringIO()
    call_command("set_admin_role", username, value, stdout=out)
    return out.getvalue()


def flags(username):
    account = ParentAccount.objects.get(admin_username=username)
    return account.is_staff, account.is_superuser


def test_set_admin_role_promotes_and_demotes(typed, password):
    typed(password)
    run("root", "--superuser")
    typed(password)
    run("editor")
    assert "superuser" in role("editor", "superuser")
    assert flags("editor") == (True, True)
    assert role("editor", "staff") and flags("editor") == (True, False)
    assert role("editor", "none") and flags("editor") == (False, False)


def test_set_admin_role_needs_an_admin_account():
    ParentAccount.objects.get_or_create_for_cognito("sub-real-parent")
    with pytest.raises(CommandError, match="--cognito-sub"):
        role("sub-real-parent", "superuser")


@pytest.mark.parametrize("new_role", ["staff", "none"])
def test_the_last_superuser_cannot_be_demoted(typed, password, new_role):
    typed(password)
    run("root", "--superuser")
    with pytest.raises(CommandError, match="last active superuser"):
        role("root", new_role)
    assert flags("root") == (True, True)
    typed(password)
    run("second", "--superuser")
    role("root", new_role)  # fine once another superuser exists
    assert flags("root")[1] is False


def test_an_inactive_superuser_does_not_count_as_the_other_one(typed, password):
    typed(password)
    run("root", "--superuser")
    typed(password)
    run("dormant", "--superuser")
    ParentAccount.objects.filter(admin_username="dormant").update(is_active=False)
    with pytest.raises(CommandError, match="last active superuser"):
        role("root", "staff")
