"""Amazon Polly behind one small interface (SM-P8-02).

`synthesize` returns MP3 bytes or raises `SpeechError`, whose message is safe to show a child's
app and to log: it never carries an AWS error, a request id, a credential or the text. The real
client lives behind `get_polly_client()`, which returns:

- a client that refuses everything when `LAI_SPEECH_PROVIDER` is `disabled` (the default);
- `FakePollyClient` for `fake`, deterministic placeholder bytes, no network;
- `Boto3PollyClient` for `polly`, built lazily so tests and local development never import boto3
  or look for AWS credentials. Credentials come from the runtime role, never from settings.

Timeouts are explicit and retries are bounded (`LAI_SPEECH_RETRIES`), only for failures worth
retrying (throttling, service errors, timeouts), with a short backoff.
"""

import hashlib
import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

from django.conf import settings

logger = logging.getLogger("lai.speech")


class SpeechError(Exception):
    """A speech request could not be served. `code` is stable; `message` is safe for anyone."""

    def __init__(self, code: str, message: str, *, status: int = 503):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


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


#: AWS error codes that are worth another try.
_RETRYABLE = frozenset(
    {"ThrottlingException", "ServiceFailureException", "ServiceUnavailable", "InternalFailure"}
)


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
                    connect_timeout=timeout, read_timeout=timeout, retries={"max_attempts": 0}
                ),
            )
        return self._client

    def synthesize(self, *, text, text_type, voice_id, engine, language) -> bytes:
        attempts = 1 + max(0, settings.LAI_SPEECH_RETRIES)
        for attempt in range(attempts):
            try:
                response = self._polly().synthesize_speech(
                    Text=text,
                    TextType=text_type,
                    OutputFormat="mp3",
                    VoiceId=voice_id,
                    Engine=engine,
                    LanguageCode=language,
                )
                stream = response.get("AudioStream")
                data = stream.read() if stream is not None else b""
                if not data:
                    raise SpeechError("speech_unavailable", "Speech could not be made right now.")
                return data
            except SpeechError:
                raise
            except Exception as error:  # noqa: BLE001 - mapped below, never shown
                code = getattr(error, "response", {}).get("Error", {}).get("Code", "")
                transient = code in _RETRYABLE or type(error).__name__ in {
                    "ReadTimeoutError",
                    "ConnectTimeoutError",
                    "EndpointConnectionError",
                }
                logger.warning("polly request failed: %s", code or type(error).__name__)
                if transient and attempt + 1 < attempts:
                    time.sleep(min(0.2 * (2**attempt), 1.0))
                    continue
                if code in {"TextLengthExceededException", "InvalidSsmlException"}:
                    raise SpeechError(
                        "speech_rejected", "That line cannot be spoken.", status=422
                    ) from None
                raise SpeechError(
                    "speech_unavailable", "Speech could not be made right now."
                ) from None
        raise SpeechError("speech_unavailable", "Speech could not be made right now.")


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
