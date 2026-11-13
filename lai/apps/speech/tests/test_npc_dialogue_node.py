"""LAI-NPC-028: the `npcDialogueNode` speech reference (ADR-054 section 8, contract 5.4)."""

import json

import pytest

from apps.npcs.models import NpcDialogueNode
from apps.npcs.publishing import publish, retire
from apps.npcs.speech import pregenerate_release_speech
from apps.npcs.tests.helpers import make_character, make_dialogue, make_staff
from apps.speech import services
from apps.speech.models import SpeechClip, SpeechUsage
from apps.speech.polly import get_polly_client
from apps.speech.tests.helpers import post, profile, url

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def ref(release=1, npc_id="pip-voice", dialogue="hello", node="greet"):
    return {
        "kind": "npcDialogueNode",
        "npcId": npc_id,
        "release": release,
        "dialogueKey": dialogue,
        "nodeKey": node,
    }


@pytest.fixture
def staff():
    return make_staff()


@pytest.fixture
def pip(db):
    character = make_character("pip-voice")
    character.voice_profile = profile("pip", "Justin")
    character.save()
    make_dialogue(character)
    return character


class TestResolution:
    def test_a_published_node_is_spoken_with_the_characters_voice(
        self, families, api, cognito, pip, staff
    ):
        publish(staff)
        response = post(api(families.a), families.a1, ref())
        assert response.status_code == 200, response.content
        body = response.json()["speech"]
        assert body["text"] == "Ahoy there, friend!" and body["voiceProfile"] == "pip"
        assert get_polly_client().calls[0]["voice_id"] == "Justin"
        clip = SpeechClip.objects.get()
        assert clip.scope == "authored" and clip.owner_child_id is None

    def test_children_share_one_clip(self, families, api, cognito, pip, staff):
        publish(staff)
        post(api(families.a), families.a1, ref())
        second = post(api(families.b), families.b1, ref())
        assert second.json()["speech"]["cached"] is True
        assert len(get_polly_client().calls) == 1

    def test_a_pregenerated_clip_is_served_without_synthesis(
        self, families, api, cognito, pip, staff
    ):
        release = publish(staff)
        pregenerate_release_speech(release)
        before = len(get_polly_client().calls)
        body = post(api(families.a), families.a1, ref(node="bye")).json()["speech"]
        assert body["cached"] is True and len(get_polly_client().calls) == before
        # The cache key is the existing one (text, voice, engine, language, rate).
        resolved = services.resolve(families.a1, ref(node="bye"))
        assert SpeechClip.objects.filter(cache_key=services.cache_key(resolved, None)).exists()

    def test_draft_rows_are_never_spoken(self, families, api, cognito, pip, staff):
        publish(staff)
        NpcDialogueNode.objects.filter(node_key="greet").update(text="A draft line")
        body = post(api(families.a), families.a1, ref()).json()["speech"]
        assert body["text"] == "Ahoy there, friend!"
        assert all(c["text"] != "A draft line" for c in get_polly_client().calls)

    def test_superseded_retired_unknown_and_missing_are_404(
        self, families, api, cognito, pip, staff
    ):
        first = publish(staff)
        NpcDialogueNode.objects.filter(node_key="greet").update(text="Second release")
        second = publish(staff)
        for reference in (
            ref(release=first.number),  # superseded
            ref(release=99),
            ref(npc_id="nobody"),
            ref(dialogue="nope"),
            ref(node="nope"),
        ):
            response = post(api(families.a), families.a1, reference)
            assert response.status_code == 404, reference
            assert response.json()["error"]["code"] == "not_found"
        retire(second, staff)
        assert post(api(families.a), families.a1, ref(release=second.number)).status_code == 404
        assert get_polly_client().calls == []

    def test_a_character_without_a_voice_is_not_spoken(self, families, api, cognito, staff):
        make_dialogue(make_character("quiet-npc"))
        publish(staff)
        assert post(api(families.a), families.a1, ref(npc_id="quiet-npc")).status_code == 404

    def test_a_disabled_voice_profile_is_not_spoken(self, families, api, cognito, pip, staff):
        publish(staff)
        pip.voice_profile.enabled = False
        pip.voice_profile.save()
        assert post(api(families.a), families.a1, ref()).status_code == 404

    def test_a_node_outside_the_childs_age_band_is_404(self, families, api, cognito, pip, staff):
        NpcDialogueNode.objects.filter(node_key="bye").update(age_bands=["EXPLORER"])
        publish(staff)
        # The children in `families` are PATHFINDERs.
        assert post(api(families.a), families.a1, ref(node="bye")).status_code == 404
        assert post(api(families.a), families.a1, ref(node="greet")).status_code == 200


class TestAuthorizationAndLimits:
    def test_another_familys_child_is_404_and_makes_no_speech(
        self, families, api, cognito, pip, staff
    ):
        publish(staff)
        assert post(api(families.b), families.a1, ref()).status_code == 404
        assert get_polly_client().calls == []

    def test_no_token_is_401(self, families, api, cognito, pip, staff):
        publish(staff)
        assert post(api(), families.a1, ref()).status_code == 401

    def test_speech_switched_off_is_a_safe_refusal(
        self, families, api, cognito, pip, staff, settings
    ):
        publish(staff)
        settings.LAI_SPEECH_PROVIDER = "disabled"
        response = post(api(families.a), families.a1, ref())
        assert response.json()["error"]["code"] == "speech_disabled"

    def test_requests_count_against_the_childs_daily_limit(
        self, families, api, cognito, pip, staff, settings
    ):
        publish(staff)
        settings.LAI_SPEECH_CHILD_DAILY_REQUESTS = 1
        assert post(api(families.a), families.a1, ref()).status_code == 200
        assert post(api(families.a), families.a1, ref()).status_code == 429
        assert SpeechUsage.objects.get(child=families.a1).requests == 2


class TestRequestShape:
    @pytest.mark.parametrize(
        "reference",
        [
            {"kind": "npcDialogueNode", "npcId": "pip-voice", "dialogueKey": "hello"},
            {**ref(), "text": "say this"},
            {**ref(), "nodeId": "greet"},
            {**ref(), "release": 0},
            {**ref(), "release": "one"},
            {**ref(), "nodeKey": "not a slug!"},
            {"kind": "line", "id": "x", "npcId": "pip-voice"},
        ],
    )
    def test_malformed_references_are_400(self, families, api, cognito, reference):
        response = api(families.a).post(
            url(families.a1), json.dumps({"reference": reference}), content_type="application/json"
        )
        assert response.status_code == 400
        assert get_polly_client().calls == []
