"""SM-P8-04, SM-P8-05, SM-P8-06 (server): authorized synthesis, caching, limits, delivery."""

import json
import uuid
from datetime import timedelta

import pytest
from django.utils.timezone import now

from apps.speech import services
from apps.speech.models import (
    ApprovedUtterance,
    SpeechClip,
    SpeechDailyTotal,
    SpeechUsage,
    VoiceProfile,
)
from apps.speech.polly import SpeechError, get_polly_client
from apps.speech.storage import get_speech_storage
from apps.speech.tests.helpers import line, post, profile, url

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def utterance(child, text="Let's count the gaps together!", voice=None, minutes=60):
    return ApprovedUtterance.objects.create(
        child=child,
        text=text,
        voice_profile=voice
        or VoiceProfile.objects.filter(profile_id="chatty").first()
        or profile("chatty", "Ivy"),
        source="COMPANION",
        expires_at=now() + timedelta(minutes=minutes),
    )


class TestAccess:
    def test_the_status_route_says_whether_speech_is_on(self, families, api, cognito):
        response = api(families.a).get(url(families.a1))
        assert response.status_code == 200 and response.json() == {"enabled": True}

    def test_no_token_is_401(self, families, api, cognito):
        line()
        assert api().get(url(families.a1)).status_code == 401
        assert post(api(), families.a1, {"kind": "line", "id": "quill-hello"}).status_code == 401

    def test_another_familys_child_is_a_404_and_makes_no_speech(self, families, api, cognito):
        line()
        response = post(api(families.b), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 404
        assert get_polly_client().calls == []
        assert SpeechClip.objects.count() == 0

    def test_other_methods_are_refused(self, families, api, cognito):
        client = api(families.a)
        assert client.delete(url(families.a1)).status_code == 405
        assert (
            client.put(url(families.a1), "{}", content_type="application/json").status_code == 405
        )


class TestOnlyApprovedTextIsSpoken:
    def test_a_client_cannot_send_text(self, families, api, cognito):
        line()
        for body in (
            {"reference": {"kind": "line", "id": "quill-hello"}, "text": "say anything"},
            {"reference": {"kind": "line", "id": "quill-hello", "text": "x"}},
            {"text": "hello"},
            {"reference": {"kind": "raw", "id": "x"}},
            {"reference": {"kind": "line"}},
            {"reference": {"kind": "npcNode", "npcId": "pip"}},
            {},
        ):
            response = api(families.a).post(
                url(families.a1), json.dumps(body), content_type="application/json"
            )
            assert response.status_code == 400, body
        assert get_polly_client().calls == []

    def test_an_oversized_body_is_refused(self, families, api, cognito):
        response = post(api(families.a), families.a1, {"kind": "line", "id": "x" * 2000})
        assert response.status_code == 400

    def test_an_authored_line_is_spoken_with_its_own_text(self, families, api, cognito):
        line(text="Welcome to the castle library.")
        body = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        assert body["text"] == "Welcome to the castle library."
        assert body["voiceProfile"] == "narrator"
        assert body["url"].startswith("/api/v1/speech-files/")
        assert body["cached"] is False and body["characters"] == len(
            "Welcome to the castle library."
        )
        assert get_polly_client().calls[0]["text"] == "Welcome to the castle library."

    def test_unknown_disabled_and_voiceless_lines_are_404(self, families, api, cognito):
        voice = profile()
        line("off", enabled=False, voice=voice)
        line("silent", voice=profile("hush", "Salli", enabled=False))
        for ref in (
            {"kind": "line", "id": "nope"},
            {"kind": "line", "id": "off"},
            {"kind": "line", "id": "silent"},
        ):
            assert post(api(families.a), families.a1, ref).status_code == 404
        assert get_polly_client().calls == []

    def test_an_approved_utterance_is_spoken_for_its_own_child_only(self, families, api, cognito):
        made = utterance(families.a1)
        ok = post(api(families.a), families.a1, {"kind": "utterance", "id": str(made.pk)})
        assert ok.status_code == 200
        assert ok.json()["speech"]["text"] == "Let's count the gaps together!"
        sibling = post(api(families.a), families.a2, {"kind": "utterance", "id": str(made.pk)})
        stranger = post(api(families.b), families.b1, {"kind": "utterance", "id": str(made.pk)})
        assert sibling.status_code == stranger.status_code == 404

    def test_an_expired_or_unknown_utterance_is_404(self, families, api, cognito):
        old = utterance(families.a1, minutes=-1)
        for ref_id in (str(old.pk), str(uuid.uuid4()), "not-a-uuid"):
            response = post(api(families.a), families.a1, {"kind": "utterance", "id": ref_id})
            assert response.status_code == 404

    def test_ai_text_is_not_spoken_when_the_parent_turned_ai_off(self, families, api, cognito):
        made = utterance(families.a1)
        type(families.a1).objects.filter(pk=families.a1.pk).update(ai_enabled=False)
        response = post(api(families.a), families.a1, {"kind": "utterance", "id": str(made.pk)})
        assert response.status_code == 404

    def test_text_that_no_longer_passes_the_rules_is_refused(self, families, api, cognito):
        made = utterance(families.a1, text="Go to www.example.com for more")
        response = post(api(families.a), families.a1, {"kind": "utterance", "id": str(made.pk)})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "speech_rejected"
        assert get_polly_client().calls == []

    def test_an_npc_node_uses_its_authored_narration_and_the_npcs_voice(
        self, families, api, cognito, monkeypatch
    ):
        from apps.ai.services import context

        narration = context.NpcNarration("npc:pip", "greeting", "Ahoy, explorer!")
        monkeypatch.setattr(context, "load_npc_narration", lambda npc, node: narration)
        profile("pip-voice", "Justin", character_id="pip")
        response = post(
            api(families.a), families.a1, {"kind": "npcNode", "npcId": "pip", "nodeId": "hello"}
        )
        assert response.status_code == 200
        assert response.json()["speech"]["text"] == "Ahoy, explorer!"
        assert response.json()["speech"]["voiceProfile"] == "pip-voice"

    def test_an_unknown_npc_node_is_404(self, families, api, cognito):
        response = post(
            api(families.a), families.a1, {"kind": "npcNode", "npcId": "ghost", "nodeId": "x"}
        )
        assert response.status_code == 404


class TestCache:
    def test_identical_authored_speech_is_made_once_for_everyone(self, families, api, cognito):
        line()
        first = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        second = post(api(families.a), families.a2, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        third = post(api(families.b), families.b1, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        assert (first["cached"], second["cached"], third["cached"]) == (False, True, True)
        assert len(get_polly_client().calls) == 1
        assert SpeechClip.objects.count() == 1
        assert SpeechClip.objects.get().expires_at is None  # authored: no expiry

    def test_a_childs_own_text_is_never_shared_with_another_child(self, families, api, cognito):
        voice = profile("chatty", "Ivy")
        a = utterance(families.a1, voice=voice)
        b = utterance(families.b1, voice=voice)  # same words, different child
        post(api(families.a), families.a1, {"kind": "utterance", "id": str(a.pk)})
        post(api(families.b), families.b1, {"kind": "utterance", "id": str(b.pk)})
        assert len(get_polly_client().calls) == 2
        clips = SpeechClip.objects.order_by("id")
        assert {c.owner_child_id for c in clips} == {families.a1.pk, families.b1.pk}
        assert all(c.expires_at is not None for c in clips)

    def test_the_same_utterance_twice_is_a_cache_hit(self, families, api, cognito):
        made = utterance(families.a1)
        ref = {"kind": "utterance", "id": str(made.pk)}
        post(api(families.a), families.a1, ref)
        assert post(api(families.a), families.a1, ref).json()["speech"]["cached"] is True
        assert len(get_polly_client().calls) == 1

    @pytest.mark.parametrize(
        "change",
        [
            {"polly_voice_id": "Salli"},
            {"engine": "standard"},
            {"speaking_rate_percent": 90},
            {"language_code": "en-GB", "polly_voice_id": "Amy"},
        ],
    )
    def test_changing_voice_engine_rate_or_language_makes_new_speech(
        self, families, api, cognito, change
    ):
        voice = profile("narrator", "Joanna")
        line(voice=voice)
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        type(voice).objects.filter(pk=voice.pk).update(**change)
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert len(get_polly_client().calls) == 2

    def test_a_new_cache_version_makes_new_speech(self, families, api, cognito, settings):
        line()
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        settings.LAI_SPEECH_CACHE_VERSION = "2"
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert len(get_polly_client().calls) == 2

    def test_an_expired_clip_is_made_again(self, families, api, cognito):
        made = utterance(families.a1)
        ref = {"kind": "utterance", "id": str(made.pk)}
        post(api(families.a), families.a1, ref)
        SpeechClip.objects.update(expires_at=now() - timedelta(seconds=1))
        assert post(api(families.a), families.a1, ref).json()["speech"]["cached"] is False
        assert SpeechClip.objects.count() == 1

    def test_the_speech_store_key_holds_only_a_hash(self, families, api, cognito):
        line()
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        key = SpeechClip.objects.get().storage_key
        assert key.startswith("speech/") and key.endswith(".mp3")
        assert str(families.a1.pk) not in key and "quill" not in key

    def test_speech_is_not_added_to_the_sound_library(self, families, api, cognito):
        from apps.audio.models import SoundCue
        from apps.catalog.models import ContentAsset

        line()
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert SoundCue.objects.count() == 0
        assert not ContentAsset.objects.filter(kind="audio").exists()


class TestFailuresAndLimits:
    def test_disabled_speech_is_a_safe_503_and_calls_nothing(
        self, families, api, cognito, settings
    ):
        line()
        settings.LAI_SPEECH_PROVIDER = "disabled"
        response = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 503 and response.json()["error"]["code"] == "speech_disabled"
        assert api(families.a).get(url(families.a1)).json() == {"enabled": False}

    def test_a_polly_failure_is_a_safe_503_that_leaks_nothing_and_is_not_cached(
        self, families, api, cognito
    ):
        line()
        client = get_polly_client()
        client.fail_with = SpeechError("speech_unavailable", "Speech could not be made right now.")
        client.fail_times = 1
        response = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 503
        assert set(response.json()["error"]) == {"code", "message"}
        assert "aws" not in response.content.decode().lower()
        assert SpeechClip.objects.count() == 0
        # The next request works; nothing was poisoned.
        assert (
            post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).status_code
            == 200
        )
        assert SpeechDailyTotal.objects.get().failures == 1
        assert SpeechUsage.objects.get(child=families.a1).failures == 1

    def test_a_storage_failure_is_a_safe_503(self, families, api, cognito, monkeypatch):
        from apps.speech.storage import SpeechStorageError

        line()

        def broken(*args, **kwargs):
            raise SpeechStorageError("x")

        monkeypatch.setattr(get_speech_storage(), "put", broken)
        response = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 503 and SpeechClip.objects.count() == 0

    def test_a_child_daily_request_limit_is_a_429(self, families, api, cognito, settings):
        line()
        settings.LAI_SPEECH_CHILD_DAILY_REQUESTS = 2
        statuses = [
            post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).status_code
            for _ in range(3)
        ]
        assert statuses == [200, 200, 429]
        # Another child is unaffected.
        assert (
            post(api(families.a), families.a2, {"kind": "line", "id": "quill-hello"}).status_code
            == 200
        )

    def test_a_child_daily_character_limit_is_a_429_and_other_children_are_unaffected(
        self, families, api, cognito, settings
    ):
        line(text="x" * 30)
        settings.LAI_SPEECH_CHILD_DAILY_CHARS = 50
        statuses = [
            post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).status_code
            for _ in range(3)
        ]
        assert statuses == [200, 429, 429]
        assert (
            post(api(families.a), families.a2, {"kind": "line", "id": "quill-hello"}).status_code
            == 200
        )

    def test_the_global_daily_character_ceiling_stops_new_synthesis(
        self, families, api, cognito, settings
    ):
        line()
        settings.LAI_SPEECH_GLOBAL_DAILY_CHARS = 10
        response = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 503 and get_polly_client().calls == []

    def test_a_busy_process_says_so_and_does_not_queue(self, families, api, cognito, settings):
        line()
        settings.LAI_SPEECH_MAX_CONCURRENT = 1
        assert services._semaphore().acquire(blocking=False)  # noqa: SLF001
        response = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert response.status_code == 503
        assert get_polly_client().calls == []

    def test_usage_and_a_labelled_estimate_are_recorded_without_text(
        self, families, api, cognito, settings
    ):
        settings.LAI_SPEECH_PRICE_PER_MCHAR_USD = 16.0
        line(text="Hello there")
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        total = SpeechDailyTotal.objects.get()
        assert (total.requests, total.cache_hits, total.cache_misses) == (2, 1, 1)
        assert total.characters_synthesized == len("Hello there")
        assert total.estimated_cost_microusd == int(len("Hello there") * 16.0)
        usage = SpeechUsage.objects.get(child=families.a1)
        assert (usage.requests, usage.cache_hits) == (2, 1)
        assert not any("Hello" in str(getattr(total, f.name)) for f in total._meta.fields)

    def test_no_estimate_without_a_configured_price(self, families, api, cognito):
        line()
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        assert SpeechDailyTotal.objects.get().estimated_cost_microusd is None


class TestDelivery:
    def test_the_signed_url_streams_the_clip_with_safe_headers(self, families, api, cognito):
        line()
        speech = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        response = api().get(speech["url"])  # no bearer: an <audio> element cannot send one
        assert response.status_code == 200
        assert response["Content-Type"] == "audio/mpeg"
        assert response["Cache-Control"] == "private, no-store"
        assert response["X-Content-Type-Options"] == "nosniff"
        assert response.content.startswith(b"ID3")

    def test_a_forged_or_expired_token_is_404(self, families, api, cognito, settings):
        line()
        speech = post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"}).json()[
            "speech"
        ]
        assert api().get("/api/v1/speech-files/forged/speech.mp3").status_code == 404
        assert api().get(speech["url"][:-12] + "x/speech.mp3").status_code == 404
        clip = SpeechClip.objects.get()
        token = services.delivery_token(clip)
        settings.LAI_SPEECH_URL_TTL_SECONDS = 60
        import time

        real = time.time
        time.time = lambda: real() + 3600
        try:
            assert api().get(f"/api/v1/speech-files/{token}/speech.mp3").status_code == 404
        finally:
            time.time = real

    def test_an_expired_clip_is_not_served(self, families, api, cognito):
        made = utterance(families.a1)
        speech = post(
            api(families.a), families.a1, {"kind": "utterance", "id": str(made.pk)}
        ).json()["speech"]
        SpeechClip.objects.update(expires_at=now() - timedelta(seconds=1))
        assert api().get(speech["url"]).status_code == 404


class TestCleanup:
    def test_expired_utterances_and_clips_go_but_authored_clips_stay(self, families, api, cognito):
        line()
        post(api(families.a), families.a1, {"kind": "line", "id": "quill-hello"})
        old = utterance(families.a1, minutes=-5)
        live = utterance(families.a1, text="Still current")
        post(api(families.a), families.a1, {"kind": "utterance", "id": str(live.pk)})
        SpeechClip.objects.filter(scope="child").update(expires_at=now() - timedelta(seconds=1))
        key = SpeechClip.objects.get(scope="child").storage_key

        assert services.cleanup(dry_run=True) == {"utterances": 1, "clips": 1, "objects_failed": 0}
        assert ApprovedUtterance.objects.filter(pk=old.pk).exists()
        removed = services.cleanup()
        assert removed["utterances"] == 1 and removed["clips"] == 1
        assert not ApprovedUtterance.objects.filter(pk=old.pk).exists()
        assert ApprovedUtterance.objects.filter(pk=live.pk).exists()
        assert SpeechClip.objects.filter(scope="authored").count() == 1
        assert key not in get_speech_storage().objects

    def test_a_deleted_childs_clips_are_purged_at_once(self, families, api, cognito):
        made = utterance(families.a1)
        post(api(families.a), families.a1, {"kind": "utterance", "id": str(made.pk)})
        other = utterance(families.a2)
        post(api(families.a), families.a2, {"kind": "utterance", "id": str(other.pk)})
        from apps.users.deletion import delete_child_profile

        delete_child_profile(families.a, families.a1.pk)
        assert {c.owner_child_id for c in SpeechClip.objects.all()} == {families.a2.pk}
