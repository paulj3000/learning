"""SM-P8-LIVE: the speech API end to end on the REAL Polly client path (stubbed AWS, no network).

`Boto3PollyClient` runs over botocore's Stubber, so every request Polly would receive is asserted
and every AWS failure is the real botocore exception. Covers successful synthesis, cache hits,
child authorization, throttling, timeouts, IAM denial, an invalid voice, malformed input, storage
failures, presigned-URL fallback, cache invalidation of a missing object, and Pirate Pip's voice
from seed to a child hearing his published lines.
"""

import io
import json
import logging
from io import StringIO

import boto3
import pytest
from botocore.exceptions import ReadTimeoutError
from botocore.response import StreamingBody
from botocore.stub import Stubber
from django.core.management import call_command

from apps.speech import polly, services
from apps.speech.models import SpeechClip, SpeechDailyTotal, VoiceProfile
from apps.speech.polly import Boto3PollyClient, set_polly_client
from apps.speech.storage import SpeechStorageError, get_speech_storage
from apps.speech.tests.helpers import line, post, profile, url

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00\xff\xfb\x90\x64" + b"\x00" * 1500
LINE = {"kind": "line", "id": "quill-hello"}
AWS_MESSAGE = "User arn:aws:iam::123456789012:role/lai-runtime is not authorized"


def _audio():
    return {"AudioStream": StreamingBody(io.BytesIO(MP3), len(MP3)), "ContentType": "audio/mpeg"}


@pytest.fixture
def aws(settings, monkeypatch):
    """The real client over a Stubber; `aws.stub` queues what AWS answers."""
    settings.LAI_SPEECH_PROVIDER = "polly"
    settings.LAI_SPEECH_AWS_REGION = "us-east-1"
    settings.LAI_SPEECH_RETRIES = 1
    monkeypatch.setattr(polly, "_sleep", lambda _seconds: None)
    raw = boto3.client(
        "polly",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - stubbed, never sent
    )
    stub = Stubber(raw)
    stub.activate()
    client = Boto3PollyClient(raw)
    set_polly_client(client)
    yield type("Aws", (), {"stub": stub, "client": client, "raw": raw})
    stub.deactivate()
    set_polly_client(None)


def _say(api, child, reference=LINE):
    return post(api, child, reference)


class TestSynthesisAndCache:
    def test_a_line_is_synthesized_once_stored_and_then_served_from_cache(
        self, families, api, cognito, aws
    ):
        line(voice=profile("narrator", "Joanna", "neural", 95))
        aws.stub.add_response(
            "synthesize_speech",
            _audio(),
            {
                "Text": (
                    '<speak><prosody rate="95%">Welcome to the castle library.</prosody></speak>'
                ),
                "TextType": "ssml",
                "OutputFormat": "mp3",
                "VoiceId": "Joanna",
                "Engine": "neural",
                "LanguageCode": "en-US",
            },
        )
        first = _say(api(families.a), families.a1)
        assert first.status_code == 200, first.content
        assert first.json()["speech"]["cached"] is False
        # Another family's child hears the same authored clip: no second Polly call (the stub
        # holds no more answers, so a call would fail the test).
        second = _say(api(families.b), families.b1)
        assert second.json()["speech"]["cached"] is True
        aws.stub.assert_no_pending_responses()
        clip = SpeechClip.objects.get()
        assert clip.storage_key.startswith("speech/shared/") and clip.byte_size == len(MP3)
        audio = api().get(second.json()["speech"]["url"])
        assert audio.status_code == 200 and audio.content == MP3
        total = SpeechDailyTotal.objects.get()
        assert (total.cache_misses, total.cache_hits) == (1, 1)

    def test_a_childs_own_text_is_stored_under_the_child_prefix(self, families, api, cognito, aws):
        from apps.speech.tests.test_speech_api import utterance

        spoken = utterance(families.a1, voice=profile("chatty", "Ivy", "neural", 100))
        aws.stub.add_response("synthesize_speech", _audio())
        response = _say(api(families.a), families.a1, {"kind": "utterance", "id": str(spoken.pk)})
        assert response.status_code == 200
        clip = SpeechClip.objects.get()
        assert clip.storage_key.startswith("speech/child/")
        assert str(families.a1.pk) not in clip.storage_key

    def test_another_familys_child_is_404_and_aws_is_never_called(
        self, families, api, cognito, aws
    ):
        line()
        response = _say(api(families.b), families.a1)
        assert response.status_code == 404
        aws.stub.assert_no_pending_responses()  # nothing queued, nothing consumed
        assert SpeechClip.objects.count() == 0

    def test_no_token_is_401_and_aws_is_never_called(self, families, api, cognito, aws):
        line()
        assert _say(api(), families.a1).status_code == 401
        assert SpeechClip.objects.count() == 0


class TestFailuresAreSafe:
    def _assert_safe_503(self, response, caplog):
        assert response.status_code == 503
        body = json.dumps(response.json())
        assert "arn:aws" not in body and "lai-runtime" not in body and "castle" not in body
        logged = " ".join(r.getMessage() for r in caplog.records)
        assert "arn:aws" not in logged and "castle library" not in logged
        assert "Zinnia" not in logged
        assert SpeechClip.objects.count() == 0

    def test_throttling_is_retried_then_succeeds(self, families, api, cognito, aws):
        line()
        aws.stub.add_client_error("synthesize_speech", "ThrottlingException")
        aws.stub.add_response("synthesize_speech", _audio())
        assert _say(api(families.a), families.a1).status_code == 200
        aws.stub.assert_no_pending_responses()

    def test_throttling_that_persists_is_a_safe_503_and_counted(
        self, families, api, cognito, aws, caplog
    ):
        line()
        for _ in range(2):
            aws.stub.add_client_error("synthesize_speech", "ThrottlingException", AWS_MESSAGE)
        with caplog.at_level(logging.INFO):
            response = _say(api(families.a), families.a1)
        self._assert_safe_503(response, caplog)
        assert response.json()["error"]["code"] == "speech_unavailable"
        assert "reason=throttled" in caplog.text
        assert SpeechDailyTotal.objects.get().failures == 1

    def test_a_timeout_is_a_safe_503(self, families, api, cognito, aws, caplog, monkeypatch):
        line()

        def timeout(**_kwargs):
            raise ReadTimeoutError(endpoint_url="https://polly.us-east-1.amazonaws.com")

        monkeypatch.setattr(aws.raw, "synthesize_speech", timeout)
        with caplog.at_level(logging.INFO):
            response = _say(api(families.a), families.a1)
        self._assert_safe_503(response, caplog)
        assert "reason=timeout" in caplog.text

    def test_iam_denial_is_a_safe_503_without_retry(self, families, api, cognito, aws, caplog):
        line()
        aws.stub.add_client_error(
            "synthesize_speech", "AccessDeniedException", AWS_MESSAGE, http_status_code=403
        )
        with caplog.at_level(logging.INFO):
            response = _say(api(families.a), families.a1)
        self._assert_safe_503(response, caplog)
        assert "reason=access_denied" in caplog.text
        aws.stub.assert_no_pending_responses()  # one call, no retry

    def test_a_voice_the_region_refuses_is_a_safe_503(self, families, api, cognito, aws, caplog):
        line()
        aws.stub.add_client_error("synthesize_speech", "ValidationException", AWS_MESSAGE)
        with caplog.at_level(logging.INFO):
            response = _say(api(families.a), families.a1)
        self._assert_safe_503(response, caplog)
        assert response.json()["error"]["message"] == "This voice is not available."

    def test_a_voice_outside_the_table_never_reaches_aws(self, families, api, cognito, aws):
        voice = profile("narrator", "Joanna")
        VoiceProfile.objects.filter(pk=voice.pk).update(polly_voice_id="Kevin", engine="standard")
        line(voice=VoiceProfile.objects.get(pk=voice.pk))
        response = _say(api(families.a), families.a1)
        assert response.status_code == 503
        aws.stub.assert_no_pending_responses()

    def test_ssml_aws_refuses_is_a_422(self, families, api, cognito, aws):
        line()
        aws.stub.add_client_error("synthesize_speech", "InvalidSsmlException")
        response = _say(api(families.a), families.a1)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "speech_rejected"

    @pytest.mark.parametrize(
        "body",
        [
            {"text": "Say this"},
            {"reference": {"kind": "text", "id": "x"}},
            {"reference": {"kind": "line"}},
            {"reference": {"kind": "line", "id": "quill-hello", "text": "Say this"}},
        ],
    )
    def test_malformed_input_is_400_and_aws_is_never_called(
        self, families, api, cognito, aws, body
    ):
        line()
        response = api(families.a).post(
            url(families.a1), json.dumps(body), content_type="application/json"
        )
        assert response.status_code == 400
        assert SpeechClip.objects.count() == 0

    def test_a_storage_failure_after_synthesis_is_a_safe_503(
        self, families, api, cognito, aws, monkeypatch
    ):
        line()
        aws.stub.add_response("synthesize_speech", _audio())

        def broken(*_args, **_kwargs):
            raise SpeechStorageError("could not store speech")

        monkeypatch.setattr(get_speech_storage(), "put", broken)
        response = _say(api(families.a), families.a1)
        assert response.status_code == 503 and SpeechClip.objects.count() == 0


class TestDeliveryAndInvalidation:
    def test_a_presign_failure_falls_back_to_the_django_route(
        self, families, api, cognito, aws, settings, monkeypatch
    ):
        settings.LAI_SPEECH_DELIVERY = "s3"
        line()
        aws.stub.add_response("synthesize_speech", _audio())

        def cannot_sign(*_args, **_kwargs):
            raise SpeechStorageError("could not sign a speech url")

        monkeypatch.setattr(get_speech_storage(), "presigned_url", cannot_sign)
        speech = _say(api(families.a), families.a1).json()["speech"]
        assert speech["url"].startswith("/api/v1/speech-files/")
        assert api().get(speech["url"]).content == MP3

    def test_a_presigned_url_is_returned_when_signing_works(
        self, families, api, cognito, aws, settings, monkeypatch
    ):
        settings.LAI_SPEECH_DELIVERY = "s3"
        line()
        aws.stub.add_response("synthesize_speech", _audio())
        monkeypatch.setattr(
            get_speech_storage(),
            "presigned_url",
            lambda key, expires_in: (
                f"https://speech.s3.amazonaws.com/{key}?X-Amz-Expires={expires_in}"
            ),
        )
        speech = _say(api(families.a), families.a1).json()["speech"]
        assert speech["url"].startswith("https://speech.s3.amazonaws.com/speech/shared/")

    def test_a_missing_object_invalidates_the_cache_and_is_made_again(
        self, families, api, cognito, aws
    ):
        line()
        aws.stub.add_response("synthesize_speech", _audio())
        first = _say(api(families.a), families.a1).json()["speech"]
        clip = SpeechClip.objects.get()
        get_speech_storage().delete(clip.storage_key)  # e.g. a lifecycle rule removed it
        assert api().get(first["url"]).status_code == 404
        assert SpeechClip.objects.count() == 0  # the stale row is gone
        aws.stub.add_response("synthesize_speech", _audio())
        again = _say(api(families.a), families.a1).json()["speech"]
        assert again["cached"] is False and api().get(again["url"]).content == MP3
        aws.stub.assert_no_pending_responses()


class TestPiratePip:
    """Pirate Pip's voice: seeded, attached, validated, published and heard by a child."""

    def _run(self, command, *args):
        out = StringIO()
        call_command(command, *args, stdout=out)
        return out.getvalue()

    def _pip_nodes(self, child):
        from apps.npcs import published
        from apps.npcs.speech import _nodes

        active = published.current()
        return [
            found
            for _node, found in _nodes(active.snapshot, active.number, "pirate-pip")
            if found.admits(child.age_band)
        ]

    def test_pip_speaks_his_published_lines_in_his_own_voice(self, treasure, api, cognito):
        families = treasure.families
        self._run("seed_speech_voices")
        out = self._run("seed_npc_pip", "--publish")
        assert "Validation: no problems." in out and "is ACTIVE" in out
        nodes = self._pip_nodes(families.a1)
        assert nodes, "Pip has spoken lines for a Pathfinder"
        for node in nodes:
            response = post(
                api(families.a),
                families.a1,
                {
                    "kind": "npcDialogueNode",
                    "npcId": node.npc_id,
                    "release": node.release,
                    "dialogueKey": node.dialogue_key,
                    "nodeKey": node.node_key,
                },
            )
            assert response.status_code == 200, (node.label, response.content)
            assert response.json()["speech"]["voiceProfile"] == "pirate-pip"
            assert response.json()["speech"]["text"] == node.text
        calls = polly.get_polly_client().calls
        assert {call["voice_id"] for call in calls} == {"Justin"}
        assert {call["engine"] for call in calls} == {"neural"}

    def test_an_existing_voiceless_pip_gets_his_voice_only_when_asked(self, treasure):
        from apps.npcs.models import NpcCharacter

        self._run("seed_npc_pip")  # before any voice profile exists: captions only
        pip = NpcCharacter.objects.get(definition__npc_id="pirate-pip")
        assert pip.voice_profile_id is None
        self._run("seed_speech_voices")
        self._run("seed_npc_pip")
        pip.refresh_from_db()
        assert pip.voice_profile_id is None  # create-only: a rerun changes nothing
        assert "now speaks" in self._run("seed_npc_pip", "--attach-voice")
        pip.refresh_from_db()
        assert pip.voice_profile.profile_id == "pirate-pip"

    def test_attach_voice_never_replaces_a_voice_staff_chose(self, treasure):
        from apps.npcs.models import NpcCharacter

        self._run("seed_speech_voices")
        self._run("seed_npc_pip")
        chosen = profile("pip-staff-choice", "Kevin")
        NpcCharacter.objects.filter(definition__npc_id="pirate-pip").update(voice_profile=chosen)
        assert "already has a voice" in self._run("seed_npc_pip", "--attach-voice")
        pip = NpcCharacter.objects.get(definition__npc_id="pirate-pip")
        assert pip.voice_profile_id == chosen.pk

    def test_pip_lines_are_pregenerated_into_the_shared_cache(self, treasure, api, cognito):
        from apps.npcs import published
        from apps.npcs.models import NpcRelease
        from apps.npcs.speech import pregenerate_release_speech

        families = treasure.families
        self._run("seed_speech_voices")
        self._run("seed_npc_pip", "--publish")
        release = NpcRelease.objects.get(number=published.current().number)
        report = pregenerate_release_speech(release)
        assert report.failed == 0 and report.synthesized > 0
        before = len(polly.get_polly_client().calls)
        node = self._pip_nodes(families.a1)[0]
        body = post(
            api(families.a),
            families.a1,
            {
                "kind": "npcDialogueNode",
                "npcId": node.npc_id,
                "release": node.release,
                "dialogueKey": node.dialogue_key,
                "nodeKey": node.node_key,
            },
        ).json()["speech"]
        assert body["cached"] is True and len(polly.get_polly_client().calls) == before
        assert services.speech_enabled()
