"""Django Admin content authoring (ADR-047, LAI-0801 first stage): who may draft, publish,
discard and restore, and that every step goes through the authoring service."""

import json

import pytest
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.management.commands.ensure_content_roles import DEVELOPERS, EDITORS, PUBLISHERS
from apps.catalog.models import ContentAuthority, Location, RevisionStatus
from apps.catalog.tests.helpers import write_export
from apps.catalog.tests.test_authoring import collections_with_npc
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]
BACKEND = "apps.users.backends.AdminPasswordBackend"


@pytest.fixture
def bay(tmp_path):
    import_content(write_export(tmp_path / "v1", collections_with_npc()))
    call_command("ensure_content_roles", stdout=None)
    return Location.objects.get(slug="bay")


def staff(name, *groups, superuser=False):
    account = ParentAccount.objects.create(
        cognito_sub=f"django-admin-only:{name}",
        admin_username=name,
        is_staff=True,
        is_superuser=superuser,
    )
    for group in groups:
        account.groups.add(Group.objects.get(name=group))
    client = Client()
    client.force_login(account, backend=BACKEND)
    return account, client


def new_draft_url(row):
    content_type = ContentType.objects.get_for_model(type(row))
    return reverse("admin:catalog_contentrevision_new_draft", args=[content_type.pk, row.pk])


def act_url(revision, action):
    return reverse("admin:catalog_contentrevision_act", args=[revision.pk, action])


def change_url(revision):
    return reverse("admin:catalog_contentrevision_change", args=[revision.pk])


def start_draft(client, row):
    response = client.post(new_draft_url(row))
    assert response.status_code == 302
    return authoring.revisions_for(row).get(status=RevisionStatus.DRAFT)


def save_body(client, revision, body, note="Wording"):
    return client.post(change_url(revision), {"body": json.dumps(body), "note": note})


def test_a_publisher_edits_and_publishes_from_the_admin(bay):
    account, client = staff("ana", EDITORS, PUBLISHERS, DEVELOPERS)
    record_page = client.get(reverse("admin:catalog_location_change", args=[bay.pk]))
    assert b"Edit content (start a draft)" in record_page.content
    assert client.get(new_draft_url(bay)).status_code == 200  # the confirmation page

    draft = start_draft(client, bay)
    body = {**draft.body, "title": "Sunny Bay"}
    assert save_body(client, draft, body).status_code == 302
    draft.refresh_from_db()
    assert draft.body["title"] == "Sunny Bay" and draft.validation_report == []
    assert Location.objects.get(pk=bay.pk).title == "The Bay"

    assert client.post(act_url(draft, "publish")).status_code == 302

    bay.refresh_from_db()
    draft.refresh_from_db()
    assert bay.title == "Sunny Bay" and bay.authority == ContentAuthority.DJANGO
    assert draft.published_by == account


def test_an_editor_can_draft_but_not_publish(bay):
    _, client = staff("ed", EDITORS, DEVELOPERS)
    draft = start_draft(client, bay)
    save_body(client, draft, {**draft.body, "title": "Edited"})

    assert client.post(act_url(draft, "publish")).status_code == 403
    assert Location.objects.get(pk=bay.pk).title == "The Bay"
    assert client.post(act_url(draft, "discard")).status_code == 302
    draft.refresh_from_db()
    assert draft.status == RevisionStatus.DISCARDED


def test_staff_without_a_content_role_can_only_look(bay):
    _, client = staff("viewer")
    assert client.post(new_draft_url(bay)).status_code == 403
    revision = authoring.revisions_for(bay).get()
    assert client.get(change_url(revision)).status_code == 200
    assert client.post(act_url(revision, "restore")).status_code == 403


def test_an_invalid_draft_is_refused_and_changes_nothing(bay):
    _, client = staff("ana", EDITORS, PUBLISHERS, DEVELOPERS)
    draft = start_draft(client, bay)
    save_body(client, draft, {**draft.body, "title": "Sunny — Bay"})

    response = client.post(act_url(draft, "publish"), follow=True)

    assert b"em dash" in response.content and b"Nothing was changed" in response.content
    bay.refresh_from_db()
    assert bay.title == "The Bay" and bay.authority == ContentAuthority.EXPORT


def test_a_superseded_version_can_be_restored_and_nothing_is_deleted(bay):
    _, client = staff("root", superuser=True)
    draft = start_draft(client, bay)
    save_body(client, draft, {**draft.body, "title": "Sunny Bay"})
    client.post(act_url(draft, "publish"))
    first = authoring.revisions_for(bay).get(number=1)

    client.post(act_url(first, "restore"))

    bay.refresh_from_db()
    assert bay.title == "The Bay"
    assert authoring.revisions_for(bay).count() == 3
    delete = reverse("admin:catalog_contentrevision_delete", args=[first.pk])
    assert client.post(delete, {"post": "yes"}).status_code == 403


def test_a_published_version_cannot_be_edited_through_its_page(bay):
    _, client = staff("root", superuser=True)
    revision = authoring.revisions_for(bay).get()
    client.post(change_url(revision), {"body": json.dumps({"slug": "bay"}), "note": "x"})
    revision.refresh_from_db()
    assert revision.body == bay.source


def test_ensure_content_roles_is_idempotent(bay):
    call_command("ensure_content_roles", stdout=None)
    assert Group.objects.get(name=PUBLISHERS).permissions.count() == 3
    assert Group.objects.get(name=EDITORS).permissions.count() == 2
    assert Group.objects.get(name=DEVELOPERS).permissions.count() == 3


def test_the_review_steps_work_through_the_admin_pages(bay):
    _, writer = staff("writer", EDITORS, DEVELOPERS)
    boss_account, boss = staff("boss", EDITORS, PUBLISHERS)
    draft = start_draft(writer, bay)
    save_body(writer, draft, {**draft.body, "title": "Sunny Bay"})

    assert writer.post(act_url(draft, "submit")).status_code == 302
    draft.refresh_from_db()
    assert draft.status == RevisionStatus.SUBMITTED
    assert b"Return to author" in boss.get(change_url(draft)).content
    assert b"Return to author" not in writer.get(change_url(draft)).content

    # An editor cannot approve or return; the approver must give a reason.
    assert writer.post(act_url(draft, "publish")).status_code == 403
    assert writer.post(act_url(draft, "reject"), {"reason": "no"}).status_code == 403
    response = boss.post(act_url(draft, "reject"), {"reason": ""}, follow=True)
    assert b"Say why" in response.content
    boss.post(act_url(draft, "reject"), {"reason": "Simpler word please"})
    draft.refresh_from_db()
    assert (draft.status, draft.rejection_reason) == (
        RevisionStatus.REJECTED,
        "Simpler word please",
    )
    assert b"Simpler word please" in writer.get(change_url(draft)).content

    assert writer.post(act_url(draft, "reopen")).status_code == 302
    assert writer.post(act_url(draft, "submit")).status_code == 302
    assert boss.post(act_url(draft, "publish")).status_code == 302
    bay.refresh_from_db()
    assert (
        bay.title == "Sunny Bay"
        and boss_account.pk == authoring.revisions_for(bay).first().published_by_id
    )


def test_the_admin_refuses_unsafe_text_with_its_reason(bay):
    _, client = staff("ana", EDITORS, PUBLISHERS, DEVELOPERS)
    draft = start_draft(client, bay)
    save_body(client, draft, {**draft.body, "tagline": "Please share your home address."})

    response = client.post(act_url(draft, "submit"), follow=True)

    assert b"child-safety check" in response.content
    draft.refresh_from_db()
    assert draft.status == RevisionStatus.DRAFT


def test_unknown_actions_and_get_requests_are_refused(bay):
    _, client = staff("ana", EDITORS, PUBLISHERS, DEVELOPERS)
    draft = start_draft(client, bay)
    assert client.post(act_url(draft, "explode")).status_code == 403
    assert client.get(act_url(draft, "publish")).status_code == 403


# --- LAI-0801: the structured editor, preview, raw JSON permission, exported version -----------


def edit_url(revision):
    return reverse("admin:catalog_contentrevision_edit", args=[revision.pk])


def preview_url(revision):
    return reverse("admin:catalog_contentrevision_preview", args=[revision.pk])


def test_an_editor_without_the_json_permission_gets_the_structured_form(bay):
    _, client = staff("ed", EDITORS)
    draft = start_draft(client, bay)
    response = client.get(edit_url(draft))
    assert response.status_code == 200
    assert b'name="f|title"' in response.content and b"Save and check" in response.content

    # The same person cannot save raw JSON through the version page.
    save_body(client, draft, {**draft.body, "title": "By JSON"})
    draft.refresh_from_db()
    assert draft.body["title"] == "The Bay"

    response = client.post(
        edit_url(draft), {"f|title": "Sunny Bay", "note": "wording"}, follow=True
    )
    assert b"Saved" in response.content
    draft.refresh_from_db()
    assert draft.body["title"] == "Sunny Bay" and draft.note == "wording"
    assert draft.body["slug"] == "bay"


def test_starting_a_draft_sends_a_structured_editor_to_the_form_and_a_developer_to_json(bay):
    _, editor = staff("ed", EDITORS)
    _, developer = staff("dev", EDITORS, DEVELOPERS)
    assert editor.post(new_draft_url(bay)).url.endswith("/edit/")
    draft = authoring.revisions_for(bay).get(status=RevisionStatus.DRAFT)
    authoring.discard(draft, user=ParentAccount.objects.get(admin_username="ed"))
    assert developer.post(new_draft_url(bay)).url.endswith("/change/")


def test_the_form_reports_problems_on_the_field_and_adds_and_removes_rows(bay):
    _, client = staff("ed", EDITORS)
    draft = start_draft(client, bay)

    client.post(edit_url(draft), {"f|title": "Sunny — Bay"})
    draft.refresh_from_db()
    assert draft.validation_report and "em dash" in draft.validation_report[0]
    page = client.get(edit_url(draft)).content
    assert b"em dash" in page

    response = client.post(
        edit_url(draft), {"f|title": "Sunny Bay", "f|skills": "A\nB", "op": "add|nope"}
    )
    assert b"could not be applied" in response.content
    draft.refresh_from_db()
    assert draft.body["title"] == "Sunny — Bay"  # nothing was saved


def test_staff_who_can_only_look_cannot_open_the_editor(bay):
    _, editor = staff("ed", EDITORS)
    draft = start_draft(editor, bay)
    _, viewer = staff("viewer")
    assert viewer.get(edit_url(draft)).status_code == 403
    assert viewer.post(edit_url(draft), {"f|title": "x"}).status_code == 403
    assert viewer.get(preview_url(draft)).status_code == 200  # looking is allowed


def test_a_published_version_has_no_editor(bay):
    _, client = staff("ana", EDITORS, PUBLISHERS)
    revision = authoring.revisions_for(bay).get()
    response = client.get(edit_url(revision))
    assert response.status_code == 302 and response.url.endswith("/change/")


def test_the_preview_filters_by_age_band(bay):
    _, client = staff("ed", EDITORS)
    draft = start_draft(client, bay)
    page = client.get(preview_url(draft) + "?band=SPROUT").content
    assert b"The Bay" in page
    assert client.get(preview_url(draft) + "?band=NOPE").status_code == 200


def test_use_the_exported_version_returns_a_django_owned_record_to_the_export(bay, tmp_path):
    from apps.catalog.importer import import_content

    _, client = staff("ana", EDITORS, PUBLISHERS)
    draft = start_draft(client, bay)
    client.post(edit_url(draft), {"f|title": "Admin Bay"})
    client.post(act_url(draft, "publish"))
    bay.refresh_from_db()
    assert bay.authority == ContentAuthority.DJANGO

    changed = collections_with_npc()
    changed["locations.json"]["locations"][0]["title"] = "Exported Bay"
    import_content(write_export(tmp_path / "v2", changed))
    bay.refresh_from_db()
    assert bay.title == "Admin Bay"  # the import kept the administrator's edit

    summary = client.get(reverse("admin:catalog_location_change", args=[bay.pk])).content
    assert b"Use the exported version" in summary
    content_type = ContentType.objects.get_for_model(type(bay))
    url = reverse("admin:catalog_contentrevision_use_export", args=[content_type.pk, bay.pk])
    assert client.get(url).status_code == 200
    assert client.post(url).status_code == 302

    kept = authoring.revisions_for(bay).get(status=RevisionStatus.DRAFT)
    assert kept.body["title"] == "Exported Bay"
    assert client.post(act_url(kept, "publish")).status_code == 302
    bay.refresh_from_db()
    assert bay.title == "Exported Bay" and bay.authority == ContentAuthority.EXPORT


def test_use_the_exported_version_is_refused_for_editors_without_permission_and_when_unchanged(bay):
    _, viewer = staff("viewer")
    content_type = ContentType.objects.get_for_model(type(bay))
    url = reverse("admin:catalog_contentrevision_use_export", args=[content_type.pk, bay.pk])
    assert viewer.post(url).status_code == 403
    _, editor = staff("ed", EDITORS)
    response = editor.post(url, follow=True)
    assert b"already the published one" in response.content
