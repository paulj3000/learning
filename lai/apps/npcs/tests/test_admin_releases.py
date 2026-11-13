"""LAI-NPC-005 / 035: validate, publish, roll back and retire NPC releases through Django Admin."""

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client

from apps.npcs.management.commands.ensure_npc_roles import EDITORS, PUBLISHERS
from apps.npcs.models import NpcRelease
from apps.npcs.publishing import publish
from apps.npcs.vocabulary import ReleaseStatus

from .helpers import make_behavior, make_character, make_dialogue, make_placement, make_staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

RELEASES = "/admin/npcs/npcrelease/"
VALIDATE = f"{RELEASES}validate/"
PUBLISH = f"{RELEASES}publish/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_npc_roles", verbosity=0)


def login(username, *groups):
    account = make_staff(username)
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    client.account = account
    return client


@pytest.fixture
def editor():
    return login("rel-editor", EDITORS)


@pytest.fixture
def publisher():
    return login("rel-publisher", PUBLISHERS)


def ready_world(npc_id="pip-admin"):
    character = make_character(npc_id)
    make_dialogue(character)
    make_placement(character, behavior=make_behavior())
    return character


def test_validate_page_reports_ready_problems_and_unchanged(editor, publisher):
    character = ready_world()
    text = editor.get(VALIDATE).content.decode()
    assert 'id="npc-ready"' in text
    assert "Publish a new release" not in text  # editors validate but cannot publish
    assert "Ask an NPC publisher" in text
    assert "Publish a new release" in publisher.get(VALIDATE).content.decode()

    publish(publisher.account)
    assert 'id="npc-unchanged"' in editor.get(VALIDATE).content.decode()

    variant = character.variants.get()
    variant.animation_map = {"idle": "Sleep"}
    variant.save()
    text = editor.get(VALIDATE).content.decode()
    assert 'id="npc-problems"' in text and "idle uses clip &#x27;Sleep&#x27;" in text


def test_editors_cannot_publish_roll_back_or_retire(editor, publisher):
    ready_world()
    assert editor.post(PUBLISH, {"notes": "x"}).status_code == 403
    assert not NpcRelease.objects.exists()
    release = publish(publisher.account)
    assert editor.post(f"{RELEASES}{release.pk}/rollback/").status_code == 403
    assert editor.post(f"{RELEASES}{release.pk}/retire/").status_code == 403
    release.refresh_from_db()
    assert release.status == ReleaseStatus.ACTIVE
    page = editor.get(f"{RELEASES}{release.pk}/change/").content.decode()
    assert "Retire this release" not in page
    assert "pip-admin-model" in page  # asset dependencies are listed


def test_staff_without_a_role_and_anonymous_cannot_reach_release_pages():
    ready_world()
    stranger = login("stranger")
    assert stranger.get(VALIDATE).status_code == 403
    assert stranger.post(PUBLISH).status_code == 403
    response = Client().post(PUBLISH)
    assert response.status_code == 302 and "/login/" in response["Location"]
    assert not NpcRelease.objects.exists()


def test_publisher_publishes_from_the_admin(publisher):
    ready_world()
    assert publisher.get(PUBLISH).status_code == 405  # POST only
    response = publisher.post(PUBLISH, {"notes": "First NPCs"}, follow=True)
    release = NpcRelease.objects.get()
    assert release.status == ReleaseStatus.ACTIVE and release.notes == "First NPCs"
    assert release.created_by == publisher.account
    text = response.content.decode()
    assert "Published NPC release 1" in text
    assert "rel-publisher" in text  # created by, staff label only

    response = publisher.post(PUBLISH, {"notes": "again"}, follow=True)
    assert "Nothing changed since the active release" in response.content.decode()
    assert NpcRelease.objects.count() == 1


def test_failed_publish_writes_nothing_and_lists_the_problems(publisher):
    character = ready_world()
    variant = character.variants.get()
    variant.animation_map = {"talk": "Yell"}
    variant.save()
    response = publisher.post(PUBLISH, {"notes": "broken"})
    assert response.status_code == 200
    text = response.content.decode()
    assert "Not published: 1 problem(s) must be fixed first" in text
    assert "publishing was refused and nothing changed" in text
    assert "talk uses clip &#x27;Yell&#x27;" in text
    assert not NpcRelease.objects.exists()


def test_publisher_rolls_back_and_retires(publisher):
    character = ready_world()
    first = publish(publisher.account)
    character.definition.display_name = "Pip Again"
    character.definition.save()
    second = publish(publisher.account)

    page = publisher.get(f"{RELEASES}{first.pk}/change/").content.decode()
    assert "Roll back to this release" in page
    assert publisher.get(f"{RELEASES}{first.pk}/rollback/").status_code == 405

    response = publisher.post(f"{RELEASES}{first.pk}/rollback/", follow=True)
    assert "NPC release 1 rolled back." in response.content.decode()
    first.refresh_from_db()
    second.refresh_from_db()
    assert first.status == ReleaseStatus.ACTIVE and second.status == ReleaseStatus.SUPERSEDED

    response = publisher.post(f"{RELEASES}{first.pk}/rollback/", follow=True)
    assert "That release is already active." in response.content.decode()

    response = publisher.post(f"{RELEASES}{first.pk}/retire/", follow=True)
    text = response.content.decode()
    assert "NPC release 1 retired." in text and "children see no NPCs" in text
    first.refresh_from_db()
    assert first.status == ReleaseStatus.RETIRED

    response = publisher.post(f"{RELEASES}{first.pk}/rollback/", follow=True)
    assert "A retired release never comes back" in response.content.decode()


def test_rollback_refused_when_an_asset_was_retired_since(publisher):
    character = ready_world()
    first = publish(publisher.account)
    character.definition.display_name = "Pip Three"
    character.definition.save()
    publish(publisher.account)
    # Bypass the service guard to simulate an asset retired before guards existed.
    model = character.variants.get().model_asset
    type(model).objects.filter(pk=model.pk).update(status="RETIRED")
    response = publisher.post(f"{RELEASES}{first.pk}/rollback/", follow=True)
    assert "Not rolled back:" in response.content.decode()
    first.refresh_from_db()
    assert first.status == ReleaseStatus.SUPERSEDED


def test_releases_are_never_added_changed_or_deleted_in_the_admin(publisher):
    ready_world()
    release = publish(publisher.account)
    assert publisher.get(f"{RELEASES}add/").status_code == 403
    assert publisher.get(f"{RELEASES}{release.pk}/delete/").status_code == 403
    assert publisher.post(f"{RELEASES}{release.pk}/change/", {"notes": "edit"}).status_code == 403
    release.refresh_from_db()
    assert release.notes == ""
