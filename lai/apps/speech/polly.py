"""Amazon Polly behind one small interface (SM-P8-02, SM-P8-LIVE).

`synthesize` returns MP3 bytes or raises `SpeechError`, whose message is safe to show a child's
app and to log: it never carries an AWS error message, a request id, a credential or the text.
`SpeechError.reason` is a stable, log-safe classification (`throttled`, `timeout`,
`access_denied`, `invalid_voice`, `invalid_input`, `service`, `bad_audio`, ...) for metrics and
runbooks; it is never shown to a child. The real client lives behind `get_polly_client()`, which
returns:

- a client that refuses everything when `LAI_SPEECH_PROVIDER` is `disabled` (the default);
- `FakePollyClient` for `fake`, deterministic placeholder bytes, no network;
- `Boto3PollyClient` for `polly`, built lazily so tests and local development never import boto3
  or look for AWS credentials. Credentials come from the standard AWS credential chain (the
  runtime IAM role in deployed environments), never from settings or source.

Timeouts are explicit and retries are bounded (`LAI_SPEECH_RETRIES`), only for failures worth
retrying (throttling, service errors, timeouts, dropped connections), with a short capped
exponential backoff. Permission, credential, voice and input errors are never retried. The
returned audio is checked to be MP3 and bounded in size before anything stores it.
"""

import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

from django.conf import settings

logger = logging.getLogger("lai.speech")

#: Polly's own ceiling for one request (billed characters are 3000; SSML tags count toward 6000).
POLLY_MAX_REQUEST_CHARS = 6000
#: Generated speech is short dialogue; anything larger than this is not a line we asked for.
MAX_AUDIO_BYTES = 8 * 1024 * 1024


class SpeechError(Exception):
    """A speech request could not be served. `code` is stable; `message` is safe for anyone."""

    def __init__(self, code: str, message: str, *, status: int = 503, reason: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        #: Log-safe classification for operators; never shown to a child.
        self.reason = reason or code


class PollyClient(Protocol):
    def synthesize(
        self, *, text: str, text_type: str, voice_id: str, engine: str, language: str
    ) -> bytes: ...


class DisabledPollyClient:
    def synthesize(self, **_kwargs) -> bytes:
        raise SpeechError("speech_disabled", "Spoken dialogue is turned off.")


@dataclass
class FakePollyClient:
    """No network. Deterministic bytes that depend on the request, so cache tests can tell."""

    calls: list[dict] = field(default_factory=list)
    fail_with: SpeechError | None = None
    fail_times: int = 0

    def synthesize(self, *, text, text_type, voice_id, engine, language) -> bytes:
        self.calls.append(
            {
                "text": text,
                "text_type": text_type,
                "voice_id": voice_id,
                "engine": engine,
                "language": language,
            }
        )
        if self.fail_with is not None and (
            self.fail_times == 0 or len(self.calls) <= self.fail_times
        ):
            raise self.fail_with
        digest = hashlib.sha256(f"{voice_id}|{engine}|{language}|{text}".encode()).hexdigest()
        return b"ID3\x04\x00\x00\x00\x00\x00\x00FAKE-MP3:" + digest.encode()


# --- error classification ------------------------------------------------------------------------

#: AWS error codes that are worth another try.
_RETRYABLE_CODES = frozenset(
    {
        "ThrottlingException",
        "Throttling",
        "TooManyRequestsException",
        "RequestLimitExceeded",
        "ServiceFailureException",
        "ServiceUnavailable",
        "ServiceUnavailableException",
        "InternalFailure",
        "InternalServerError",
    }
)
_THROTTLE_CODES = frozenset(
    {"ThrottlingException", "Throttling", "TooManyRequestsException", "RequestLimitExceeded"}
)
#: botocore transport exceptions (by class name, so boto3 is never imported for this table).
_TIMEOUT_ERRORS = frozenset({"ReadTimeoutError", "ConnectTimeoutError"})
_CONNECTION_ERRORS = frozenset(
    {"EndpointConnectionError", "ConnectionClosedError", "ProxyConnectionError"}
)
_CREDENTIAL_ERRORS = frozenset(
    {
        "NoCredentialsError",
        "PartialCredentialsError",
        "CredentialRetrievalError",
        "UnknownCredentialError",
    }
)
_ACCESS_CODES = frozenset(
    {
        "AccessDeniedException",
        "AccessDenied",
        "UnrecognizedClientException",
        "InvalidClientTokenId",
        "ExpiredTokenException",
        "ExpiredToken",
        "SignatureDoesNotMatch",
    }
)
_VOICE_CODES = frozenset(
    {
        "EngineNotSupportedException",
        "LanguageNotSupportedException",
        "InvalidSampleRateException",
        "LexiconNotFoundException",
        "ValidationException",  # an unknown VoiceId is a ValidationException
    }
)
_INPUT_CODES = frozenset(
    {
        "TextLengthExceededException",
        "InvalidSsmlException",
        "SsmlMarksNotSupportedForTextTypeException",
    }
)


def classify(error: BaseException) -> tuple[str, bool]:
    """(log-safe reason, worth retrying) for an exception raised by botocore."""
    name = type(error).__name__
    code = ""
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        code = str(response.get("Error", {}).get("Code", ""))
    if code in _THROTTLE_CODES:
        return "throttled", True
    if code in _RETRYABLE_CODES:
        return "service", True
    if name in _TIMEOUT_ERRORS:
        return "timeout", True
    if name in _CONNECTION_ERRORS:
        return "connection", True
    if name in _CREDENTIAL_ERRORS or code in _ACCESS_CODES:
        return "access_denied", False
    if code in _VOICE_CODES:
        return "invalid_voice", False
    if code in _INPUT_CODES:
        return "invalid_input", False
    return "unexpected", False


def looks_like_mp3(data: bytes) -> bool:
    """An ID3 tag or an MPEG audio frame sync at the start. Polly MP3 starts with one of these."""
    if data.startswith(b"ID3"):
        return True
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def _unavailable(reason: str) -> SpeechError:
    return SpeechError("speech_unavailable", "Speech could not be made right now.", reason=reason)


#: Test seam: the backoff sleep.
_sleep = time.sleep


class Boto3PollyClient:
    def __init__(self, client=None):
        self._client = client

    def _polly(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            timeout = settings.LAI_SPEECH_TIMEOUT_SECONDS
            self._client = boto3.client(
                "polly",
                region_name=settings.LAI_SPEECH_AWS_REGION,
                config=Config(
                    connect_timeout=timeout,
                    read_timeout=timeout,
                    # Retries are ours (bounded, logged, classified); botocore makes one attempt.
                    retries={"max_attempts": 1, "mode": "standard"},
                ),
            )
        return self._client

    def _read_audio(self, response: dict) -> bytes:
        content_type = str(response.get("ContentType") or "audio/mpeg")
        if content_type.split(";")[0].strip().lower() not in {"audio/mpeg", "audio/mp3"}:
            raise _unavailable("bad_audio")
        stream = response.get("AudioStream")
        if stream is None:
            raise _unavailable("bad_audio")
        try:
            data = stream.read(MAX_AUDIO_BYTES + 1)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()
        if not data or len(data) > MAX_AUDIO_BYTES or not looks_like_mp3(data):
            raise _unavailable("bad_audio")
        return data

    def synthesize(self, *, text, text_type, voice_id, engine, language) -> bytes:
        if not text or len(text) > POLLY_MAX_REQUEST_CHARS or text_type not in {"text", "ssml"}:
            raise SpeechError(
                "speech_rejected", "That line cannot be spoken.", status=422, reason="invalid_input"
            )
        attempts = 1 + max(0, settings.LAI_SPEECH_RETRIES)
        reason = "unexpected"
        for attempt in range(attempts):
            started = time.monotonic()
            try:
                response = self._polly().synthesize_speech(
                    Text=text,
                    TextType=text_type,
                    OutputFormat="mp3",
                    VoiceId=voice_id,
                    Engine=engine,
                    LanguageCode=language,
                )
                data = self._read_audio(response)
                logger.info(
                    "polly synthesized voice=%s engine=%s chars=%d bytes=%d ms=%d attempt=%d",
                    voice_id,
                    engine,
                    len(text),
                    len(data),
                    int((time.monotonic() - started) * 1000),
                    attempt + 1,
                )
                return data
            except SpeechError as error:
                logger.warning("polly answer refused: %s", error.reason)
                raise
            except Exception as error:  # noqa: BLE001 - classified below, never shown
                reason, transient = classify(error)
                code = ""
                if isinstance(getattr(error, "response", None), dict):
                    code = str(error.response.get("Error", {}).get("Code", ""))
                # The code and class name only: AWS messages can echo input, so never log them.
                logger.warning(
                    "polly request failed: reason=%s code=%s attempt=%d/%d",
                    reason,
                    code or type(error).__name__,
                    attempt + 1,
                    attempts,
                )
                if transient and attempt + 1 < attempts:
                    _sleep(min(0.2 * (2**attempt), 1.0))
                    continue
                if reason == "invalid_input":
                    raise SpeechError(
                        "speech_rejected", "That line cannot be spoken.", status=422, reason=reason
                    ) from None
                if reason == "invalid_voice":
                    raise SpeechError(
                        "speech_unavailable", "This voice is not available.", reason=reason
                    ) from None
                raise _unavailable(reason) from None
        raise _unavailable(reason)

    def voice_report(self, language: str) -> dict[str, tuple[str, ...]]:
        """{voice id: supported engines} for a language in this region (DescribeVoices).

        Used by the opt-in live smoke test to check the hand-maintained voice table against what
        the configured region actually offers. Free to call; makes no synthesis.
        """
        found: dict[str, tuple[str, ...]] = {}
        token = None
        while True:
            kwargs = {"LanguageCode": language, "IncludeAdditionalLanguageCodes": True}
            if token:
                kwargs["NextToken"] = token
            page = self._polly().describe_voices(**kwargs)
            for voice in page.get("Voices", []):
                found[voice["Id"]] = tuple(voice.get("SupportedEngines") or ())
            token = page.get("NextToken")
            if not token:
                return found


_client: PollyClient | None = None


def get_polly_client() -> PollyClient:
    global _client
    if _client is None:
        provider = settings.LAI_SPEECH_PROVIDER
        if provider == "fake":
            _client = FakePollyClient()
        elif provider == "polly":
            _client = Boto3PollyClient()
        else:
            _client = DisabledPollyClient()
    return _client


def set_polly_client(client: PollyClient | None) -> None:
    """Test seam: install a client (or None to rebuild from settings)."""
    global _client
    _client = client
