"""Generation and publishing contracts (LAI-AQS-004).

`GenerationParams` is the only way staff input reaches a prompt. `QUESTION_OUTPUT_SCHEMA` is
what Bedrock structured output is asked for; it constrains shape only. `parse_item` turns one
untrusted model item into the fields of a `Question`, and never raises on a malformed item: a
malformed item becomes a draft that validation fails (LAI-AQS-010), so staff can see it.

Publishing contract: only an APPROVED question with a PASS or WARNING validation and no blocking
finding becomes a `QuestionRevision`; a revision's content is immutable (models.py).
"""

from dataclasses import dataclass

from . import taxonomy

OUTPUT_SCHEMA_VERSION = 1
MAX_NOTES_CHARS = 200

QUESTION_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "stem": {"type": "string"},
        "difficulty": {"type": "string", "enum": list(taxonomy.Difficulty.values)},
        "choices": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "text": {"type": "string"}},
                "required": ["id", "text"],
                "additionalProperties": False,
            },
        },
        "correctAnswer": {"type": "string"},
        "acceptedAnswers": {"type": "array", "items": {"type": "string"}},
        "operation": {"type": "string", "enum": ["", *taxonomy.Operation.values]},
        "operands": {"type": "array", "items": {"type": "integer"}},
        "hint": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": [
        "stem",
        "difficulty",
        "choices",
        "correctAnswer",
        "acceptedAnswers",
        "operation",
        "operands",
        "hint",
        "explanation",
    ],
    "additionalProperties": False,
}

QUESTION_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": QUESTION_ITEM_SCHEMA}},
    "required": ["questions"],
    "additionalProperties": False,
}


class InvalidGenerationRequest(ValueError):
    """Staff input the Studio refuses before any model call. `codes` are stable."""

    def __init__(self, codes: list[str]):
        super().__init__(", ".join(codes))
        self.codes = codes


@dataclass(frozen=True, slots=True)
class GenerationParams:
    subject: str
    grade: str
    topic: str
    difficulty: str
    question_type: str
    count: int
    skill_code: str = ""
    include_hints: bool = True
    include_explanations: bool = True
    world_id: int | None = None
    location_id: int | None = None
    adventure_id: int | None = None
    notes: str = ""

    def problems(self) -> list[str]:
        found: list[str] = []
        if self.subject not in taxonomy.Subject.values:
            found.append("unknown_subject")
        elif not taxonomy.topic_is_valid(self.subject, self.topic):
            found.append("unknown_topic")
        if self.grade not in taxonomy.Grade.values:
            found.append("unknown_grade")
        if self.difficulty not in taxonomy.REQUEST_DIFFICULTIES:
            found.append("unknown_difficulty")
        if self.question_type not in taxonomy.QuestionType.values:
            found.append("unknown_question_type")
        if self.count < 1:
            found.append("count_below_one")
        if len(self.notes) > MAX_NOTES_CHARS:
            found.append("notes_too_long")
        return found


def _text(value: object, limit: int = 600) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def parse_item(item: object, params: GenerationParams) -> dict:
    """Question field values from one untrusted item. Unknown or mistyped fields become empty
    values (which structural validation then reports) rather than exceptions."""
    data = item if isinstance(item, dict) else {}
    raw_choices = data.get("choices")
    choices = []
    if isinstance(raw_choices, list):
        for entry in raw_choices[: taxonomy.MAX_CHOICES + 3]:
            if isinstance(entry, dict):
                choices.append(
                    {"id": _text(entry.get("id"), 8), "text": _text(entry.get("text"), 200)}
                )
    operands = data.get("operands")
    accepted = data.get("acceptedAnswers")
    operation = data.get("operation")
    difficulty = data.get("difficulty")
    return {
        "stem": _text(data.get("stem"), 1000),
        "choices": choices if params.question_type == taxonomy.QuestionType.MULTIPLE_CHOICE else [],
        "correct_answer": _text(data.get("correctAnswer"), 200),
        "accepted_answers": [_text(a, 200) for a in accepted[:10]]
        if isinstance(accepted, list)
        else [],
        "operation": operation if operation in taxonomy.Operation.values else "",
        "operands": [o for o in operands[:4] if isinstance(o, int) and not isinstance(o, bool)]
        if isinstance(operands, list)
        else [],
        "hint": _text(data.get("hint")) if params.include_hints else "",
        "explanation": _text(data.get("explanation")) if params.include_explanations else "",
        "difficulty": difficulty
        if difficulty in taxonomy.Difficulty.values
        else (params.difficulty if params.difficulty in taxonomy.Difficulty.values else ""),
    }
