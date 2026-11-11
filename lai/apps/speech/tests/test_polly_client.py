"""SM-P8-LIVE: the real `Boto3PollyClient` path, against botocore's Stubber (no network).

The request Polly receives, the audio checks, the bounded retries for transient failures, no
retry for permission / voice / input errors, and safe, log-clean errors for every failure.
"""

import io
import logging

import boto3
import pytest
from botocore.exceptions import NoCredentialsError, ReadTimeoutError
from botocore.response import StreamingBody
from botocore.stub import Stubber

from apps.speech import polly
from apps.speech.polly import (
    Boto3PollyClient,
    DisabledPollyClient,
    FakePollyClient,
    SpeechError,
    classify,
    get_polly_client,
    looks_like_mp3,
    set_polly_client,
)

MP3 = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x64" + b"\x00" * 2048
CHILD_TEXT = "Zinnia-A1 found seven shells"
AWS_MESSAGE = "User arn:aws:iam::123456789012:role/secret-role is not authorized"


def _client():
    return boto3.client(
        "polly",
        region_name="us-east-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - stubbed, never sent
    )


@pytest.fixture
def sleeps(monkeypatch):
    calls = []
    monkeypatch.setattr(polly, "_sleep", calls.append)
    return calls


@pytest.fixture
def stubbed(settings):
    settings.LAI_SPEECH_RETRIES = 2
    raw = _client()
    stub = Stubber(raw)
    with stub:
        yield Boto3PollyClient(raw), stub
    stub.assert_no_pending_responses()


def _audio(data=MP3, content_type="audio/mpeg"):
    return {
        "AudioStream": StreamingBody(io.BytesIO(data), len(data)),
        "ContentType": content_type,
        "RequestCharacters": 10,
    }


def _expected(text=CHILD_TEXT, text_type="text", voice="Justin", engine="neural"):
    return {
        "Text": text,
        "TextType": text_type,
        "OutputFormat": "mp3",
        "VoiceId": voice,
        "Engine": engine,
        "LanguageCode": "en-US",
    }


def _say(client, text=CHILD_TEXT, text_type="text", voice="Justin", engine="neural"):
    return client.synthesize(
        text=text, text_type=text_type, voice_id=voice, engine=engine, language="en-US"
    )


def _no_leaks(caplog):
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert CHILD_TEXT not in logged and "Zinnia" not in logged
    assert "arn:aws" not in logged and "secret-role" not in logged


class TestSuccess:
    def test_sends_one_mp3_request_and_returns_the_audio(self, stubbed, sleeps, caplog):
        client, stub = stubbed
        stub.add_response("synthesize_speech", _audio(), _expected())
        with caplog.at_level(logging.INFO, logger="lai.speech"):
            assert _say(client) == MP3
        assert sleeps == []
        _no_leaks(caplog)
        assert "polly synthesized voice=Justin engine=neural" in caplog.text

    def test_ssml_is_passed_through_with_its_type(self, stubbed, sleeps):
        client, stub = stubbed
        ssml = '<speak><prosody rate="105%">Ahoy</prosody></speak>'
        stub.add_response("synthesize_speech", _audio(), _expected(ssml, "ssml"))
        assert _say(client, ssml, "ssml") == MP3

    def test_an_mpeg_frame_without_an_id3_tag_is_audio(self, stubbed, sleeps):
        client, stub = stubbed
        frame = b"\xff\xf3" + b"\x00" * 2000
        stub.add_response("synthesize_speech", _audio(frame), _expected())
        assert _say(client) == frame


class TestTransientFailures:
    def test_throttling_is_retried_with_backoff_then_succeeds(self, stubbed, sleeps):
        client, stub = stubbed
        stub.add_client_error("synthesize_speech", "ThrottlingException", http_status_code=400)
        stub.add_response("synthesize_speech", _audio(), _expected())
        assert _say(client) == MP3
        assert sleeps == [0.2]

    def test_throttling_that_never_clears_is_a_safe_503(self, stubbed, sleeps, caplog):
        client, stub = stubbed
        for _ in range(3):  # 1 + LAI_SPEECH_RETRIES
            stub.add_client_error(
                "synthesize_speech", "ThrottlingException", AWS_MESSAGE, http_status_code=400
            )
        with caplog.at_level(logging.INFO, logger="lai.speech"), pytest.raises(SpeechError) as err:
            _say(client)
        assert (err.value.code, err.value.status, err.value.reason) == (
            "speech_unavailable",
            503,
            "throttled",
        )
        assert err.value.message == "Speech could not be made right now."
        assert sleeps == [0.2, 0.4]
        _no_leaks(caplog)

    def test_a_service_failure_is_retried(self, stubbed, sleeps):
        client, stub = stubbed
        stub.add_client_error("synthesize_speech", "ServiceFailureException", http_status_code=500)
        stub.add_response("synthesize_speech", _audio(), _expected())
        assert _say(client) == MP3

    def test_retries_are_bounded_by_the_setting(self, settings, sleeps):
        settings.LAI_SPEECH_RETRIES = 0
        raw = _client()
        with Stubber(raw) as stub:
            stub.add_client_error("synthesize_speech", "ThrottlingException")
            with pytest.raises(SpeechError):
                _say(Boto3PollyClient(raw))
        assert sleeps == []


class _Raising:
    """A Polly client whose transport fails the way botocore does (Stubber cannot)."""

    def __init__(self, *errors, then=None):
        self.errors = list(errors)
        self.then = then
        self.calls = 0

    def synthesize_speech(self, **_kwargs):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.then


class TestTimeoutsAndCredentials:
    def test_a_timeout_is_retried_then_succeeds(self, settings, sleeps):
        settings.LAI_SPEECH_RETRIES = 2
        raw = _Raising(ReadTimeoutError(endpoint_url="https://polly"), then=_audio())
        assert _say(Boto3PollyClient(raw)) == MP3
        assert raw.calls == 2 and sleeps == [0.2]

    def test_timeouts_every_time_are_a_safe_503(self, settings, sleeps):
        settings.LAI_SPEECH_RETRIES = 1
        raw = _Raising(*(ReadTimeoutError(endpoint_url="https://polly") for _ in range(2)))
        with pytest.raises(SpeechError) as err:
            _say(Boto3PollyClient(raw))
        assert (err.value.code, err.value.reason, raw.calls) == ("speech_unavailable", "timeout", 2)

    def test_missing_credentials_are_never_retried(self, settings, sleeps):
        settings.LAI_SPEECH_RETRIES = 3
        raw = _Raising(NoCredentialsError())
        with pytest.raises(SpeechError) as err:
            _say(Boto3PollyClient(raw))
        assert (err.value.reason, raw.calls, sleeps) == ("access_denied", 1, [])


class TestPermanentFailures:
    def test_iam_denial_is_not_retried_and_leaks_nothing(self, stubbed, sleeps, caplog):
        client, stub = stubbed
        stub.add_client_error(
            "synthesize_speech", "AccessDeniedException", AWS_MESSAGE, http_status_code=403
        )
        with caplog.at_level(logging.INFO, logger="lai.speech"), pytest.raises(SpeechError) as err:
            _say(client)
        assert (err.value.code, err.value.status, err.value.reason) == (
            "speech_unavailable",
            503,
            "access_denied",
        )
        assert "arn" not in str(err.value) and sleeps == []
        assert "code=AccessDeniedException" in caplog.text
        _no_leaks(caplog)

    @pytest.mark.parametrize(
        "code",
        ["ValidationException", "EngineNotSupportedException", "LanguageNotSupportedException"],
    )
    def test_an_invalid_voice_is_a_safe_refusal_without_retry(self, stubbed, sleeps, code):
        client, stub = stubbed
        stub.add_client_error("synthesize_speech", code, http_status_code=400)
        with pytest.raises(SpeechError) as err:
            _say(client, voice="Kevin", engine="standard")
        assert (err.value.code, err.value.reason) == ("speech_unavailable", "invalid_voice")
        assert err.value.message == "This voice is not available." and sleeps == []

    @pytest.mark.parametrize("code", ["TextLengthExceededException", "InvalidSsmlException"])
    def test_rejected_input_is_a_422(self, stubbed, sleeps, code):
        client, stub = stubbed
        stub.add_client_error("synthesize_speech", code, http_status_code=400)
        with pytest.raises(SpeechError) as err:
            _say(client)
        assert (err.value.code, err.value.status, err.value.reason) == (
            "speech_rejected",
            422,
            "invalid_input",
        )

    @pytest.mark.parametrize(
        "text,text_type", [("", "text"), ("x" * 6001, "text"), ("Hello", "json")]
    )
    def test_malformed_input_never_reaches_aws(self, text, text_type):
        raw = _Raising()
        with pytest.raises(SpeechError) as err:
            _say(Boto3PollyClient(raw), text, text_type)
        assert err.value.status == 422 and raw.calls == 0


class TestAudioChecks:
    @pytest.mark.parametrize(
        "body,content_type",
        [
            (b"", "audio/mpeg"),
            (b"<html>error</html>" * 100, "audio/mpeg"),
            (MP3, "application/json"),
        ],
    )
    def test_an_answer_that_is_not_mp3_is_refused(self, stubbed, sleeps, body, content_type):
        client, stub = stubbed
        stub.add_response("synthesize_speech", _audio(body, content_type), _expected())
        with pytest.raises(SpeechError) as err:
            _say(client)
        assert (err.value.code, err.value.reason) == ("speech_unavailable", "bad_audio")

    def test_oversized_audio_is_refused(self, monkeypatch, stubbed, sleeps):
        monkeypatch.setattr(polly, "MAX_AUDIO_BYTES", 100)
        client, stub = stubbed
        stub.add_response("synthesize_speech", _audio(), _expected())
        with pytest.raises(SpeechError) as err:
            _say(client)
        assert err.value.reason == "bad_audio"

    def test_mp3_detection(self):
        assert looks_like_mp3(b"ID3....") and looks_like_mp3(b"\xff\xfb\x90")
        assert (
            not looks_like_mp3(b"") and not looks_like_mp3(b"RIFF") and not looks_like_mp3(b"\xff")
        )


class TestClassification:
    @pytest.mark.parametrize(
        "error,expected",
        [
            (NoCredentialsError(), ("access_denied", False)),
            (ReadTimeoutError(endpoint_url="x"), ("timeout", True)),
            (ValueError("boom"), ("unexpected", False)),
        ],
    )
    def test_transport_errors(self, error, expected):
        assert classify(error) == expected


class TestVoiceReport:
    def test_reads_every_page_of_describe_voices(self):
        raw = _client()
        with Stubber(raw) as stub:
            stub.add_response(
                "describe_voices",
                {
                    "Voices": [{"Id": "Justin", "SupportedEngines": ["standard", "neural"]}],
                    "NextToken": "page-2",
                },
                {"LanguageCode": "en-US", "IncludeAdditionalLanguageCodes": True},
            )
            stub.add_response(
                "describe_voices",
                {"Voices": [{"Id": "Kevin", "SupportedEngines": ["neural"]}]},
                {
                    "LanguageCode": "en-US",
                    "IncludeAdditionalLanguageCodes": True,
                    "NextToken": "page-2",
                },
            )
            report = Boto3PollyClient(raw).voice_report("en-US")
        assert report == {"Justin": ("standard", "neural"), "Kevin": ("neural",)}


class TestProviderSelection:
    @pytest.mark.parametrize(
        "provider,kind",
        [("disabled", DisabledPollyClient), ("fake", FakePollyClient), ("polly", Boto3PollyClient)],
    )
    def test_the_setting_picks_the_client(self, settings, provider, kind):
        settings.LAI_SPEECH_PROVIDER = provider
        set_polly_client(None)
        assert isinstance(get_polly_client(), kind)
        set_polly_client(None)

    def test_the_real_client_is_built_lazily_with_region_and_timeouts(self, settings):
        settings.LAI_SPEECH_AWS_REGION = "eu-west-2"
        settings.LAI_SPEECH_TIMEOUT_SECONDS = 3
        client = Boto3PollyClient()
        assert client._client is None  # noqa: SLF001 - nothing built, no credential lookup
        built = client._polly()  # noqa: SLF001
        assert built.meta.region_name == "eu-west-2"
        assert built.meta.config.read_timeout == 3 and built.meta.config.connect_timeout == 3

    def test_disabled_refuses(self):
        with pytest.raises(SpeechError) as err:
            DisabledPollyClient().synthesize(text="x")
        assert err.value.code == "speech_disabled"
