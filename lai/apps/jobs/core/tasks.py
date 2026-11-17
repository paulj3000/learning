"""The work each job kind does, run by the Lambda worker and by Django's inline backend.

`run(kind, payload, ports)` validates the payload, does the work through `ports` and returns the
result dict. It raises `TaskError(code, retryable)`: a retryable error is retried by SQS (and
lands in the DLQ after three receives); a non-retryable one becomes a `failed` result. Nothing
here logs text, prompts or model output.

Ports (duck-typed; only what a kind uses):
- studio: `studio_model_id` (configured model), `approved_model_ids`, `invoke_model(request)`
  returning an object with `output`, `input_tokens`, `output_tokens`, `guardrail_intervened`,
  `model_id`, or raising an exception with a string `category`; optional `time_left_ms()`.
- speech: `speech_object_size(key) -> int | None`, `synthesize(text=, text_type=, voice_id=,
  engine=, language=) -> bytes`, `put_speech(key, data)`.
- asset: `asset_object_size(key) -> int | None`, `read_asset(key, start, length) -> bytes`.
- asset.validate_model, reference.checksum: the asset ports (core/contract.py).
"""

import re

from . import contract, envelope, probe


class TaskError(Exception):
    """A job could not be done. `code` is a stable, log-safe string."""

    def __init__(self, code: str, *, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def _require(condition: bool, field: str) -> None:
    if not condition:
        raise TaskError("invalid_payload")


def _exact(payload: dict, keys: set[str]) -> None:
    _require(isinstance(payload, dict) and set(payload) == keys, "keys")


def _int(value: object, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _text(value: object, high: int, *, empty: bool = False) -> bool:
    return isinstance(value, str) and (empty or bool(value)) and len(value) <= high


# --- studio.generate_chunk --------------------------------------------------------------------

#: Studio chunk failures worth another attempt. Everything else fails the same way again.
STUDIO_RETRYABLE = frozenset(
    {"TIMEOUT", "THROTTLED", "UNAVAILABLE", "INVALID_RESPONSE", "TRUNCATED"}
)

_REQUEST_KEYS = {
    "route",
    "system_prompt",
    "content",
    "output_schema",
    "schema_name",
    "max_output_tokens",
    "temperature",
}
STUDIO_PAYLOAD_KEYS = {
    "batch_id",
    "chunk_index",
    "want",
    "offset",
    "requested_before",
    "max_attempts",
    "model_id",
    "request",
}


def call_chunk(invoke, max_attempts: int, *, may_retry=None) -> dict:
    """One Studio chunk: bounded attempts, the same rules in every runner.

    `invoke()` returns a model response or raises an exception carrying a string `category`
    (a `ProviderError`); any other exception propagates. Returns `items`, token counts,
    `attempts` and `failure` (a failure category, or "" when the chunk produced items).
    """
    chunk = {"items": [], "input_tokens": 0, "output_tokens": 0, "attempts": 0, "failure": ""}
    for _ in range(max(1, max_attempts)):
        if chunk["attempts"] and may_retry is not None and not may_retry():
            break
        chunk["attempts"] += 1
        try:
            response = invoke()
        except Exception as error:
            category = getattr(error, "category", None)
            if not isinstance(category, str):
                raise
            chunk["failure"] = category
            if category not in STUDIO_RETRYABLE:
                return chunk
            continue
        if isinstance(getattr(response, "model_id", None), str):
            chunk["model_id"] = response.model_id[:200]
        chunk["input_tokens"] += response.input_tokens or 0
        chunk["output_tokens"] += response.output_tokens or 0
        if response.guardrail_intervened:
            chunk["failure"] = "GUARDRAIL"
            return chunk
        output = response.output
        questions = output.get("questions") if isinstance(output, dict) else None
        if not isinstance(questions, list):
            chunk["failure"] = "INVALID_RESPONSE"
            continue
        chunk["items"], chunk["failure"] = questions, ""
        return chunk
    return chunk


def validate_studio_payload(payload: dict) -> dict:
    _exact(payload, STUDIO_PAYLOAD_KEYS)
    _require(_text(payload["batch_id"], 64), "batch_id")
    _require(_int(payload["chunk_index"], 0, 1000), "chunk_index")
    _require(_int(payload["want"], 1, 100), "want")
    _require(_int(payload["offset"], 0, 100000), "offset")
    _require(_int(payload["requested_before"], 0, 100000), "requested_before")
    _require(_int(payload["max_attempts"], 1, 5), "max_attempts")
    _require(_text(payload["model_id"], 200), "model_id")
    request = payload["request"]
    _exact(request, _REQUEST_KEYS)
    _require(_text(request["route"], 40), "route")
    _require(_text(request["system_prompt"], 20000), "system_prompt")
    _require(_text(request["schema_name"], 64), "schema_name")
    _require(isinstance(request["output_schema"], dict), "output_schema")
    _require(_int(request["max_output_tokens"], 1, 8192), "max_output_tokens")
    temperature = request["temperature"]
    _require(
        isinstance(temperature, int | float)
        and not isinstance(temperature, bool)
        and 0 <= temperature <= 1,
        "temperature",
    )
    content = request["content"]
    _require(isinstance(content, list) and 1 <= len(content) <= 8, "content")
    for part in content:
        _exact(part, {"text", "untrusted", "guarded"})
        _require(_text(part["text"], 20000), "content.text")
        _require(type(part["untrusted"]) is bool and type(part["guarded"]) is bool, "flags")
    # A request with no assessed block would have the Guardrail assess our own instructions;
    # the Studio always sends one (staff notes, or the guarded marker). Refuse anything else.
    _require(any(p["untrusted"] or p["guarded"] for p in content), "content.assessed")
    return payload


def studio_generate_chunk(payload: dict, ports) -> dict:
    validate_studio_payload(payload)
    configured = ports.studio_model_id
    if payload["model_id"] != configured or configured not in ports.approved_model_ids:
        raise TaskError("model_not_approved")
    time_left = getattr(ports, "time_left_ms", None)
    timeout_ms = int(getattr(ports, "attempt_budget_ms", 0) or 0)

    def may_retry() -> bool:
        return time_left is None or time_left() > timeout_ms

    chunk = call_chunk(
        lambda: ports.invoke_model(payload["request"]),
        payload["max_attempts"],
        may_retry=may_retry,
    )
    chunk["items"] = chunk["items"][: payload["want"]]
    chunk.setdefault("model_id", configured)
    return chunk


# --- speech.synthesize ------------------------------------------------------------------------

#: Only shared (authored) clips are ever made by a job; a child's clip never leaves Django.
SHARED_SPEECH_KEY = re.compile(r"^speech/shared/([0-9a-f]{2})/([0-9a-f]{64})\.mp3$")
SPEECH_PAYLOAD_KEYS = {
    "storage_key",
    "text",
    "text_type",
    "voice_id",
    "engine",
    "language",
    # Django's own bookkeeping, echoed back untouched; never sent to Polly.
    "voice_profile_id",
    "characters",
}
#: Optional: the Polly region Django is configured with (LAI_SPEECH_AWS_REGION); '' = the worker's.
SPEECH_OPTIONAL_KEYS = {"polly_region"}
AWS_REGION_PATTERN = re.compile(r"[a-z]{2}(-gov)?-[a-z]+-[0-9]")
SPEECH_ENGINES = frozenset({"standard", "neural", "generative", "long-form"})
MAX_SPEECH_REQUEST_CHARS = 6000
MAX_AUDIO_BYTES = 8 * 1024 * 1024


def valid_shared_speech_key(key: object) -> bool:
    match = SHARED_SPEECH_KEY.fullmatch(key) if isinstance(key, str) else None
    return bool(match and match.group(2).startswith(match.group(1)))


def looks_like_mp3(data: bytes) -> bool:
    if data.startswith(b"ID3"):
        return True
    return len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0


def validate_speech_payload(payload: dict) -> dict:
    _require(
        isinstance(payload, dict)
        and SPEECH_PAYLOAD_KEYS <= set(payload) <= SPEECH_PAYLOAD_KEYS | SPEECH_OPTIONAL_KEYS,
        "keys",
    )
    region = payload.get("polly_region", "")
    _require(
        isinstance(region, str) and (region == "" or AWS_REGION_PATTERN.fullmatch(region)),
        "polly_region",
    )
    if not valid_shared_speech_key(payload["storage_key"]):
        raise TaskError("invalid_speech_key")
    _require(_text(payload["text"], MAX_SPEECH_REQUEST_CHARS), "text")
    _require(payload["text_type"] in {"text", "ssml"}, "text_type")
    _require(
        isinstance(payload["voice_id"], str)
        and re.fullmatch(r"[A-Z][A-Za-z]{1,31}", payload["voice_id"]) is not None,
        "voice_id",
    )
    _require(payload["engine"] in SPEECH_ENGINES, "engine")
    _require(
        isinstance(payload["language"], str)
        and re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}", payload["language"]) is not None,
        "language",
    )
    _require(_text(payload["voice_profile_id"], 40), "voice_profile_id")
    _require(_int(payload["characters"], 1, MAX_SPEECH_REQUEST_CHARS), "characters")
    return payload


def speech_synthesize(payload: dict, ports) -> dict:
    validate_speech_payload(payload)
    key = payload["storage_key"]
    existing = ports.speech_object_size(key)
    if existing:
        # Content-addressed: the object for this key is this clip. Never pay Polly twice.
        return {"storage_key": key, "byte_size": existing, "reused": True}
    request = {
        "text": payload["text"],
        "text_type": payload["text_type"],
        "voice_id": payload["voice_id"],
        "engine": payload["engine"],
        "language": payload["language"],
    }
    if payload.get("polly_region"):
        request["region"] = payload["polly_region"]
    audio = ports.synthesize(**request)
    if not audio or len(audio) > MAX_AUDIO_BYTES or not looks_like_mp3(audio):
        raise TaskError("bad_audio")
    ports.put_speech(key, audio)
    return {"storage_key": key, "byte_size": len(audio), "reused": False}


# --- asset.inspect ----------------------------------------------------------------------------

ASSET_FORMATS = {
    "glb": "models",
    "gltf": "models",
    "png": "images",
    "jpeg": "images",
    "webp": "images",
    "mp3": "audio",
    "wav": "audio",
    "ogg": "audio",
}
_STEMS = {"models": "model", "images": "image", "audio": "audio"}
ASSET_KEY = re.compile(
    r"^assets/(models|images|audio)/[a-z0-9]+(?:-[a-z0-9]+)*/"
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/"
    r"(model|image|audio)\.(glb|gltf|png|jpeg|webp|mp3|wav|ogg)$"
)
#: The largest object an inspection will touch (the asset library's own upload ceiling).
MAX_ASSET_BYTES = 64 * 1024 * 1024


def valid_asset_key(key: object, file_format: object) -> bool:
    match = ASSET_KEY.fullmatch(key) if isinstance(key, str) and len(key) <= 300 else None
    if not match or file_format not in ASSET_FORMATS:
        return False
    directory, stem, extension = match.groups()
    return (
        extension == file_format
        and ASSET_FORMATS[file_format] == directory
        and _STEMS[directory] == stem
    )


def asset_inspect(payload: dict, ports) -> dict:
    _exact(payload, {"storage_key", "format"})
    key, file_format = payload["storage_key"], payload["format"]
    if not valid_asset_key(key, file_format):
        raise TaskError("invalid_asset_key")
    size = ports.asset_object_size(key)
    if size is None:
        raise TaskError("object_missing")
    if size > MAX_ASSET_BYTES:
        raise TaskError("object_too_large")
    metadata = probe.probe(
        file_format, lambda start, length: ports.read_asset(key, start, length), size
    )
    return {"storage_key": key, "format": file_format, "size_bytes": size, "metadata": metadata}


RUNNERS = {
    envelope.STUDIO_GENERATE_CHUNK: studio_generate_chunk,
    envelope.SPEECH_SYNTHESIZE: speech_synthesize,
    envelope.ASSET_INSPECT: asset_inspect,
    envelope.ASSET_VALIDATE_MODEL: lambda payload, ports: contract.run(
        envelope.ASSET_VALIDATE_MODEL, payload, ports
    ),
    envelope.REFERENCE_CHECKSUM: lambda payload, ports: contract.run(
        envelope.REFERENCE_CHECKSUM, payload, ports
    ),
    envelope.ASSET_PROCESS_AUDIO: lambda payload, ports: contract.run(
        envelope.ASSET_PROCESS_AUDIO, payload, ports
    ),
}


def run(kind: str, payload: dict, ports) -> dict:
    runner = RUNNERS.get(kind)
    if runner is None:
        raise TaskError("unknown_kind")
    return runner(payload, ports)
