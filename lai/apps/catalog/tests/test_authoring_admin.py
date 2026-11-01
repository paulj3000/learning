"""Django Admin content authoring (ADR-043, LAI-0801 first stage): who may draft, publish,
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
from apps.catalog.management.commands.ensure_content_roles import EDITORS, PUBLISHERS
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
    account, client = staff("ana", EDITORS, PUBLISHERS)
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
    _, client = staff("ed", EDITORS)
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
    _, client = staff("ana", EDITORS, PUBLISHERS)
    draft = start_draft(client, bay)
    save_body(client, draft, {**draft.body, "title": "Sunny — Bay"})

    response = client.post(act_url(draft, "publish"), follow=True)

    assert b"em dash" in response.content and b"Nothing was published" in response.content
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
