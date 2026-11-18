"""Parent and child profile management in Django (LAI-CHILD-001).

`PATCH /api/v1/me/`, the child CRUD routes with a Cognito access token (ADR-040), the
archival policy (deactivate; hard deletion stays blocked by LAI-0209) and the read-only audited
Django Admin view (ADR-039). The LAI-0403 checklist for the child routes themselves is in
test_children_api.py and test_tenant_isolation.py.
"""

import json
import logging
import secrets
import uuid

import pytest
from django.contrib.auth.models import Permission
from django.test import Client

from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"
CHILDREN = "/api/v1/children/"
NEW_CHILD = {
    "nickname": "Marigold",
    "ageBand": "SPROUT",
    "avatarKey": "OWL",
    "interests": ["Space", "Ocean"],
    "readingMode": "VOICE_FIRST",
}


def detail(child_id):
    return f"{CHILDREN}{child_id}/"


def patch(client, url, body, **headers):
    return client.patch(url, json.dumps(body), content_type="application/json", **headers)


def code_of(response):
    return response.json()["error"]["code"]


@pytest.fixture
def signed_in(api):
    """A Cognito-authenticated parent (the only API sign-in, ADR-040): (client, account)."""
    account = ParentAccount.objects.get_or_create_for_cognito(f"sub-{uuid.uuid4()}")
    client = api(account)

    class Bearer:
        get = staticmethod(client.get)
        delete = staticmethod(client.delete)

        @staticmethod
        def post(url, body):
            return client.post(url, json.dumps(body), content_type="application/json")

        @staticmethod
        def patch(url, body):
            return patch(client, url, body)

    return Bearer, account


# --- parent profile ----------------------------------------------------------------------------


def test_a_parent_reads_and_updates_their_own_profile(signed_in):
    client, account = signed_in
    assert client.get(ME).json()["displayName"] == ""
    response = client.patch(ME, {"displayName": "  Robin  ", "timezone": "Europe/Bucharest"})
    assert response.status_code == 200
    assert response.json() == {
        "id": str(account.pk),
        "displayName": "Robin",
        "timezone": "Europe/Bucharest",
        "django_admin": False,
    }
    account.refresh_from_db()
    assert (account.display_name, account.timezone) == ("Robin", "Europe/Bucharest")
    assert client.patch(ME, {"timezone": ""}).json()["timezone"] == ""


@pytest.mark.parametrize(
    "body, field",
    [
        ({"displayName": ""}, "displayName"),
        ({"displayName": "x" * 81}, "displayName"),
        ({"timezone": "Mars/Olympus"}, "timezone"),
        ({"id": str(uuid.uuid4())}, "id"),
        ({"cognito_sub": "someone-else"}, "cognito_sub"),
        ({"is_staff": True}, "is_staff"),
        ({"django_admin": True}, "django_admin"),
    ],
)
def test_profile_updates_are_validated_and_closed(signed_in, body, field):
    client, account = signed_in
    before = ParentAccount.objects.values().get(pk=account.pk)
    response = client.patch(ME, body)
    assert response.status_code == 400 and code_of(response) == "validation_error"
    assert field in response.json()["error"]["details"]
    assert ParentAccount.objects.values().get(pk=account.pk) == before


def test_an_empty_profile_update_is_refused(signed_in):
    client, _ = signed_in
    assert client.patch(ME, {}).status_code == 400


def test_profile_reads_and_writes_need_a_signed_in_parent():
    client = Client(raise_request_exception=False)
    assert client.get(ME).status_code == 401
    assert patch(client, ME, {"displayName": "Nobody"}).status_code == 401


def test_an_unprovisioned_cognito_identity_cannot_write_a_profile(api):
    response = patch(api("sub-never-provisioned"), ME, {"displayName": "Ghost"})
    assert response.status_code == 403 and code_of(response) == "account_not_provisioned"
    assert not ParentAccount.objects.filter(cognito_sub="sub-never-provisioned").exists()


# --- child profiles -----------------------------------------------------------------------


def test_the_full_child_lifecycle_works(signed_in):
    client, account = signed_in
    assert client.get(CHILDREN).json() == {"children": []}

    created = client.post(CHILDREN, NEW_CHILD)
    assert created.status_code == 201
    child_id = created.json()["id"]
    assert ChildProfile.objects.get(pk=child_id).parent_id == account.pk
    assert [item["id"] for item in client.get(CHILDREN).json()["children"]] == [child_id]

    edited = client.patch(detail(child_id), {"nickname": "Goldie", "aiEnabled": False})
    assert edited.status_code == 200
    assert (edited.json()["nickname"], edited.json()["aiEnabled"]) == ("Goldie", False)
    assert client.get(detail(child_id)).json()["nickname"] == "Goldie"

    archived = client.patch(detail(child_id), {"active": False})
    assert archived.status_code == 200 and archived.json()["active"] is False
    assert client.get(CHILDREN).json()["children"][0]["active"] is False  # kept, not removed


def test_hard_deletion_works_after_a_recent_sign_in(signed_in):
    """LAI-0602 behind LAI-0209: the fixture's token is a recent sign-in (see test_recent_auth)."""
    client, account = signed_in
    child_id = client.post(CHILDREN, NEW_CHILD).json()["id"]
    response = client.delete(detail(child_id))
    assert response.status_code == 204
    assert not ChildProfile.objects.filter(pk=child_id, parent=account).exists()


def test_there_is_no_session_length_setting(signed_in):
    """ADR-053: the play-time limit is gone; the old field is refused like any unknown field."""
    client, _ = signed_in
    child_id = client.post(CHILDREN, NEW_CHILD).json()["id"]
    edited = client.patch(detail(child_id), {"nickname": "Marigold", "sessionMinutes": 30})
    assert edited.status_code == 400 and "sessionMinutes" in edited.json()["error"]["details"]


def test_another_familys_child_is_hidden(signed_in, families):
    client, _ = signed_in
    for method, body in (("get", None), ("patch", {"nickname": "Taken"}), ("delete", None)):
        call = getattr(client, method)
        response = (
            call(detail(families.b1.pk)) if body is None else call(detail(families.b1.pk), body)
        )
        assert response.status_code in (403, 404)
        if method != "delete":  # DELETE is denied for everyone before the lookup
            assert response.status_code == 404 and code_of(response) == "not_found"
    assert families.b1.pk not in [item["id"] for item in client.get(CHILDREN).json()["children"]]
    families.b1.refresh_from_db()
    assert families.b1.nickname == "Quince-B1"


# --- Django Admin: read-only, permission-gated, audited ----------------------------------------


def _staff(username, *, superuser=False, permission=None):
    password = secrets.token_urlsafe(18)
    account = ParentAccount(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
        is_superuser=superuser,
    )
    account.set_password(password)
    account.save()
    if permission:
        account.user_permissions.add(Permission.objects.get(codename=permission))
    client = Client()
    assert (
        client.post(
            "/admin/login/", {"username": username, "password": password, "next": "/admin/"}
        ).status_code
        == 302
    )
    return account, client


def test_a_superuser_inspects_parents_and_children_read_only(families, caplog):
    staff, client = _staff("support-lead", superuser=True)
    with caplog.at_level(logging.INFO, logger="lai.admin_audit"):
        parents = client.get("/admin/users/parentrecord/")
        parent_page = client.get(f"/admin/users/parentrecord/{families.a.pk}/change/")
        child_page = client.get(f"/admin/users/childprofile/{families.a1.pk}/change/")
    assert parents.status_code == parent_page.status_code == child_page.status_code == 200
    body = parent_page.content.decode() + child_page.content.decode()
    assert str(families.a1.pk) in parent_page.content.decode()  # the relationship is visible
    for secret in ("Zinnia-A1", "Secret-Interest", families.a.cognito_sub, 'name="_save"'):
        assert secret not in body
    assert str(families.b.pk) not in parent_page.content.decode()
    lines = [record.getMessage() for record in caplog.records]
    assert (
        f"admin_profile_read model=parentrecord action=view staff={staff.pk} record={families.a.pk}"
        in lines
    )
    assert all("Zinnia" not in line and "sub-family" not in line for line in lines)


def test_profile_inspection_cannot_change_or_delete_anything(families):
    _, client = _staff("support-lead", superuser=True)
    url = f"/admin/users/childprofile/{families.a1.pk}/"
    assert client.post(f"{url}change/", {"nickname": "Changed", "active": "off"}).status_code == 403
    assert client.post(f"{url}delete/", {"post": "yes"}).status_code == 403
    assert client.get("/admin/users/childprofile/add/").status_code == 403
    families.a1.refresh_from_db()
    assert (families.a1.nickname, families.a1.active) == ("Zinnia-A1", True)


def test_staff_need_the_explicit_view_permission(families):
    _, plain = _staff("catalog-editor")
    assert plain.get("/admin/users/childprofile/").status_code == 403
    assert plain.get("/admin/users/parentrecord/").status_code == 403
    _, granted = _staff("support-agent", permission="view_childprofile")
    assert granted.get("/admin/users/childprofile/").status_code == 200


def test_parent_records_list_parents_only(families):
    staff, client = _staff("support-lead", superuser=True)
    page = client.get("/admin/users/parentrecord/").content.decode()
    assert str(families.a.pk) in page and str(staff.pk) not in page
