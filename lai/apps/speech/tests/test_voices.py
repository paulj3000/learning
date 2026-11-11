"""SM-P8-03: voice profiles accept only explicitly supported voice, language and engine combos."""

from io import StringIO

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.speech import voices
from apps.speech.models import SpeechLine, VoiceProfile
from apps.speech.tests.helpers import profile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.mark.parametrize(
    ("voice", "language", "engine"),
    [("Ivy", "en-US", "neural"), ("Kevin", "en-US", "neural"), ("Amy", "en-GB", "generative")],
)
def test_supported_combinations_are_valid(voice, language, engine):
    assert voices.voice_problem(voice, language, engine) is None


@pytest.mark.parametrize(
    ("voice", "language", "engine", "fragment"),
    [
        ("Zorp", "en-US", "neural", "not in the list"),
        ("Ivy", "fr-FR", "neural", "not allowed for fr-FR"),
        ("Kevin", "en-US", "standard", "does not support the standard engine"),
        ("Ivy", "en-US", "generative", "does not support the generative engine"),
        ("Joanna", "en-GB", "neural", "not allowed for en-GB"),
    ],
)
def test_unsupported_combinations_are_refused_with_the_reason(voice, language, engine, fragment):
    assert fragment in voices.voice_problem(voice, language, engine)


def test_a_profile_cannot_be_saved_with_an_unsupported_combination():
    bad = VoiceProfile(
        profile_id="x",
        display_name="X",
        polly_voice_id="Kevin",
        language_code="en-US",
        engine="standard",
    )
    with pytest.raises(ValidationError) as caught:
        bad.full_clean()
    assert "polly_voice_id" in caught.value.message_dict


@pytest.mark.parametrize("rate", [69, 131, 0, 500])
def test_speaking_rate_is_bounded(rate):
    bad = VoiceProfile(
        profile_id="x",
        display_name="X",
        polly_voice_id="Ivy",
        engine="neural",
        speaking_rate_percent=rate,
    )
    with pytest.raises(ValidationError) as caught:
        bad.full_clean()
    assert "speaking_rate_percent" in caught.value.message_dict


def test_profile_ids_are_stable_slugs():
    bad = VoiceProfile(
        profile_id="Keeper Quill!", display_name="X", polly_voice_id="Ivy", engine="neural"
    )
    with pytest.raises(ValidationError) as caught:
        bad.full_clean()
    assert "profile_id" in caught.value.message_dict


class TestSsml:
    def test_text_is_escaped_inside_prosody(self):
        text, kind = voices.build_request_text("Fish & <chips>", "neural", 90)
        assert kind == "ssml"
        assert text == '<speak><prosody rate="90%">Fish &amp; &lt;chips&gt;</prosody></speak>'

    def test_normal_speed_is_plain_text(self):
        assert voices.build_request_text("Hello", "neural", 100) == ("Hello", "text")

    def test_engines_without_ssml_prosody_get_plain_text(self):
        assert voices.build_request_text("Hello", "generative", 90) == ("Hello", "text")
        assert voices.build_request_text("Hello", "long-form", 90) == ("Hello", "text")


class TestLines:
    def test_a_line_must_pass_the_output_rules(self):
        voice = profile()
        for text in ["", "Visit www.example.com now", "What is your home address?", "x" * 601]:
            with pytest.raises(ValidationError) as caught:
                SpeechLine(line_id="l", text=text, voice_profile=voice).full_clean()
            assert "text" in caught.value.message_dict, text

    def test_an_ordinary_line_is_valid(self):
        SpeechLine(line_id="l", text="Hello there!", voice_profile=profile()).full_clean()


class TestStarterProfiles:
    def run(self):
        out = StringIO()
        call_command("seed_speech_voices", stdout=out)
        return out.getvalue()

    def test_creates_the_five_starters_with_allowed_voices(self):
        self.run()
        ids = set(VoiceProfile.objects.values_list("profile_id", flat=True))
        assert ids == {"keeper-quill", "chatty", "pirate-pip", "narrator", "tutor"}
        for starter in VoiceProfile.objects.all():
            assert (
                voices.voice_problem(starter.polly_voice_id, starter.language_code, starter.engine)
                is None
            )
        assert VoiceProfile.objects.get(profile_id="keeper-quill").character_id == "keeper-quill"
        pip = VoiceProfile.objects.get(profile_id="pirate-pip")
        assert (pip.character_id, pip.polly_voice_id, pip.engine) == (
            "pirate-pip",
            "Justin",
            "neural",
        )

    def test_is_idempotent_and_never_changes_an_existing_profile(self):
        self.run()
        VoiceProfile.objects.filter(profile_id="chatty").update(
            polly_voice_id="Salli", enabled=False
        )
        assert "Created: none" in self.run()
        chatty = VoiceProfile.objects.get(profile_id="chatty")
        assert (chatty.polly_voice_id, chatty.enabled) == ("Salli", False)
        assert VoiceProfile.objects.count() == 5
