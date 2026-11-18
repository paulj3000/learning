"""The worker's AWS side: configuration, result storage and the ports each task uses.

Configuration comes from the function's environment (queue, buckets, SSM prefix) and, for the AI
worker, from SSM Parameter Store under `LAI_SSM_PREFIX` (model id, Guardrail id and version,
Bedrock region, approved models), read on first use and cached for `SSM_TTL_SECONDS`. A work
message never chooses the model or the Guardrail. Credentials come from the function's role.

AWS error messages are never logged or returned: errors become stable codes.
"""

import json
import os
import threading
import time

from .vendor.jobs_core import envelope
from .vendor.jobs_core.tasks import TaskError

SSM_TTL_SECONDS = 300
SSM_NAMES = (
    "LAI_AI_MODEL_ID",
    "LAI_AI_GUARDRAIL_ID",
    "LAI_AI_GUARDRAIL_VERSION",
    "LAI_AI_BEDROCK_REGION",
    "LAI_AI_MAX_ATTEMPTS",
    "LAI_AI_STRUCTURED_OUTPUT",
    "LAI_STUDIO_MODEL_ID",
    "LAI_STUDIO_APPROVED_MODEL_IDS",
    "LAI_STUDIO_TIMEOUT_SECONDS",
)
MAX_AUDIO_BYTES = 8 * 1024 * 1024

_MISSING_CODES = frozenset({"NoSuchKey", "404", "NotFound"})
# Asset reads (`asset.inspect`, `asset.validate_model`, `reference.checksum`): see
# `_asset_error` and docs/processing/CANONICAL_PATH.md, "Asset read errors".
_S3_VERSION_MISSING = frozenset({"NoSuchVersion"})
_S3_DENIED = frozenset(
    {
        "AccessDenied",
        "403",
        "Forbidden",
        "AllAccessDisabled",
        "AccountProblem",
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
    }
)
_S3_THROTTLED = frozenset(
    {
        "SlowDown",
        "Throttling",
        "ThrottlingException",
        "TooManyRequestsException",
        "RequestLimitExceeded",
        "503",
    }
)
_POLLY_RETRYABLE = frozenset(
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
_POLLY_ACCESS = frozenset(
    {
        "AccessDeniedException",
        "AccessDenied",
        "UnrecognizedClientException",
        "InvalidClientTokenId",
        "ExpiredTokenException",
        "ExpiredToken",
    }
)
_POLLY_VOICE = frozenset(
    {
        "EngineNotSupportedException",
        "LanguageNotSupportedException",
        "InvalidSampleRateException",
        "LexiconNotFoundException",
        "ValidationException",
    }
)
_POLLY_INPUT = frozenset(
    {
        "TextLengthExceededException",
        "InvalidSsmlException",
        "SsmlMarksNotSupportedForTextTypeException",
    }
)
_TRANSPORT = frozenset(
    {
        "ReadTimeoutError",
        "ConnectTimeoutError",
        "EndpointConnectionError",
        "ConnectionClosedError",
        "ProxyConnectionError",
    }
)


def error_code(error: BaseException) -> str:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        return str(response.get("Error", {}).get("Code", ""))
    return ""


def _is_missing(error: BaseException) -> bool:
    response = getattr(error, "response", None)
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode") if response else None
    return error_code(error) in _MISSING_CODES or status == 404


#: A 403 on a lookup in the worker's OWN cache prefixes (stored results, shared speech clips).
_DENIED_CODES = frozenset({"AccessDenied", "403", "Forbidden"})


def _is_absent_cache_entry(error: BaseException) -> bool:
    """Missing, for a cache lookup the role is allowed to read.

    S3 answers 403 instead of 404 for a missing key unless the caller is allowed s3:ListBucket on
    the bucket, and the results and speech ListBucket grants carry a plain `s3:prefix` condition
    that a GET or HEAD request may not satisfy. The role holds s3:GetObject on exactly these
    prefixes, so a 403 there means "not stored yet". Treating it as absent only costs a repeat of
    idempotent work: the result is re-applied as a duplicate by Django, a speech clip is
    re-synthesized. A real permission fault still surfaces at the PutObject that follows
    (`results_unavailable` / `storage`, retried). Asset INPUTS never use this rule: there a 403
    is `access_denied`, never missing (_asset_error).
    """
    if _is_missing(error):
        return True
    response = getattr(error, "response", None)
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode") if response else None
    return error_code(error) in _DENIED_CODES or status == 403


class Settings:
    """The function's environment, validated once."""

    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.queue = env.get("LAI_WORKER_QUEUE", "").strip()
        self.results_queue_url = env.get("LAI_RESULTS_QUEUE_URL", "").strip()
        self.results_bucket = env.get("LAI_RESULTS_BUCKET", "").strip()
        self.speech_bucket = env.get("LAI_SPEECH_BUCKET", "").strip()
        self.asset_bucket = env.get("LAI_ASSET_BUCKET", "").strip()
        self.ssm_prefix = env.get("LAI_SSM_PREFIX", "").strip().rstrip("/")
        if self.queue not in envelope.QUEUES:
            raise RuntimeError("LAI_WORKER_QUEUE must be ai, media, audio, image or optimize")
        if not self.results_queue_url or not self.results_bucket:
            raise RuntimeError("LAI_RESULTS_QUEUE_URL and LAI_RESULTS_BUCKET are required")
        if self.queue == "ai" and not self.ssm_prefix.startswith("/"):
            raise RuntimeError("LAI_SSM_PREFIX is required for the ai worker")

    @property
    def allowed_kinds(self) -> frozenset[str]:
        return envelope.kinds_for_queue(self.queue)


class AiConfig:
    """Model, Guardrail and Bedrock settings from SSM. Fails closed: no Guardrail, no call."""

    def __init__(self, values: dict[str, str]):
        self.model_id = values.get("LAI_AI_MODEL_ID", "")
        self.studio_model_id = values.get("LAI_STUDIO_MODEL_ID", "") or self.model_id
        approved = [
            item.strip()
            for item in values.get("LAI_STUDIO_APPROVED_MODEL_IDS", "").split(",")
            if item.strip()
        ]
        self.approved_model_ids = approved or [self.model_id]
        self.guardrail_id = values.get("LAI_AI_GUARDRAIL_ID", "")
        self.guardrail_version = values.get("LAI_AI_GUARDRAIL_VERSION", "")
        self.region = values.get("LAI_AI_BEDROCK_REGION", "")
        self.timeout_seconds = _number(values.get("LAI_STUDIO_TIMEOUT_SECONDS"), 60.0, 1, 120)
        self.max_attempts = int(_number(values.get("LAI_AI_MAX_ATTEMPTS"), 2, 1, 3))
        self.structured_output = values.get("LAI_AI_STRUCTURED_OUTPUT", "true").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    def problem(self) -> str | None:
        if not (self.model_id and self.studio_model_id and self.region):
            return "configuration"
        if not self.guardrail_id or not self.guardrail_version:
            return "guardrail_not_configured"
        if self.guardrail_version.upper() == "DRAFT":
            return "guardrail_not_configured"
        return None

    def key(self) -> tuple:
        return (
            self.region,
            self.studio_model_id,
            self.guardrail_id,
            self.guardrail_version,
            self.timeout_seconds,
            self.structured_output,
            self.max_attempts,
        )


def _number(raw, default, low, high):
    try:
        value = float(raw) if raw not in (None, "") else default
    except ValueError:
        value = default
    return min(max(value, low), high)


class Runtime:
    """One per warm container. Tests build their own with fake clients."""

    def __init__(
        self,
        settings: Settings | None = None,
        clients: dict | None = None,
        bedrock_factory=None,
        clock=time.monotonic,
    ):
        self.settings = settings or Settings()
        self._clients = dict(clients or {})
        self._bedrock_factory = bedrock_factory
        self._bedrock: dict[tuple, object] = {}
        self._ai: tuple[float, AiConfig] | None = None
        self._clock = clock
        self._lock = threading.Lock()

    # --- clients ---

    def client(self, name: str, region: str | None = None):
        cache_key = f"{name}@{region}" if region else name
        with self._lock:
            if cache_key not in self._clients:
                import boto3
                from botocore.config import Config

                self._clients[cache_key] = boto3.client(
                    name,
                    **({"region_name": region} if region else {}),
                    config=Config(
                        connect_timeout=5,
                        read_timeout=30,
                        retries={"max_attempts": 3, "mode": "standard"},
                    ),
                )
            return self._clients[cache_key]

    # --- results ---

    def load_result(self, job_id: str) -> dict | None:
        """The stored final result for a job, or None. Errors other than 'missing' retry."""
        try:
            response = self.client("s3").get_object(
                Bucket=self.settings.results_bucket, Key=envelope.result_key(job_id)
            )
        except Exception as error:  # noqa: BLE001
            if _is_absent_cache_entry(error):
                return None
            raise TaskError("results_unavailable", retryable=True) from None
        try:
            return envelope.parse_result(response["Body"].read())
        except envelope.EnvelopeError:
            raise TaskError("stored_result_invalid", retryable=True) from None

    def store_result(self, final: dict) -> None:
        try:
            self.client("s3").put_object(
                Bucket=self.settings.results_bucket,
                Key=envelope.result_key(final["job_id"]),
                Body=envelope.encode(final).encode(),
                ContentType="application/json",
                ServerSideEncryption="AES256",
            )
        except Exception:  # noqa: BLE001
            raise TaskError("results_unavailable", retryable=True) from None

    def send_result(self, message: dict) -> None:
        try:
            self.client("sqs").send_message(
                QueueUrl=self.settings.results_queue_url, MessageBody=envelope.encode(message)
            )
        except Exception:  # noqa: BLE001
            raise TaskError("results_queue_unavailable", retryable=True) from None

    # --- AI configuration (SSM) ---

    def ai_config(self) -> AiConfig:
        now = self._clock()
        if self._ai is not None and now - self._ai[0] < SSM_TTL_SECONDS:
            return self._ai[1]
        prefix = self.settings.ssm_prefix
        try:
            response = self.client("ssm").get_parameters(
                Names=[f"{prefix}/{name}" for name in SSM_NAMES], WithDecryption=True
            )
        except Exception:  # noqa: BLE001
            raise TaskError("config_unavailable", retryable=True) from None
        values = {
            item["Name"].rsplit("/", 1)[-1]: str(item.get("Value", "")).strip()
            for item in response.get("Parameters", [])
        }
        config = AiConfig(values)
        self._ai = (now, config)
        return config

    def bedrock_client(self, config: AiConfig):
        key = config.key()
        with self._lock:
            if key not in self._bedrock:
                if self._bedrock_factory is not None:
                    self._bedrock[key] = self._bedrock_factory(config)
                else:
                    from .vendor.ai_providers.bedrock import BedrockModelClient

                    self._bedrock[key] = BedrockModelClient(
                        region=config.region,
                        model_id=config.studio_model_id,
                        guardrail_id=config.guardrail_id,
                        guardrail_version=config.guardrail_version,
                        timeout_seconds=config.timeout_seconds,
                        structured_output=config.structured_output,
                        max_attempts=config.max_attempts,
                    )
            return self._bedrock[key]

    # --- ports ---

    def ports(self, kind: str, context):
        if kind == envelope.STUDIO_GENERATE_CHUNK:
            return StudioPorts(self, context)
        if kind == envelope.SPEECH_SYNTHESIZE:
            return SpeechPorts(self)
        if kind in (
            envelope.ASSET_INSPECT,
            envelope.ASSET_VALIDATE_MODEL,
            envelope.REFERENCE_CHECKSUM,
            envelope.ASSET_ANALYZE_ANIMATION,
            envelope.ASSET_PROCESS_AUDIO,
            # Derived-artifact workloads (ADR-066): the native workers read the input through the
            # same ports and write artifacts only through `artifact_storage`.
            envelope.ASSET_TRANSCODE_AUDIO,
            envelope.ASSET_CONVERT_IMAGE,
            envelope.ASSET_OPTIMIZE,
        ):
            return AssetPorts(self)
        raise TaskError("unknown_kind")

    def artifact_storage(self, namespace: str, job_id: str, attempt_id: str):
        """The create-only artifact store for one attempt (`artifact_store.S3ObjectStore`): reads
        the asset bucket, writes only `processing/artifacts/<namespace>/<job>/<attempt>/`.
        Native workers pass it as the engine's `storage`."""
        from lai_processing.contracts.identifiers import artifact_prefix

        from .artifact_store import S3ObjectStore

        if not self.settings.asset_bucket:
            raise TaskError("configuration")
        return S3ObjectStore(
            self.client("s3"),
            self.settings.asset_bucket,
            namespace,
            attempt_prefix=artifact_prefix(namespace, job_id, attempt_id),
        )


class StudioPorts:
    def __init__(self, runtime: Runtime, context):
        config = runtime.ai_config()
        problem = config.problem()
        if problem:
            raise TaskError(problem)
        self._runtime, self._config = runtime, config
        self.studio_model_id = config.studio_model_id
        self.approved_model_ids = list(config.approved_model_ids)
        # Another attempt only while a whole one (every SDK try at the full timeout) still fits.
        self.attempt_budget_ms = int(config.timeout_seconds * 1000 * config.max_attempts) + 5000
        remaining = getattr(context, "get_remaining_time_in_millis", None)
        self.time_left_ms = remaining if callable(remaining) else None

    def invoke_model(self, request: dict):
        from .vendor.ai_providers.base import ContentPart, ModelRequest

        model_request = ModelRequest(
            route=request["route"],
            system_prompt=request["system_prompt"],
            content=tuple(ContentPart(**part) for part in request["content"]),
            output_schema=request["output_schema"],
            schema_name=request["schema_name"],
            max_output_tokens=request["max_output_tokens"],
            temperature=float(request["temperature"]),
        )
        return self._runtime.bedrock_client(self._config).invoke(model_request)


class SpeechPorts:
    def __init__(self, runtime: Runtime):
        if not runtime.settings.speech_bucket:
            raise TaskError("configuration")
        self._runtime = runtime
        self._bucket = runtime.settings.speech_bucket

    def speech_object_size(self, key: str) -> int | None:
        try:
            head = self._runtime.client("s3").head_object(Bucket=self._bucket, Key=key)
        except Exception as error:  # noqa: BLE001
            if _is_absent_cache_entry(error):
                return None
            raise TaskError("storage", retryable=True) from None
        size = head.get("ContentLength")
        return size if isinstance(size, int) and size > 0 else None

    def synthesize(self, *, text, text_type, voice_id, engine, language, region=None) -> bytes:
        try:
            response = self._runtime.client("polly", region).synthesize_speech(
                Text=text,
                TextType=text_type,
                OutputFormat="mp3",
                VoiceId=voice_id,
                Engine=engine,
                LanguageCode=language,
            )
        except Exception as error:  # noqa: BLE001 - classified, never logged
            raise _polly_error(error) from None
        content_type = str(response.get("ContentType") or "audio/mpeg").split(";")[0].strip()
        stream = response.get("AudioStream")
        if content_type.lower() not in {"audio/mpeg", "audio/mp3"} or stream is None:
            raise TaskError("bad_audio")
        try:
            data = stream.read(MAX_AUDIO_BYTES + 1)
        finally:
            close = getattr(stream, "close", None)
            if callable(close):
                close()
        return data

    def put_speech(self, key: str, data: bytes) -> None:
        try:
            self._runtime.client("s3").put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType="audio/mpeg",
                ServerSideEncryption="AES256",
            )
        except Exception:  # noqa: BLE001
            raise TaskError("storage", retryable=True) from None


def _polly_error(error: BaseException) -> TaskError:
    code, name = error_code(error), type(error).__name__
    if code in _POLLY_RETRYABLE:
        return TaskError(
            "throttled" if "hrottl" in code or "Limit" in code else "service", retryable=True
        )
    if name in _TRANSPORT:
        return TaskError("timeout" if "Timeout" in name else "connection", retryable=True)
    if code in _POLLY_ACCESS or name.endswith("CredentialsError"):
        return TaskError("access_denied")
    if code in _POLLY_VOICE:
        return TaskError("invalid_voice")
    if code in _POLLY_INPUT:
        return TaskError("invalid_input")
    return TaskError("unexpected")


def _status(error: BaseException) -> int | None:
    response = getattr(error, "response", None)
    if isinstance(response, dict):
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return status if isinstance(status, int) else None
    return None


def _asset_error(error: BaseException) -> TaskError:
    """One asset-bucket S3 error as a stable, safe code (never the AWS message).

    - NoSuchKey / 404 and NoSuchVersion: `object_missing`, permanent. The media role holds
      s3:ListBucket on the asset bucket (ListAssetBucket), so S3 answers a missing key with 404.
    - AccessDenied / 403: `access_denied`, permanent. A 403 is never read as "missing": without
      ListBucket S3 also answers a missing key with 403, so the two cannot be told apart here,
      and a retry cannot cure a policy, key or bucket-setting problem (it needs a change and a
      deploy), so retrying would only spend the three receives and land in the DLQ later. The
      job fails at once with a code an operator can act on, and is resubmitted after the fix.
    - SlowDown, Throttling, 503: `throttled`, retryable (SQS redelivers).
    - Connection and timeout errors: `connection` / `timeout`, retryable.
    - 5xx (InternalError) and anything unrecognised: `storage`, retryable, bounded by the DLQ.
    """
    code, name, status = error_code(error), type(error).__name__, _status(error)
    if code in _MISSING_CODES or code in _S3_VERSION_MISSING or status == 404:
        return TaskError("object_missing")
    if code in _S3_DENIED or status == 403:
        return TaskError("access_denied")
    if code in _S3_THROTTLED or status in (429, 503):
        return TaskError("throttled", retryable=True)
    if name in _TRANSPORT or name in {"ResponseStreamingError", "IncompleteReadError"}:
        return TaskError("timeout" if "Timeout" in name else "connection", retryable=True)
    return TaskError("storage", retryable=True)


class AssetPorts:
    """Read-only asset ports. `asset_object_size` returns None for a missing object (the
    `asset.inspect` contract) and raises `TaskError` from `_asset_error` otherwise; `read_asset`
    raises `TaskError` for every failure, `object_missing` included."""

    def __init__(self, runtime: Runtime):
        if not runtime.settings.asset_bucket:
            raise TaskError("configuration")
        self._runtime = runtime
        self._bucket = runtime.settings.asset_bucket

    def asset_object_size(self, key: str) -> int | None:
        try:
            head = self._runtime.client("s3").head_object(Bucket=self._bucket, Key=key)
        except Exception as error:  # noqa: BLE001 - classified, never logged
            failure = _asset_error(error)
            if failure.code == "object_missing":
                return None
            raise failure from None
        size = head.get("ContentLength")
        return size if isinstance(size, int) else None

    def read_asset(self, key: str, start: int, length: int) -> bytes:
        if length <= 0:
            return b""
        try:
            response = self._runtime.client("s3").get_object(
                Bucket=self._bucket, Key=key, Range=f"bytes={start}-{start + length - 1}"
            )
            return response["Body"].read(length)
        except Exception as error:  # noqa: BLE001 - classified, never logged
            raise _asset_error(error) from None


def log(event: str, **fields) -> None:
    """One JSON line: an event name plus ids and codes. Never text, prompts or outputs."""
    print(json.dumps({"event": event, **fields}, sort_keys=True))  # noqa: T201
