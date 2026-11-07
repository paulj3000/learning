"""The provider-independent model client contract (LAI-0701).

Services build a `ModelRequest` and get back a `ModelResponse` or a `ProviderError`. Nothing above
this layer knows about boto3, and nothing below it knows about companions, tutors or children:
a request carries no child id, no nickname and no history, only the fixed system prompt, the
typed context, and the output schema.

`ModelResponse.output` is the parsed JSON object, still untrusted; the contract validators decide
whether it may reach a child. When the provider's Guardrail intervened, `output` is always None:
the blocked text is never handed upward, so it cannot be shown or logged by accident.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ContentPart:
    """One block of the user message. `untrusted` text came from a client and is wrapped for
    the Guardrail's input checks (Bedrock `guardContent`). `screened` text is server-authored
    data (a context JSON, validated parameters) that is also wrapped, so that every request
    carries a `guardContent` block: without one, Bedrock assesses the whole message and the
    prompt-attack filter blocks our own instructions (QA-AQS-D4). Server-authored
    instructions are neither."""

    text: str
    untrusted: bool = False
    screened: bool = False

    @property
    def guarded(self) -> bool:
        return self.untrusted or self.screened


@dataclass(frozen=True, slots=True)
class ModelRequest:
    route: str
    system_prompt: str
    content: tuple[ContentPart, ...]
    output_schema: dict
    schema_name: str
    max_output_tokens: int
    temperature: float
    # Server-side context the fake provider may use to produce a deterministic reply. Never
    # sent to a real model.
    fake_hints: dict = field(default_factory=dict, compare=False)


@dataclass(frozen=True, slots=True)
class ModelResponse:
    output: object | None
    model_id: str
    provider: str
    stop_reason: str
    guardrail_applied: bool
    guardrail_intervened: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None


class ProviderError(Exception):
    """A model call failed. `category` is a `FailureCategory` value; the message is never shown
    to a child and never logged (ADR-025 logs exception types only)."""

    category = "UNKNOWN"

    def __init__(self, category: str | None = None):
        super().__init__(category or self.category)
        if category:
            self.category = category


class ProviderTimeout(ProviderError):
    category = "TIMEOUT"


class ProviderConfigurationError(ProviderError):
    """The provider cannot run safely as configured (missing region, model or Guardrail).
    Raised instead of calling the model, so a misconfiguration fails closed."""

    category = "CONFIGURATION"


class InvalidModelResponse(ProviderError):
    category = "INVALID_RESPONSE"


class ModelClient(Protocol):
    provider: str
    model_id: str
    guardrail_id: str
    guardrail_version: str

    def invoke(self, request: ModelRequest) -> ModelResponse: ...
