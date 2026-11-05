"""SM-P2-03 and SM-P2-08: Django Admin sound management, permissions and audit."""

import pytest
from django.contrib.admin.models import LogEntry
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client

from apps.assets.tests.helpers import make_definition
from apps.audio import services
from apps.audio.admin import CueForm, SoundCueAdmin
from apps.audio.management.commands.ensure_sound_roles import (
    EDITOR_PERMISSIONS,
    EDITORS,
    PUBLISHER_PERMISSIONS,
    PUBLISHERS,
)
from apps.audio.models import SoundAssignment, SoundCue, SoundRelease
from apps.audio.tests.helpers import audio_asset, cue
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CUES = "/admin/audio/soundcue/"
RELEASES = "/admin/audio/soundrelease/"
ASSIGNMENTS = "/admin/audio/soundassignment/"


def staff(username, *groups, superuser=False):
    account = ParentAccount.objects.create(
        cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
        admin_username=username,
        is_staff=True,
        is_superuser=superuser,
    )
    account.groups.set(Group.objects.filter(name__in=groups))
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client, account


@pytest.fixture
def editor():
    return staff("edith", EDITORS)


@pytest.fixture
def publisher():
    return staff("paula", PUBLISHERS)


def cue_form(asset, **fields):
    data = {
        "cue_id": "sfx.coin.collect",
        "name": "Coin collect",
        "description": "",
        "channel": "sfx",
        "enabled": "on",
        "asset": asset.pk,
        "volume": "0.9",
        "cooldown_ms": "0",
        "fade_in_ms": "0",
        "fade_out_ms": "0",
        "spatial_mode": "default",
    }
    data.update(fields)
    return data


# --- roles ----------------------------


def test_the_roles_have_exactly_the_documented_permissions_and_are_idempotent():
    call_command("ensure_sound_roles", verbosity=0)
    call_command("ensure_sound_roles", verbosity=0)
    for name, expected in ((EDITORS, EDITOR_PERMISSIONS), (PUBLISHERS, PUBLISHER_PERMISSIONS)):
        group = Group.objects.get(name=name)
        granted = {f"{p.content_type.app_label}.{p.codename}" for p in group.permissions.all()}
        assert granted == set(expected)
    assert "audio.publish_soundrelease" not in EDITOR_PERMISSIONS
    assert "audio.rollback_soundrelease" not in EDITOR_PERMISSIONS


def test_an_editor_cannot_upload_or_publish_audio_files():
    # Authoring the files stays in the Asset Library.
    assert not any("assetversion" in p and "add" in p for p in PUBLISHER_PERMISSIONS)
    assert "assets.publish_assetversion" not in PUBLISHER_PERMISSIONS


# --- access ----------------------------


def test_anonymous_users_and_parents_cannot_open_the_sound_admin():
    assert Client().get(CUES).status_code == 302
    parent = ParentAccount.objects.get_or_create_for_cognito("sub-parent")
    assert parent.is_staff is False  # a Cognito parent has no admin session at all
    assert Client().get(RELEASES).status_code == 302
    assert Client().get(ASSIGNMENTS).status_code == 302


def test_staff_without_a_sound_group_see_nothing():
    client, _ = staff("nobody")
    assert client.get(CUES).status_code == 403
    assert client.get(RELEASES).status_code == 403
    assert client.get(ASSIGNMENTS).status_code == 403


def test_an_editor_can_list_create_and_edit_cues(editor):
    client, _ = editor
    asset, _ = audio_asset("coin-clink")
    assert client.get(CUES).status_code == 200
    response = client.post(f"{CUES}add/", cue_form(asset))
    assert response.status_code == 302, response.content.decode()[:500]
    created = SoundCue.objects.get(cue_id="sfx.coin.collect")
    assert created.created_by is not None and created.volume == 0.9
    change = f"{CUES}{created.pk}/change/"
    page = client.get(change)
    assert page.status_code == 200 and b"<audio" in page.content  # the Asset Library player
    data = cue_form(asset, volume="0.4")
    data.pop("cue_id")
    data.pop("channel")
    assert client.post(change, data).status_code == 302
    created.refresh_from_db()
    assert created.volume == 0.4
    assert LogEntry.objects.filter(object_id=str(created.pk)).count() >= 2


def test_the_admin_rejects_a_cue_for_an_asset_that_is_not_audio(editor):
    client, _ = editor
    prop = make_definition("treasure-chest", kind="prop", category="prop")
    response = client.post(f"{CUES}add/", cue_form(prop))
    assert response.status_code == 200 and not SoundCue.objects.exists()
    form = CueForm()
    assert prop not in form.fields["asset"].queryset


def test_the_asset_choices_are_active_audio_assets_only():
    audio, _ = audio_asset("coin-clink")
    make_definition("some-model", kind="prop", category="prop")
    from apps.assets import services as asset_services

    retired, _ = audio_asset("old-sound", seconds=2)
    asset_services.retire_asset(retired)
    assert list(CueForm().fields["asset"].queryset) == [audio]


def test_a_cue_id_and_channel_are_read_only_once_created(editor):
    client, _ = editor
    obj = cue("sfx.coin.collect")
    page = client.get(f"{CUES}{obj.pk}/change/")
    assert b'name="cue_id"' not in page.content and b'name="channel"' not in page.content


def test_the_list_filters_and_searches(editor):
    client, _ = editor
    cue("sfx.coin.collect")
    cue("ui.menu.select")
    assert b"sfx.coin.collect" in client.get(CUES, {"channel__exact": "sfx"}).content
    assert b"ui.menu.select" not in client.get(CUES, {"channel__exact": "sfx"}).content
    assert b"ui.menu.select" in client.get(CUES, {"q": "menu"}).content


def test_the_list_shows_publishing_status_and_blocked_references(editor, publisher):
    client, _ = editor
    obj = cue("sfx.coin.collect")
    assert b"Not published" in client.get(CUES).content
    services.publish(None)
    assert b"Published" in client.get(CUES).content
    obj.volume = 0.2
    obj.save()
    assert b"Changes not yet published" in client.get(CUES).content
    from apps.assets import services as asset_services

    asset_services.retire_asset(obj.asset)
    page = client.get(f"{CUES}{obj.pk}/change/").content.decode()
    assert "blocked" in page and "retired" in page


def test_enable_and_disable_actions(editor):
    client, _ = editor
    obj = cue("sfx.coin.collect")
    client.post(CUES, {"action": "disable_cues", "_selected_action": [obj.pk]})
    obj.refresh_from_db()
    assert obj.enabled is False
    client.post(CUES, {"action": "enable_cues", "_selected_action": [obj.pk]})
    obj.refresh_from_db()
    assert obj.enabled is True


def test_an_editor_can_create_an_assignment_but_invalid_ones_are_refused(editor, treasure):
    client, _ = editor
    obj = cue("sfx.chest.open")
    good = {
        "region": treasure.region.pk,
        "target_type": "chest",
        "target_id": treasure.chest.entity_id,
        "event": "on_open",
        "cue": obj.pk,
        "priority": "0",
        "enabled": "on",
        "note": "",
    }
    assert client.post(f"{ASSIGNMENTS}add/", good).status_code == 302
    assert SoundAssignment.objects.get().channel == "sfx"
    bad = {**good, "event": "on_enter"}
    response = client.post(f"{ASSIGNMENTS}add/", bad)
    assert response.status_code == 200 and b"cannot raise" in response.content
    assert SoundAssignment.objects.count() == 1


# --- publishing through the admin ----------------------------


def test_an_editor_cannot_publish_or_roll_back(editor):
    client, _ = editor
    cue("sfx.coin.collect")
    assert client.get(f"{RELEASES}publish/").status_code == 403
    assert client.post(f"{RELEASES}publish/", {"note": "x"}).status_code == 403
    assert not SoundRelease.objects.exists()
    page = client.get(RELEASES).content.decode()
    assert "Publish the sound library" not in page


def test_a_publisher_sees_problems_then_publishes_and_it_is_logged(publisher):
    client, account = publisher
    from apps.assets.tests.helpers import make_definition

    cue("sfx.bad.one", make_definition("not-ready", kind="audio", category="sound"))
    page = client.get(f"{RELEASES}publish/")
    assert page.status_code == 200 and b"cannot be published yet" in page.content
    assert client.post(f"{RELEASES}publish/", {"note": "try"}).status_code == 200
    assert not SoundRelease.objects.exists()

    SoundCue.objects.all().delete()
    cue("sfx.coin.collect")
    response = client.post(f"{RELEASES}publish/", {"note": "first"})
    assert response.status_code == 302
    release = SoundRelease.objects.get()
    assert release.published_by == account and release.note == "first" and release.number == 1
    assert LogEntry.objects.filter(user=account, object_id=str(release.pk)).exists()
    assert release.status == "LIVE"
    assert client.get(RELEASES).status_code == 200


def test_releases_cannot_be_added_changed_or_deleted_by_hand(publisher):
    client, _ = publisher
    cue("sfx.coin.collect")
    services.publish(None)
    release = SoundRelease.objects.get()
    assert client.get(f"{RELEASES}add/").status_code == 403
    assert client.post(f"{RELEASES}{release.pk}/change/", {"note": "x"}).status_code == 403
    assert client.post(f"{RELEASES}{release.pk}/delete/", {"post": "yes"}).status_code == 403
    assert client.get(f"{RELEASES}{release.pk}/change/").status_code == 200  # read-only view


def test_the_rollback_action_is_for_publishers_only(editor, publisher):
    obj = cue("sfx.coin.collect")
    first = services.publish(None)
    obj.volume = 0.1
    obj.save()
    services.publish(None)

    editor_client, _ = editor
    page = editor_client.get(RELEASES).content.decode()
    assert "roll_back" not in page
    editor_client.post(RELEASES, {"action": "roll_back", "_selected_action": [first.pk]})
    assert SoundRelease.objects.count() == 2

    publisher_client, account = publisher
    publisher_client.post(RELEASES, {"action": "roll_back", "_selected_action": [first.pk]})
    live = services.live_release()
    assert live.number == 3 and live.rolled_back_from == first and live.published_by == account
    assert LogEntry.objects.filter(user=account, object_id=str(live.pk)).exists()


def test_rollback_needs_exactly_one_release(publisher):
    client, _ = publisher
    cue("sfx.coin.collect")
    services.publish(None)
    client.post(RELEASES, {"action": "roll_back", "_selected_action": []})
    assert SoundRelease.objects.count() == 1


def test_a_superuser_needs_no_group(treasure):
    client, _ = staff("root", superuser=True)
    assert client.get(CUES).status_code == 200
    assert client.get(f"{RELEASES}publish/").status_code == 200


def test_the_cue_admin_is_registered_with_the_expected_search_and_filters():
    from django.contrib import admin

    model_admin = admin.site._registry[SoundCue]
    assert isinstance(model_admin, SoundCueAdmin)
    assert {"cue_id", "name"} <= set(model_admin.search_fields)
    assert {"channel", "enabled"} <= set(model_admin.list_filter)
