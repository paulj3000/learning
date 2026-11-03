"""SM-P8-03: voice profiles and speech lines are managed in Django Admin only, by permission."""

from io import StringIO

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client

from apps.speech.management.commands.ensure_speech_roles import EDITORS, PERMISSIONS
from apps.speech.models import SpeechClip, SpeechLine, VoiceProfile
from apps.speech.tests.helpers import line, profile
from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

VOICES = "/admin/speech/voiceprofile/"
LINES = "/admin/speech/speechline/"


@pytest.fixture(autouse=True)
def roles():
    call_command("ensure_speech_roles", stdout=StringIO())


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


def voice_form(**fields):
    base = {
        "profile_id": "keeper-quill",
        "display_name": "Keeper Quill",
        "polly_voice_id": "Matthew",
        "language_code": "en-US",
        "engine": "neural",
        "speaking_rate_percent": "95",
        "character_id": "keeper-quill",
        "enabled": "on",
        "notes": "",
    }
    return {**base, **fields}


def test_the_group_has_exactly_the_speech_permissions():
    group = Group.objects.get(name=EDITORS)
    assert group.permissions.count() == len(PERMISSIONS)
    call_command("ensure_speech_roles", stdout=StringIO())  # idempotent
    assert Group.objects.filter(name=EDITORS).count() == 1


def test_an_editor_creates_a_voice_profile_with_audit_metadata():
    client, account = staff("edith", EDITORS)
    assert client.get(VOICES).status_code == 200
    assert client.post(f"{VOICES}add/", voice_form()).status_code == 302
    created = VoiceProfile.objects.get(profile_id="keeper-quill")
    assert created.created_by_id == account.pk and created.updated_by_id == account.pk


def test_an_unsupported_voice_engine_pair_is_refused_in_the_admin():
    client, _ = staff("edith", EDITORS)
    response = client.post(f"{VOICES}add/", voice_form(polly_voice_id="Kevin", engine="standard"))
    assert response.status_code == 200
    assert "does not support the standard engine" in response.content.decode()
    assert not VoiceProfile.objects.exists()


def test_a_voice_outside_the_allowed_list_cannot_even_be_chosen():
    client, _ = staff("edith", EDITORS)
    response = client.post(f"{VOICES}add/", voice_form(polly_voice_id="Zorp"))
    assert response.status_code == 200 and not VoiceProfile.objects.exists()


def test_a_profile_id_cannot_change_after_creation():
    client, _ = staff("edith", EDITORS)
    made = profile("chatty", "Ivy")
    client.post(
        f"{VOICES}{made.pk}/change/", voice_form(profile_id="renamed", display_name="Chatty")
    )
    made.refresh_from_db()
    assert made.profile_id == "chatty"


def test_an_editor_writes_a_line_and_a_bad_line_is_refused():
    client, _ = staff("edith", EDITORS)
    voice = profile()
    good = {
        "line_id": "quill-hello",
        "voice_profile": voice.pk,
        "text": "Hello!",
        "context": "castle",
        "enabled": "on",
    }
    assert client.post(f"{LINES}add/", good).status_code == 302
    bad = {**good, "line_id": "bad", "text": "Visit www.example.com"}
    response = client.post(f"{LINES}add/", bad)
    assert response.status_code == 200 and SpeechLine.objects.count() == 1


def test_clips_and_totals_are_read_only_and_show_no_text_or_keys():
    client, _ = staff("edith", EDITORS)
    assert client.get("/admin/speech/speechclip/").status_code == 200
    assert client.get("/admin/speech/speechclip/add/").status_code == 403
    assert client.get("/admin/speech/speechdailytotal/add/").status_code == 403
    from apps.speech.admin import SpeechClipAdmin

    shown = set(SpeechClipAdmin.fields)
    assert shown.isdisjoint({"cache_key", "storage_key", "owner_child_id"})
    assert SpeechClip._meta.get_field("characters")


def test_staff_without_the_group_and_anonymous_users_are_refused():
    client, _ = staff("nobody")
    assert client.get(VOICES).status_code in (302, 403)
    assert client.post(f"{VOICES}add/", voice_form()).status_code in (302, 403)
    assert Client().get(VOICES).status_code in (302, 403)
    line()
    assert VoiceProfile.objects.count() == 1
