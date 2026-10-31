"""Parent and child profile management in Django (LAI-CHILD-001).

`PATCH /api/v1/me/`, the child CRUD routes under both authentication providers (ADR-038), the
archival policy (deactivate; hard deletion stays blocked by LAI-0209), the read-only audited
Django Admin view (ADR-039), and the Amplify profile import. The LAI-0403 checklist for the
child routes themselves is in test_children_api.py and test_tenant_isolation.py.
"""

import json
import logging
import secrets
import uuid

import pytest
from django.contrib.auth.models import Permission
from django.core.management import CommandError, call_command
from django.test import Client

from apps.users import amplify_import, services
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ChildProfile, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"
CHILDREN = "/api/v1/children/"
CSRF = "/api/v1/auth/csrf/"
LOGIN = "/api/v1/auth/login/"
NEW_CHILD = {
    "nickname": "Marigold",
    "ageBand": "SPROUT",
    "avatarKey": "OWL",
    "interests": ["Space", "Ocean"],
    "readingMode": "VOICE_FIRST",
    "sessionMinutes": 6,
}


def detail(child_id):
    return f"{CHILDREN}{child_id}/"


def patch(client, url, body, **headers):
    return client.patch(url, json.dumps(body), content_type="application/json", **headers)


def code_of(response):
    return response.json()["error"]["code"]


class LocalBrowser:
    """A local Django sign-in, the way the React app holds it: session cookie plus CSRF header."""

    def __init__(self, username):
        self.password = secrets.token_urlsafe(18)
        self.account = ParentAccount.objects.create_local_parent(username, self.password)
        self.client = Client(enforce_csrf_checks=True, raise_request_exception=False)
        self._csrf()
        response = self.client.post(
            LOGIN,
            json.dumps({"username": username, "password": self.password}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=self.token,
        )
        assert response.status_code == 200
        self._csrf()

    def _csrf(self):
        self.token = self.client.get(CSRF).json()["csrfToken"]

    def get(self, url):
        return self.client.get(url)

    def post(self, url, body):
        return self.client.post(
            url, json.dumps(body), content_type="application/json", HTTP_X_CSRFTOKEN=self.token
        )

    def patch(self, url, body):
        return patch(self.client, url, body, HTTP_X_CSRFTOKEN=self.token)

    def delete(self, url):
        return self.client.delete(url, HTTP_X_CSRFTOKEN=self.token)


@pytest.fixture
def local_mode(settings):
    settings.AUTH_PROVIDER = "django"
    return settings


@pytest.fixture(params=["cognito", "django"])
def signed_in(request, settings, api):
    """The same parent workflow under each provider: (client, account)."""
    if request.param == "django":
        settings.AUTH_PROVIDER = "django"
        browser = LocalBrowser(f"parent-{uuid.uuid4().hex[:8]}")
        return browser, browser.account
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


# --- child profiles under both providers -------------------------------------------------------


def test_the_full_child_lifecycle_works_under_either_provider(signed_in):
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


def test_hard_deletion_stays_blocked_until_lai_0209_under_either_provider(signed_in):
    client, account = signed_in
    child_id = client.post(CHILDREN, NEW_CHILD).json()["id"]
    response = client.delete(detail(child_id))
    assert response.status_code == 403 and code_of(response) == "sensitive_action_unavailable"
    assert ChildProfile.objects.filter(pk=child_id, parent=account).exists()


def test_child_settings_are_validated_against_the_age_band(signed_in):
    client, _ = signed_in
    child_id = client.post(CHILDREN, NEW_CHILD).json()["id"]
    too_long = client.patch(detail(child_id), {"sessionMinutes": 30})
    assert too_long.status_code == 400 and "sessionMinutes" in too_long.json()["error"]["details"]
    assert ChildProfile.objects.get(pk=child_id).session_minutes == 6


def test_another_familys_child_is_hidden_under_either_provider(signed_in, families):
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


def test_a_local_parent_and_a_cognito_parent_never_see_each_others_children(
    local_mode, api, families
):
    browser = LocalBrowser("local-isolated")
    mine = browser.post(CHILDREN, NEW_CHILD).json()["id"]
    assert browser.get(detail(families.a1.pk)).status_code == 404
    local_mode.AUTH_PROVIDER = "cognito"
    assert api(families.a).get(detail(mine)).status_code == 404


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


# --- Amplify profile import --------------------------------------------------------------------


def amplify_child(child_id=None, owner_sub="sub-family-a", **overrides):
    item = {
        "id": str(child_id or uuid.uuid4()),
        "parentProfileId": "pp-a",
        "ownerSub": owner_sub,
        "nickname": "Imported",
        "ageBand": "EXPLORER",
        "avatarKey": "ROBOT",
        "interests": ["Robots", None],
        "readingMode": "INDEPENDENT",
        "sessionMinutes": 12,
        "active": True,
        "aiEnabled": None,
        "createdAt": "2026-05-01T09:30:00.000Z",
    }
    item.update(overrides)
    return item


def amplify_parent(amplify_id="pp-a", sub="sub-family-a", **overrides):
    item = {"id": amplify_id, "owner": f"{sub}::someone@example.invalid", "displayName": "Ada"}
    item.update(overrides)
    return item


def outcomes(plan, kind="child"):
    return [item.outcome for item in plan.outcomes if item.kind == kind]


def test_a_dry_run_plans_without_writing(families):
    export = {"parentProfiles": [amplify_parent()], "childProfiles": [amplify_child()]}
    plan = amplify_import.plan_import(export)
    assert outcomes(plan) == ["create"] and outcomes(plan, "parent") == ["update"]
    assert ChildProfile.objects.owned_by(families.a).count() == 2
    assert ParentAccount.objects.get(pk=families.a.pk).display_name == ""


def test_apply_keeps_the_amplify_id_owner_and_settings_and_is_idempotent(families):
    child_id = uuid.uuid4()
    export = {"parentProfiles": [amplify_parent()], "childProfiles": [amplify_child(child_id)]}
    amplify_import.apply_plan(amplify_import.plan_import(export))
    child = ChildProfile.objects.get(pk=child_id)
    assert child.parent_id == families.a.pk
    assert (child.age_band, child.interests, child.ai_enabled) == ("EXPLORER", ["Robots"], True)
    assert child.created_at.isoformat().startswith("2026-05-01T09:30")
    assert ParentAccount.objects.get(pk=families.a.pk).display_name == "Ada"

    again = amplify_import.plan_import(export)
    assert outcomes(again) == ["unchanged"] and outcomes(again, "parent") == ["unchanged"]
    amplify_import.apply_plan(again)
    assert ChildProfile.objects.owned_by(families.a).count() == 3


def test_conflicts_are_reported_never_overwritten(families):
    export = {
        "parentProfiles": [amplify_parent()],
        "childProfiles": [
            amplify_child(families.b1.pk),  # the id belongs to another family
            amplify_child(families.a1.pk, nickname="Renamed"),  # same owner, different settings
            amplify_child(nickname="zinnia-a1 ", ageBand="PATHFINDER", sessionMinutes=10),
            amplify_child(owner_sub="sub-family-b", parentProfileId="pp-a"),  # owners disagree
            amplify_child(owner_sub=None, parentProfileId="unknown"),
            amplify_child(owner_sub="sub-nobody", parentProfileId=None),
            amplify_child(sessionMinutes=99),
            amplify_child("not-a-uuid"),
        ],
    }
    plan = amplify_import.plan_import(export)
    assert outcomes(plan) == [
        "conflict_other_parent",
        "differs",
        "possible_duplicate",
        "owner_mismatch",
        "unresolved_owner",
        "parent_not_provisioned",
        "invalid",
        "invalid_id",
    ]
    amplify_import.apply_plan(plan)
    families.a1.refresh_from_db()
    families.b1.refresh_from_db()
    assert (families.a1.nickname, families.b1.parent_id) == ("Zinnia-A1", families.b.pk)
    assert ChildProfile.objects.count() == 4


def test_the_three_profile_cap_holds_across_existing_and_planned_children(families):
    export = {"childProfiles": [amplify_child(nickname=f"New {n}") for n in range(2)]}
    assert outcomes(amplify_import.plan_import(export)) == ["create", "limit_reached"]


def test_parents_are_provisioned_only_when_asked_and_never_matched_by_email(families):
    export = {
        "parentProfiles": [amplify_parent("pp-new", "sub-brand-new", owner="sub-brand-new::a@b.c")],
        "childProfiles": [amplify_child(owner_sub=None, parentProfileId="pp-new")],
    }
    assert outcomes(amplify_import.plan_import(export)) == ["parent_not_provisioned"]
    plan = amplify_import.plan_import(export, provision_parents=True)
    assert outcomes(plan) == ["create"]
    amplify_import.apply_plan(plan)
    created = ParentAccount.objects.get(cognito_sub="sub-brand-new")
    assert ChildProfile.objects.owned_by(created).count() == 1
    assert created.display_name == "Ada"


def test_an_inactive_account_is_never_an_import_target(families):
    ParentAccount.objects.filter(pk=families.a.pk).update(is_active=False)
    assert outcomes(amplify_import.plan_import({"childProfiles": [amplify_child()]})) == [
        "account_not_eligible"
    ]


def test_the_report_carries_ids_and_outcomes_only(families, tmp_path):
    export = tmp_path / "export.json"
    report = tmp_path / "report.json"
    export.write_text(
        json.dumps(
            {
                "parentProfiles": [amplify_parent()],
                "childProfiles": [amplify_child(avatarPhotoKey="child-photos/x/y.jpg")],
            }
        )
    )
    call_command("import_amplify_profiles", str(export), "--report", str(report))
    text = report.read_text()
    body = json.loads(text)
    assert body["applied"] is False and body["photosLeftInAmplifyStorage"] == 1
    for secret in ("Imported", "Ada", "sub-family-a", "example.invalid", "child-photos"):
        assert secret not in text
    assert ChildProfile.objects.count() == 4


def test_the_command_applies_only_with_apply_and_rejects_a_bad_file(families, tmp_path):
    export = tmp_path / "export.json"
    export.write_text(json.dumps({"childProfiles": [amplify_child()]}))
    call_command("import_amplify_profiles", str(export), "--apply")
    assert ChildProfile.objects.owned_by(families.a).count() == 3
    export.write_text(json.dumps({"childProfiles": {"not": "a list"}}))
    with pytest.raises(CommandError):
        call_command("import_amplify_profiles", str(export))
    export.write_text("{not json")
    with pytest.raises(CommandError):
        call_command("import_amplify_profiles", str(export))


def test_import_lookups_are_not_exposed_by_any_view():
    """The cross-family lookups are for the import only."""
    from pathlib import Path

    apps_root = Path(services.__file__).resolve().parent.parent
    offenders = [
        str(path)
        for path in apps_root.rglob("*.py")
        if "tests" not in path.parts
        and path.name not in {"services.py", "amplify_import.py"}
        and (
            "child_profile_for_import" in path.read_text()
            or "import_child_profile" in path.read_text()
        )
    ]
    assert offenders == []
