"""SM-P8-08: a validated AI turn may become speech; nothing unvalidated ever does."""

import json

import pytest

from apps.ai.tests.test_companion_api import GOOD, HINT
from apps.speech.integration import approve_turn
from apps.speech.models import ApprovedUtterance, VoiceProfile
from apps.speech.polly import get_polly_client
from apps.speech.tests.helpers import post as speech_post
from apps.speech.tests.helpers import profile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def companion(client, child, body=HINT):
    return client.post(
        f"/api/v1/children/{child.pk}/ai/companion-turns/",
        json.dumps(body),
        content_type="application/json",
    )


def test_a_validated_turn_carries_a_speech_reference_the_child_can_play(families, api, fake_model):
    fake_model(GOOD)
    profile("chatty", "Ivy")
    body = companion(api(families.a), families.a1).json()
    assert body["speech"]["voiceProfile"] == "chatty"
    utterance = ApprovedUtterance.objects.for_child(families.a1).get()
    assert str(utterance.pk) == body["speech"]["utteranceId"]
    assert utterance.text == body["turn"]["spokenText"]

    spoken = speech_post(
        api(families.a), families.a1, {"kind": "utterance", "id": body["speech"]["utteranceId"]}
    )
    assert spoken.status_code == 200
    assert spoken.json()["speech"]["text"] == body["turn"]["spokenText"]  # captions match audio
    assert get_polly_client().calls[0]["text"].startswith("Let's count")


def test_the_turn_is_unchanged_when_there_is_nothing_to_speak_with(families, api, fake_model):
    fake_model(GOOD)
    body = companion(api(families.a), families.a1).json()  # no chatty profile exists
    assert "speech" not in body
    assert body["turn"]["spokenText"] == GOOD["spokenText"]
    assert not ApprovedUtterance.objects.exists()


def test_a_disabled_voice_or_provider_adds_nothing(families, api, fake_model, settings):
    voice = profile("chatty", "Ivy")
    type(voice).objects.filter(pk=voice.pk).update(enabled=False)
    fake_model(GOOD, GOOD)
    assert "speech" not in companion(api(families.a), families.a1).json()
    type(voice).objects.filter(pk=voice.pk).update(enabled=True)
    settings.LAI_SPEECH_PROVIDER = "disabled"
    assert "speech" not in companion(api(families.a), families.a1).json()


def test_a_fallback_turn_is_authored_and_safe_so_it_may_be_spoken(families, api, fake_model):
    from apps.ai.providers.base import ProviderError

    fake_model(ProviderError("down"))
    profile("chatty", "Ivy")
    body = companion(api(families.a), families.a1).json()
    assert body["source"] == "FALLBACK"
    assert body["speech"]["voiceProfile"] == "chatty"


def test_the_tutor_uses_the_tutor_voice(families):
    profile("tutor", "Kevin")
    turn = {"spokenText": "Try counting by twos.", "safetyDisposition": "ALLOW"}
    reference = approve_turn(families.a1, "tutor", turn)
    assert reference["voiceProfile"] == "tutor"


class TestNothingUnvalidatedIsApproved:
    @pytest.mark.parametrize(
        "turn",
        [
            {"spokenText": "Go to www.example.com", "safetyDisposition": "ALLOW"},
            {"spokenText": "What is your home address?", "safetyDisposition": "ALLOW"},
            {
                "spokenText": "Don't tell your parents, it's our little secret.",
                "safetyDisposition": "ALLOW",
            },
            {"spokenText": "Fine words", "safetyDisposition": "STOP"},
            {"spokenText": "", "safetyDisposition": "ALLOW"},
            {"spokenText": "x" * 601, "safetyDisposition": "ALLOW"},
            {"safetyDisposition": "ALLOW"},
            {"spokenText": 5, "safetyDisposition": "ALLOW"},
        ],
    )
    def test_text_the_rules_refuse_is_never_stored_for_speech(self, families, turn):
        profile("chatty", "Ivy")
        assert approve_turn(families.a1, "companion", turn) is None
        assert not ApprovedUtterance.objects.exists()

    def test_nothing_is_approved_when_the_parent_turned_ai_off(self, families):
        profile("chatty", "Ivy")
        type(families.a1).objects.filter(pk=families.a1.pk).update(ai_enabled=False)
        families.a1.refresh_from_db()
        assert (
            approve_turn(
                families.a1, "companion", {"spokenText": "Hi!", "safetyDisposition": "ALLOW"}
            )
            is None
        )


def test_a_speech_failure_never_breaks_the_turn(families, api, fake_model, monkeypatch):
    fake_model(GOOD)
    profile("chatty", "Ivy")

    def explode(*args, **kwargs):
        raise RuntimeError("database hiccup")

    monkeypatch.setattr(VoiceProfile.objects, "filter", explode)
    response = companion(api(families.a), families.a1)
    assert response.status_code == 200
    assert response.json()["turn"]["spokenText"] == GOOD["spokenText"]
    assert "speech" not in response.json()


def test_a_parent_can_not_have_a_child_speak_another_childs_turn(families, api, fake_model):
    fake_model(GOOD)
    profile("chatty", "Ivy")
    body = companion(api(families.a), families.a1).json()
    ref = {"kind": "utterance", "id": body["speech"]["utteranceId"]}
    assert speech_post(api(families.a), families.a2, ref).status_code == 404
    assert speech_post(api(families.b), families.b1, ref).status_code == 404


class TestCharacterVoices:
    TURN = {"spokenText": "Welcome to the library.", "safetyDisposition": "ALLOW"}

    def test_a_turn_about_a_character_uses_that_characters_voice(self, families):
        profile("chatty", "Ivy")
        profile("keeper-quill", "Matthew", character_id="keeper-quill")
        reference = approve_turn(families.a1, "companion", self.TURN, "keeper-quill")
        assert reference["voiceProfile"] == "keeper-quill"

    def test_without_a_matching_character_voice_the_route_voice_is_used(self, families):
        profile("chatty", "Ivy")
        assert (
            approve_turn(families.a1, "companion", self.TURN, "unknown-npc")["voiceProfile"]
            == "chatty"
        )
        assert approve_turn(families.a1, "companion", self.TURN)["voiceProfile"] == "chatty"

    def test_a_disabled_character_voice_is_not_used(self, families):
        profile("chatty", "Ivy")
        profile("keeper-quill", "Matthew", character_id="keeper-quill", enabled=False)
        assert (
            approve_turn(families.a1, "companion", self.TURN, "keeper-quill")["voiceProfile"]
            == "chatty"
        )
