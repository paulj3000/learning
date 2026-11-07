"""Amazon Bedrock through the Converse API (LAI-0702, LAI-0704).

Design choices, each forced by how Bedrock behaves (docs/AI_SERVICE.md section 4):

* **Structured output as text, never tool use.** Bedrock Guardrails do not evaluate tool-call
  arguments on Converse (`toolUse.input` is not assessed), so a turn returned through a tool
  would skip the output Guardrail. Structured outputs (`outputConfig.textFormat` with a JSON
  schema) return a text block, which the Guardrail does evaluate. With structured output off,
  the prompt asks for JSON and the parser accepts it the same way.
* **Untrusted text in `guardContent`.** Client-supplied fields are wrapped so the Guardrail's
  input checks, prompt-attack detection included, assess exactly them. Once any `guardContent`
  block is present, other message text is not assessed by most policies; that text is
  server-authored instructions. Server-authored *data* is wrapped too (`screened`), so a request
  with no client text still carries a `guardContent` block: with none, Bedrock assesses the
  whole message and the prompt-attack filter blocks our own instructions (QA-AQS-D4, measured
  live 2026-11-07). The system prompt is not wrapped: it is ours, and the prompt-attack filter
  would flag its own instructions.
* **Trace off.** A Guardrail trace carries the matched values (PII included) and the
  pre-masking model text. Nothing here needs it: any `guardrail_intervened` stop is treated as
  a block, so the PII policy must be configured to BLOCK, not ANONYMIZE
  (infra/lib/aiGuardrailStack.ts).
* **Fail closed.** No region, model id, or Guardrail id and version: `ProviderConfigurationError`
  before any call. There is no unguarded mode.
* **Credentials** come from the default boto3 chain (the EC2 instance role in AWS). None are
  read from settings.

Error messages from AWS are never propagated, logged or shown: they are mapped to a closed
`FailureCategory` and the original exception is dropped (`from None`).
"""

import json
import time

from .base import (
    InvalidModelResponse,
    ModelRequest,
    ModelResponse,
    ProviderConfigurationError,
    ProviderError,
    ProviderTimeout,
)

_CLIENT_ERROR_CATEGORIES = {
    "ThrottlingException": "THROTTLED",
    "ServiceQuotaExceededException": "THROTTLED",
    "TooManyRequestsException": "THROTTLED",
    "AccessDeniedException": "ACCESS_DENIED",
    "UnrecognizedClientException": "ACCESS_DENIED",
    "ExpiredTokenException": "ACCESS_DENIED",
    "ResourceNotFoundException": "CONFIGURATION",
    "ValidationException": "REQUEST_REJECTED",
    "ModelErrorException": "UNAVAILABLE",
    "ModelNotReadyException": "UNAVAILABLE",
    "ServiceUnavailableException": "UNAVAILABLE",
    "InternalServerException": "UNAVAILABLE",
    "ModelTimeoutException": "TIMEOUT",
}


def parse_json_text(text: str) -> object:
    """The model's JSON object. Tolerates a Markdown code fence (prompt-instructed mode)."""
    body = text.strip()
    if body.startswith("```"):
        body = body.strip("`")
        if body[:4].lower() == "json":
            body = body[4:]
    try:
        return json.loads(body)
    except ValueError:
        raise InvalidModelResponse from None


class BedrockModelClient:
    provider = "bedrock"

    def __init__(
        self,
        *,
        region: str,
        model_id: str,
        guardrail_id: str,
        guardrail_version: str,
        timeout_seconds: float,
        structured_output: bool = True,
        max_attempts: int = 2,
        client=None,
    ):
        missing = [
            name
            for name, value in (
                ("region", region),
                ("model_id", model_id),
                ("guardrail_id", guardrail_id),
                ("guardrail_version", guardrail_version),
            )
            if not value
        ]
        if missing:
            raise ProviderConfigurationError
        self.region = region
        self.model_id = model_id
        self.guardrail_id = guardrail_id
        self.guardrail_version = guardrail_version
        self.timeout_seconds = timeout_seconds
        self.structured_output = structured_output
        self.max_attempts = max_attempts
        self._client = client

    def _runtime(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "bedrock-runtime",
                region_name=self.region,
                config=Config(
                    connect_timeout=min(self.timeout_seconds, 5),
                    read_timeout=self.timeout_seconds,
                    # Bounded retries (LAI_AI_MAX_ATTEMPTS, at most 3): a child is waiting, and
                    # a retry storm against a throttled model would only cost more.
                    retries={"max_attempts": self.max_attempts, "mode": "standard"},
                ),
            )
        return self._client

    def converse_arguments(self, request: ModelRequest) -> dict:
        """The exact Converse keyword arguments. Public so tests can inspect them offline."""
        content = []
        for part in request.content:
            if part.guarded:
                content.append({"guardContent": {"text": {"text": part.text}}})
            else:
                content.append({"text": part.text})
        arguments = {
            "modelId": self.model_id,
            "system": [{"text": request.system_prompt}],
            "messages": [{"role": "user", "content": content}],
            "inferenceConfig": {
                "maxTokens": request.max_output_tokens,
                "temperature": request.temperature,
            },
            "guardrailConfig": {
                "guardrailIdentifier": self.guardrail_id,
                "guardrailVersion": self.guardrail_version,
                "trace": "disabled",
            },
        }
        if self.structured_output:
            arguments["outputConfig"] = {
                "textFormat": {
                    "type": "json_schema",
                    "structure": {
                        "jsonSchema": {
                            "schema": json.dumps(request.output_schema, separators=(",", ":")),
                            "name": request.schema_name,
                            "description": "One structured turn for the island companion.",
                        }
                    },
                }
            }
        return arguments

    def invoke(self, request: ModelRequest) -> ModelResponse:
        from botocore.exceptions import (
            BotoCoreError,
            ClientError,
            ConnectTimeoutError,
            NoCredentialsError,
            ReadTimeoutError,
        )

        started = time.monotonic()
        try:
            response = self._runtime().converse(**self.converse_arguments(request))
        except (ReadTimeoutError, ConnectTimeoutError):
            raise ProviderTimeout from None
        except NoCredentialsError:
            raise ProviderConfigurationError from None
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code", "")
            raise ProviderError(_CLIENT_ERROR_CATEGORIES.get(code, "UNKNOWN")) from None
        except BotoCoreError:
            raise ProviderError("UNAVAILABLE") from None

        elapsed = int((time.monotonic() - started) * 1000)
        usage = response.get("usage") or {}
        stop_reason = response.get("stopReason", "")
        base = {
            "model_id": self.model_id,
            "provider": self.provider,
            "stop_reason": stop_reason,
            "guardrail_applied": True,
            "input_tokens": usage.get("inputTokens"),
            "output_tokens": usage.get("outputTokens"),
            "latency_ms": (response.get("metrics") or {}).get("latencyMs", elapsed),
        }
        if stop_reason == "guardrail_intervened":
            # The output field holds the Guardrail's configured blocked message; discard it.
            return ModelResponse(output=None, guardrail_intervened=True, **base)
        if stop_reason == "max_tokens":
            raise ProviderError("TRUNCATED")
        blocks = (((response.get("output") or {}).get("message") or {}).get("content")) or []
        text = "".join(block.get("text", "") for block in blocks if isinstance(block, dict))
        if not text.strip():
            raise InvalidModelResponse
        return ModelResponse(output=parse_json_text(text), **base)
