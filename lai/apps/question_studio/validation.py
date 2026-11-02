"""Validation (LAI-AQS-010 to 014). Every check is deterministic; none calls a model.

`check_*` functions are pure over a `Question`-shaped object and return `Finding`s. The quality
checks are heuristics and the messages say so: a passing report means no known problem was found,
not that the question is good, so a human still approves (LAI-AQS-017). Only BLOCKING findings
stop approval and publishing; a WARNING asks the reviewer to look.
"""

import re
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Q

from apps.ai.content_safety import (
    boundary_violations,
    contains_url,
    requests_personal_information,
)

from . import taxonomy
from .models import Question, Severity, ValidationFinding, ValidationStatus
from .normalize import jaccard, normalize_text, shingles

NEAR_DUPLICATE_THRESHOLD = 0.8
NEAR_DUPLICATE_CANDIDATES = 200

B, W, INFO = Severity.BLOCKING, Severity.WARNING, Severity.INFO


@dataclass(frozen=True, slots=True)
class Finding:
    check: str
    severity: str
    message: str


def _numeric(text: str) -> int | None:
    try:
        return int(str(text).strip())
    except ValueError:
        return None


# --- Structure (LAI-AQS-010) --------------------------------------------------------------------


def check_structure(q) -> list[Finding]:
    found: list[Finding] = []
    if not q.stem.strip():
        found.append(Finding("stem_missing", B, "The question has no text."))
    elif len(q.stem.strip()) < 8:
        found.append(Finding("stem_too_short", W, "The question text is very short."))
    if not q.correct_answer.strip():
        found.append(Finding("answer_missing", B, "The question has no correct answer."))
    if q.subject not in taxonomy.Subject.values:
        found.append(Finding("unknown_subject", B, "Unknown subject."))
    elif not taxonomy.topic_is_valid(q.subject, q.topic):
        found.append(Finding("unknown_topic", B, f"Unknown topic {q.topic!r} for {q.subject}."))
    if q.grade not in taxonomy.Grade.values:
        found.append(Finding("unknown_grade", B, "Unknown grade."))
    if q.difficulty not in taxonomy.Difficulty.values:
        found.append(Finding("unknown_difficulty", B, "Difficulty must be Easy, Medium or Hard."))
    spec = taxonomy.QUESTION_TYPES.get(q.question_type)
    if spec is None:
        return [*found, Finding("unknown_question_type", B, "Unknown question type.")]

    choices = q.choices if isinstance(q.choices, list) else []
    if spec.needs_choices:
        found.extend(_check_choices(q, choices))
    elif choices:
        found.append(Finding("choices_not_allowed", B, "This question type has no choices."))
    if q.question_type == taxonomy.QuestionType.NUMERIC and _numeric(q.correct_answer) is None:
        found.append(Finding("answer_not_a_number", B, "A numeric answer must be a whole number."))
    if q.operation:
        if len(q.operands) != 2:
            found.append(Finding("operands_invalid", B, "An operation needs exactly two operands."))
        expected = taxonomy.TOPIC_OPERATION.get(q.topic)
        if expected is not None and q.operation != expected:
            found.append(
                Finding(
                    "operation_topic_mismatch", B, f"{q.operation} does not fit topic {q.topic}."
                )
            )
    elif q.operands:
        found.append(Finding("operands_without_operation", B, "Operands need an operation."))
    return found


def _check_choices(q, choices: list) -> list[Finding]:
    found: list[Finding] = []
    count = len(choices)
    if not taxonomy.MIN_CHOICES <= count <= taxonomy.MAX_CHOICES:
        return [Finding("choice_count", B, f"Multiple choice needs 2 to 5 choices, found {count}.")]
    ids = [c.get("id") if isinstance(c, dict) else None for c in choices]
    texts = [str(c.get("text", "")).strip() if isinstance(c, dict) else "" for c in choices]
    if len(set(ids)) != count or any(i not in taxonomy.CHOICE_IDS for i in ids):
        found.append(Finding("choice_ids_invalid", B, "Choice ids must be unique letters A to E."))
    if any(not t for t in texts):
        found.append(Finding("choice_text_empty", B, "A choice has no text."))
    if len({normalize_text(t) for t in texts}) != count:
        found.append(Finding("choice_text_duplicate", B, "Two choices have the same text."))
    if q.correct_answer not in ids:
        found.append(
            Finding("answer_not_a_choice", B, "The correct answer does not match any choice id.")
        )
    return found


# --- Answer verification (LAI-AQS-011) ----------------------------------------------------------

_EXPR = re.compile(r"(\d+)\s*([x×*+\-−÷/])\s*(\d+)")
_SYMBOL_OPERATION = {
    "x": "MULTIPLY",
    "×": "MULTIPLY",
    "*": "MULTIPLY",
    "+": "ADD",
    "-": "SUBTRACT",
    "−": "SUBTRACT",
    "÷": "DIVIDE",
    "/": "DIVIDE",
}


def compute(operation: str, a: int, b: int) -> int | None:
    """The exact result, or None when the operation is not exact over the integers."""
    if operation == "ADD":
        return a + b
    if operation == "SUBTRACT":
        return a - b
    if operation == "MULTIPLY":
        return a * b
    if operation == "DIVIDE":
        return a // b if b != 0 and a % b == 0 else None
    return None


def answer_value(q) -> int | None:
    """The integer the answer key stands for (a choice's text for multiple choice)."""
    if q.question_type == taxonomy.QuestionType.MULTIPLE_CHOICE:
        for choice in q.choices if isinstance(q.choices, list) else []:
            if isinstance(choice, dict) and choice.get("id") == q.correct_answer:
                return _numeric(str(choice.get("text", "")))
        return None
    return _numeric(q.correct_answer)


def check_answer(q) -> list[Finding]:
    spec = taxonomy.QUESTION_TYPES.get(q.question_type)
    if spec is None or not spec.machine_verifiable:
        return [
            Finding(
                "unverifiable", W, "This answer cannot be checked automatically; verify it by hand."
            )
        ]
    value = answer_value(q)
    operation, operands = q.operation, list(q.operands)
    expression = _EXPR.search(q.stem)
    if not operation and expression:
        operation = _SYMBOL_OPERATION[expression.group(2)]
        operands = [int(expression.group(1)), int(expression.group(3))]
    elif operation and expression and len(operands) == 2:
        stem_op = _SYMBOL_OPERATION[expression.group(2)]
        stem_numbers = [int(expression.group(1)), int(expression.group(3))]
        if stem_op != operation or stem_numbers != operands:
            return [
                Finding(
                    "stem_disagrees_with_operands",
                    B,
                    "The text and the stored operation or operands differ.",
                )
            ]
    if not operation or len(operands) != 2:
        if spec.value == taxonomy.QuestionType.MULTIPLE_CHOICE and value is None:
            return [
                Finding(
                    "unverifiable",
                    W,
                    "This answer cannot be checked automatically; verify it by hand.",
                )
            ]
        return [
            Finding(
                "unverifiable", W, "No arithmetic was found to check; verify the answer by hand."
            )
        ]
    expected = compute(operation, operands[0], operands[1])
    if expected is None:
        return [
            Finding("operation_not_exact", B, "The operands do not give a whole-number result.")
        ]
    if value is None:
        return [Finding("answer_not_a_number", B, "The answer is not a whole number.")]
    found: list[Finding] = []
    if value != expected:
        found.append(
            Finding(
                "answer_key_wrong", B, f"The key says {value} but the arithmetic gives {expected}."
            )
        )
    if q.question_type == taxonomy.QuestionType.MULTIPLE_CHOICE:
        right = [c for c in q.choices if _numeric(str(c.get("text", ""))) == expected]
        if len(right) > 1:
            found.append(
                Finding(
                    "multiple_correct_choices", B, "More than one choice equals the right result."
                )
            )
        if not right:
            found.append(Finding("no_correct_choice", B, "No choice equals the right result."))
    return found or [Finding("answer_verified", INFO, f"Checked by code: {expected}.")]


# --- Duplicates (LAI-AQS-012) -------------------------------------------------------------------


def _older_than(question: Question) -> Q:
    return Q(created_at__lt=question.created_at) | Q(
        created_at=question.created_at, id__lt=question.id
    )


def check_duplicates(q: Question) -> list[Finding]:
    """Exact and normalised duplicates by hash lookup; near duplicates by word-shingle overlap
    on a bounded set of same-topic questions. No model call is ever used. The older question is
    the original, so two copies are never both flagged."""
    found: list[Finding] = []
    others = (
        Question.objects.exclude(pk=q.pk).exclude(review_status="REJECTED").filter(_older_than(q))
    )
    if q.replaces_id:  # a correction legitimately resembles the question it replaces
        others = others.exclude(pk=q.replaces_id)
    if others.filter(content_hash=q.content_hash).exists():
        return [Finding("duplicate_exact", B, "An identical question already exists.")]
    if others.filter(normalized_hash=q.normalized_hash).exists():
        return [
            Finding(
                "duplicate_normalized", B, "The same question exists with different wording marks."
            )
        ]
    mine = shingles(q.stem)
    candidates = others.filter(subject=q.subject, grade=q.grade, topic=q.topic).order_by(
        "-created_at"
    )[:NEAR_DUPLICATE_CANDIDATES]
    for other in candidates:
        if jaccard(mine, shingles(other.stem)) >= NEAR_DUPLICATE_THRESHOLD:
            found.append(Finding("near_duplicate", W, "A very similar question already exists."))
            break
    return found


# --- Educational quality and safety (LAI-AQS-013) -----------------------------------------------


def check_quality(q) -> list[Finding]:
    """Heuristics only: metadata consistency, reading volume, answer range, hint leaks, and the
    existing AI safety policies applied to every child-facing string."""
    from apps.catalog.models import LearningObjective

    found: list[Finding] = []
    if q.grade in taxonomy.Grade.values and not taxonomy.bands_for_grade(q.grade):
        found.append(Finding("grade_has_no_age_band", W, "No age band can be served this grade."))
    if len(q.stem) > taxonomy.max_stem_chars_for(q.grade):
        found.append(
            Finding("stem_long_for_grade", W, "The text is long for this grade (heuristic).")
        )
    value = answer_value(q)
    if value is not None and (value < 0 or value > taxonomy.max_answer_for(q.grade)):
        found.append(
            Finding(
                "answer_outside_grade_range",
                W,
                "The answer is outside the usual range for this grade.",
            )
        )
    if q.skill_code and not LearningObjective.objects.filter(code=q.skill_code).exists():
        found.append(
            Finding(
                "skill_not_in_catalog",
                W,
                "This skill code is not a catalog learning objective, so Treasure Rush cannot "
                "record it as evidence.",
            )
        )
    if not q.skill_code:
        found.append(Finding("skill_missing", W, "No skill or objective is set."))
    answer_text = _answer_text(q)
    if (
        q.hint
        and answer_text
        and len(answer_text) > 1
        and normalize_text(answer_text) in normalize_text(q.hint)
    ):
        found.append(Finding("hint_reveals_answer", W, "The hint appears to contain the answer."))
    strings = [
        q.stem,
        q.hint,
        q.explanation,
        *[str(c.get("text", "")) for c in q.choices or [] if isinstance(c, dict)],
    ]
    for text in strings:
        if not text:
            continue
        if contains_url(text):
            found.append(Finding("unsafe_url", B, "A link appears in the question content."))
        if requests_personal_information(text):
            found.append(
                Finding(
                    "unsafe_personal_information", B, "The content asks for personal information."
                )
            )
        for category in boundary_violations(text):
            found.append(Finding(f"unsafe_{category}", B, f"Content policy: {category}."))
    return list({f.check + f.message: f for f in found}.values())


def _answer_text(q) -> str:
    if q.question_type == taxonomy.QuestionType.MULTIPLE_CHOICE:
        for choice in q.choices if isinstance(q.choices, list) else []:
            if isinstance(choice, dict) and choice.get("id") == q.correct_answer:
                return str(choice.get("text", ""))
        return ""
    return q.correct_answer


# --- Reports (LAI-AQS-014) ----------------------------------------------------------------------


def collect(q: Question) -> list[Finding]:
    structure = check_structure(q)
    # Later checks assume a well-formed question; running them on a broken one only adds noise.
    if any(f.severity == B for f in structure):
        return (
            [*structure, *check_duplicates(q)] if q.stem.strip() and q.correct_answer else structure
        )
    return [*structure, *check_answer(q), *check_duplicates(q), *check_quality(q)]


def status_for(findings: list[Finding]) -> str:
    if any(f.severity == B for f in findings):
        return ValidationStatus.FAIL
    if any(f.severity == W for f in findings):
        return ValidationStatus.WARNING
    return ValidationStatus.PASS


@transaction.atomic
def run_validation(question: Question) -> list[Finding]:
    """Validate, store the findings as a new run, and update the question's status. Idempotent
    in effect: a corrected question is revalidated by calling this again."""
    question = Question.objects.select_for_update().get(pk=question.pk)
    findings = collect(question)
    question.validation_run += 1
    question.validation_status = status_for(findings)
    question.save(update_fields=["validation_run", "validation_status", "updated_at"])
    ValidationFinding.objects.bulk_create(
        ValidationFinding(
            question=question,
            run=question.validation_run,
            code=f.check,
            severity=f.severity,
            message=f.message,
        )
        for f in findings
    )
    return findings


def latest_findings(question: Question):
    return question.findings.filter(run=question.validation_run)


def blocking(question: Question) -> list[ValidationFinding]:
    return list(latest_findings(question).filter(severity=Severity.BLOCKING))
