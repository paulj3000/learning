"""A deterministic model client for tests and local development (LAI-0701).

No AWS credentials, no network. By default it answers every request with a short, valid,
in-character turn built from the request's `fake_hints`, so local development shows the AI path
working end to end. Tests script it instead:

    fake = FakeModelClient(responses=[{"spokenText": ...}, ProviderTimeout(), GUARDRAIL_BLOCK])

Each scripted item is used once, in order: a dict (or any JSON value) is returned as the model
output, an exception instance is raised, and `GUARDRAIL_BLOCK` simulates a Guardrail
intervention. `requests` records every `ModelRequest`, so tests can assert exactly what would
have been sent to a real model.
"""

from collections.abc import Callable, Iterable

from .base import ModelRequest, ModelResponse

GUARDRAIL_BLOCK = object()

FAKE_MODEL_ID = "fake-model"


def default_output(request: ModelRequest) -> dict:
    hints = request.fake_hints
    if request.route == "tutor":
        return {
            "spokenText": "Let's try it together, one step at a time.",
            "strategy": hints.get("strategy", "ENCOURAGE"),
            "representation": None,
            "emotion": "ENCOURAGING",
            "safetyDisposition": "ALLOW",
        }
    return {
        "spokenText": "Squawk! Let's keep exploring together.",
        "emotion": "CHEERFUL",
        "intent": hints.get("intent", "NARRATE"),
        "choices": None,
        "safetyDisposition": "ALLOW",
    }


class FakeModelClient:
    provider = "fake"
    model_id = FAKE_MODEL_ID

    def __init__(
        self,
        responses: Iterable[object] | None = None,
        *,
        respond: Callable[[ModelRequest], object] | None = None,
        guardrail_id: str = "",
        guardrail_version: str = "",
    ):
        self._scripted = list(responses or [])
        self._respond = respond
        self.guardrail_id = guardrail_id
        self.guardrail_version = guardrail_version
        self.requests: list[ModelRequest] = []

    def invoke(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        if self._scripted:
            item = self._scripted.pop(0)
        elif self._respond is not None:
            item = self._respond(request)
        else:
            item = default_output(request)
        if isinstance(item, BaseException):
            raise item
        applied = bool(self.guardrail_id)
        if item is GUARDRAIL_BLOCK:
            return ModelResponse(
                output=None,
                model_id=self.model_id,
                provider=self.provider,
                stop_reason="guardrail_intervened",
                guardrail_applied=True,
                guardrail_intervened=True,
                input_tokens=0,
                output_tokens=0,
                latency_ms=1,
            )
        return ModelResponse(
            output=item,
            model_id=self.model_id,
            provider=self.provider,
            stop_reason="end_turn",
            guardrail_applied=applied,
            input_tokens=10,
            output_tokens=20,
            latency_ms=1,
        )
