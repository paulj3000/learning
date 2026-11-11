"""LAI-NPC-026: NPC characters reuse `speech.VoiceProfile`; publishing checks it."""

import pytest

from apps.npcs.models import NpcDialogueNode
from apps.npcs.publishing import PublishError, publish
from apps.npcs.validation import voice
from apps.speech.models import VoiceProfile

from .helpers import make_character, make_dialogue, make_staff

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def make_profile(profile_id="pip-voice", voice_id="Justin", engine="neural", **fields):
    return VoiceProfile.objects.create(
        profile_id=profile_id,
        display_name=profile_id,
        polly_voice_id=voice_id,
        language_code=fields.pop("language_code", "en-US"),
        engine=engine,
        **fields,
    )


def voiced(profile=None, npc_id="pip-voice-test"):
    character = make_character(npc_id)
    character.voice_profile = profile or make_profile()
    character.save()
    make_dialogue(character)
    return character


def snapshot_for(npc_id, profile_id, text="Ahoy!", audio=None):
    return {
        "characters": {
            npc_id: {
                "voiceProfile": profile_id,
                "dialogues": [
                    {
                        "dialogueKey": "hello",
                        "nodes": [{"nodeKey": "greet", "text": text, "audio": audio}],
                    }
                ],
            }
        }
    }


def test_a_character_with_a_valid_profile_publishes_and_names_it():
    voiced()
    release = publish(make_staff())
    assert release.snapshot["characters"]["pip-voice-test"]["voiceProfile"] == "pip-voice"


def test_a_character_without_a_profile_is_captions_only_and_not_checked():
    character = make_character("quiet-npc")
    make_dialogue(character)
    assert voice.problems(publish(make_staff()).snapshot) == []


def test_a_disabled_profile_refuses_the_publish_once():
    voiced(make_profile(enabled=False))
    with pytest.raises(PublishError) as error:
        publish(make_staff())
    disabled = [p for p in error.value.problems if "is disabled" in p]
    assert disabled == ["pip-voice-test voice profile pip-voice is disabled"]


def test_a_voice_engine_language_combination_outside_the_table_is_a_problem():
    # Saved without `full_clean` (as a data migration or the shell could): validation catches it.
    voiced(make_profile(voice_id="Kevin", engine="standard"))
    with pytest.raises(PublishError) as error:
        publish(make_staff())
    assert any("does not support the standard engine" in p for p in error.value.problems)


def test_an_unknown_voice_or_language_is_a_problem():
    make_profile("odd", voice_id="Nobody")
    make_profile("wrong-lang", voice_id="Amy", language_code="en-US")
    assert "not in the list of allowed voices" in voice.problems(snapshot_for("a", "odd"))[0]
    assert "is not allowed for en-US" in voice.problems(snapshot_for("b", "wrong-lang"))[0]


def test_a_missing_profile_is_a_problem():
    assert voice.problems(snapshot_for("ghost", "no-such-voice")) == [
        "ghost voice profile no-such-voice does not exist"
    ]


def test_a_voiced_line_the_speech_rules_refuse_is_named_by_key_without_its_text():
    make_profile()
    found = voice.problems(snapshot_for("pip", "pip-voice", text="Visit https://example.test"))
    assert found == [
        "pip dialogue hello node greet cannot be spoken: The text contains a web address."
    ]
    assert "example.test" not in found[0]


def test_recorded_and_empty_lines_are_not_speech_checked():
    make_profile()
    recorded = {"assetId": "line", "version": 1}
    assert voice.problems(snapshot_for("pip", "pip-voice", "https://x.test", recorded)) == []
    assert voice.problems(snapshot_for("pip", "pip-voice", "   ")) == []


def test_a_long_voiced_line_over_the_speech_limit_is_refused(settings):
    settings.LAI_SPEECH_MAX_CHARS = 10
    character = voiced()
    NpcDialogueNode.objects.filter(dialogue__character=character, node_key="bye").update(
        text="This goodbye is far too long."
    )
    with pytest.raises(PublishError) as error:
        publish(make_staff())
    assert any("node bye cannot be spoken" in p for p in error.value.problems)
