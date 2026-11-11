"""LAI-NPC-027/028: pre-generating NPC dialogue speech into the shared cache (fake Polly only)."""

import logging

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.npcs.models import NpcDialogueNode
from apps.npcs.publishing import publish, retire
from apps.npcs.speech import pregenerate_release_speech, published_node, schedule_pregeneration
from apps.speech import services
from apps.speech.models import SpeechClip, SpeechDailyTotal
from apps.speech.polly import FakePollyClient, SpeechError, set_polly_client
from apps.speech.storage import reset_speech_storage_cache

from .helpers import make_asset, make_character, make_dialogue, make_staff
from .test_voice_validation import make_profile, voiced

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def fresh_speech():
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001
    yield
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001


@pytest.fixture
def staff():
    return make_staff()


def test_every_voiced_node_is_synthesized_once_into_the_shared_cache(staff):
    voiced()
    quiet = make_character("quiet-npc")
    make_dialogue(quiet)  # no voice profile: captions only, never synthesized
    release = publish(staff)
    fake = FakePollyClient()
    report = pregenerate_release_speech(release, client=fake)
    assert (report.synthesized, report.cached, report.failed) == (2, 0, 0)
    assert sorted(call["text"] for call in fake.calls) == ["Ahoy there, friend!", "See you soon!"]
    assert {call["voice_id"] for call in fake.calls} == {"Justin"}
    clips = SpeechClip.objects.all()
    assert clips.count() == 2
    assert all(c.scope == "authored" and c.owner_child_id is None for c in clips)
    assert all(c.expires_at is None for c in clips)
    assert SpeechDailyTotal.objects.get().characters_synthesized == report.characters_synthesized


def test_unchanged_text_is_never_synthesized_again(staff):
    character = voiced()
    first = publish(staff)
    pregenerate_release_speech(first, client=FakePollyClient())
    again = FakePollyClient()
    assert pregenerate_release_speech(first, client=again).cached == 2
    assert again.calls == []
    # A new release changing one line synthesizes only that line.
    NpcDialogueNode.objects.filter(dialogue__character=character, node_key="bye").update(
        text="Fair winds, friend!"
    )
    second = publish(staff)
    fake = FakePollyClient()
    report = pregenerate_release_speech(second, client=fake)
    assert (report.synthesized, report.cached) == (1, 1)
    assert [c["text"] for c in fake.calls] == ["Fair winds, friend!"]


def test_a_changed_voice_makes_a_new_clip(staff):
    character = voiced()
    release = publish(staff)
    pregenerate_release_speech(release, client=FakePollyClient())
    profile = character.voice_profile
    profile.speaking_rate_percent = 90
    profile.save()
    fake = FakePollyClient()
    assert pregenerate_release_speech(release, client=fake).synthesized == 2
    assert all(call["text_type"] == "ssml" for call in fake.calls)


def test_speech_switched_off_does_nothing(staff, settings):
    voiced()
    release = publish(staff)
    settings.LAI_SPEECH_PROVIDER = "disabled"
    fake = FakePollyClient()
    report = pregenerate_release_speech(release, client=fake)
    assert report.enabled is False and report.stopped == "speech_disabled"
    assert fake.calls == [] and not SpeechClip.objects.exists()


def test_failures_are_counted_and_logged_without_text_and_never_raise(staff, caplog):
    voiced()
    release = publish(staff)
    fake = FakePollyClient(fail_with=SpeechError("speech_unavailable", "x"))
    with caplog.at_level(logging.WARNING, logger="lai.npcs.speech"):
        report = pregenerate_release_speech(release, client=fake)
    assert (report.synthesized, report.failed) == (0, 2)
    assert "Ahoy" not in caplog.text and "speech_unavailable" in caplog.text
    assert all("Ahoy" not in p for p in report.problems)
    assert not SpeechClip.objects.exists()


def test_an_unexpected_error_is_swallowed(staff, monkeypatch):
    voiced()
    release = publish(staff)

    def boom(*args, **kwargs):
        raise RuntimeError("storage exploded")

    monkeypatch.setattr(services, "prepare_shared_clip", boom)
    report = pregenerate_release_speech(release, client=FakePollyClient())
    assert report.stopped == "error"


def test_the_global_daily_cap_stops_pregeneration(staff, settings):
    voiced()
    release = publish(staff)
    settings.LAI_SPEECH_GLOBAL_DAILY_CHARS = 5
    fake = FakePollyClient()
    report = pregenerate_release_speech(release, client=fake)
    assert report.stopped == "daily_cap" and fake.calls == []


def test_recorded_lines_and_unusable_profiles_are_skipped(staff):
    character = voiced()
    NpcDialogueNode.objects.filter(dialogue__character=character, node_key="bye").update(
        audio_asset=make_asset("pip-bye-line", "audio")
    )
    release = publish(staff)
    character.voice_profile.enabled = False
    character.voice_profile.save()
    report = pregenerate_release_speech(release, client=FakePollyClient())
    assert (report.recorded, report.skipped, report.synthesized) == (1, 1, 0)


def test_a_retired_release_is_not_pregenerated(staff):
    voiced()
    release = publish(staff)
    retire(release, staff)
    release.refresh_from_db()
    fake = FakePollyClient()
    assert pregenerate_release_speech(release, client=fake).stopped == "release_retired"
    assert fake.calls == []


def test_schedule_runs_after_commit(staff, django_capture_on_commit_callbacks):
    voiced()
    release = publish(staff)
    fake = FakePollyClient()
    set_polly_client(fake)
    with django_capture_on_commit_callbacks(execute=True):
        schedule_pregeneration(release)
    assert len(fake.calls) == 2


def test_published_node_reads_only_the_active_release(staff):
    character = voiced()
    first = publish(staff)
    assert published_node("pip-voice-test", first.number, "hello", "greet").text == (
        "Ahoy there, friend!"
    )
    NpcDialogueNode.objects.filter(dialogue__character=character, node_key="greet").update(
        text="Draft words"
    )
    # The draft edit is not visible; only a publish changes what is spoken.
    assert published_node("pip-voice-test", first.number, "hello", "greet").text != "Draft words"
    second = publish(staff)
    assert published_node("pip-voice-test", first.number, "hello", "greet") is None
    assert published_node("pip-voice-test", second.number, "hello", "greet").text == "Draft words"
    assert published_node("pip-voice-test", second.number, "hello", "nope") is None
    assert published_node("someone-else", second.number, "hello", "greet") is None


def test_the_management_command_reports_counts_without_text(staff, capsys):
    voiced()
    publish(staff)
    set_polly_client(FakePollyClient())
    call_command("npc_pregenerate_speech")
    out = capsys.readouterr().out
    assert "synthesized 2" in out and "Ahoy" not in out
    call_command("npc_pregenerate_speech", "--release", "1")
    assert "cached 2" in capsys.readouterr().out
    with pytest.raises(CommandError):
        call_command("npc_pregenerate_speech", "--release", "99")


def test_the_management_command_needs_an_active_release():
    make_profile()
    with pytest.raises(CommandError):
        call_command("npc_pregenerate_speech")
