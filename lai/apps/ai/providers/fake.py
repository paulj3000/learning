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


_STUDIO_OPERATIONS = {
    "addition": ("ADD", "+", lambda a, b: a + b),
    "subtraction": ("SUBTRACT", "-", lambda a, b: a - b),
    "multiplication": ("MULTIPLY", "x", lambda a, b: a * b),
}
_STUDIO_DIFFICULTY = ("EASY", "MEDIUM", "HARD")


def studio_output(hints: dict) -> dict:
    """Valid, checkable practice questions for AI Question Studio, distinct per position."""
    params = hints["params"]
    start = hints.get("offset", 0)
    questions = []
    for index in range(hints["count"]):
        n = start + index
        a, b = 2 + n % 9, 3 + n // 9
        operation, symbol, fn = _STUDIO_OPERATIONS.get(params.topic, ("", "", None))
        difficulty = _STUDIO_DIFFICULTY[n % 3]
        if fn is None:
            questions.append(
                {
                    "stem": f"Name something you can find in a garden, number {n + 1}.",
                    "difficulty": difficulty,
                    "choices": [],
                    "correctAnswer": "flower",
                    "acceptedAnswers": ["flowers"],
                    "operation": "",
                    "operands": [],
                    "hint": "Think of something that grows.",
                    "explanation": "A garden grows flowers.",
                }
            )
            continue
        answer = fn(a, b)
        choices = [
            {"id": letter, "text": str(answer + delta)}
            for letter, delta in zip("ABCD", (0, 1, -1, 2), strict=True)
        ]
        multiple = params.question_type == "MULTIPLE_CHOICE"
        questions.append(
            {
                "stem": f"What is {a} {symbol} {b}?",
                "difficulty": difficulty,
                "choices": choices if multiple else [],
                "correctAnswer": "A" if multiple else str(answer),
                "acceptedAnswers": [],
                "operation": operation,
                "operands": [a, b],
                "hint": "Count it out in groups.",
                "explanation": f"{a} {symbol} {b} makes {answer}.",
            }
        )
    return {"questions": questions}


def default_output(request: ModelRequest) -> dict:
    hints = request.fake_hints
    if hints.get("studio"):
        return studio_output(hints)
    if request.route == "npc":
        return {
            "spokenText": "Look closely and count them one by one.",
            "safetyDisposition": "ALLOW",
        }
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
