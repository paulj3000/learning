import pytest

from apps.question_studio import validation
from apps.question_studio.models import Severity, ValidationStatus

from .conftest import make_question

pytestmark = pytest.mark.django_db


def codes(question, severity=None):
    found = validation.collect(question)
    return {f.check for f in found if severity is None or f.severity == severity}


def test_a_correct_multiplication_passes_with_a_verified_note_and_catalog_warning():
    q = make_question()
    found = validation.collect(q)
    assert validation.status_for(found) == ValidationStatus.WARNING  # skill not in catalog
    assert "answer_verified" in {f.check for f in found}
    assert not [f for f in found if f.severity == Severity.BLOCKING]


def test_wrong_answer_key_is_blocking():
    q = make_question(
        choices=[{"id": "A", "text": "43"}, {"id": "B", "text": "42"}], correct_answer="A"
    )
    assert "answer_key_wrong" in codes(q, Severity.BLOCKING)


def test_two_choices_equal_to_the_result_are_contradictory():
    q = make_question(choices=[{"id": "A", "text": "42"}, {"id": "B", "text": "042"}])
    assert "multiple_correct_choices" in codes(q, Severity.BLOCKING)


def test_no_correct_choice_when_key_points_at_a_wrong_choice():
    q = make_question(
        choices=[{"id": "A", "text": "41"}, {"id": "B", "text": "40"}], correct_answer="A"
    )
    blocking = codes(q, Severity.BLOCKING)
    assert {"answer_key_wrong", "no_correct_choice"} <= blocking


@pytest.mark.parametrize(
    "overrides, expected",
    [
        ({"stem": ""}, "stem_missing"),
        ({"correct_answer": "Z"}, "answer_not_a_choice"),
        ({"choices": [{"id": "A", "text": "42"}]}, "choice_count"),
        ({"choices": [{"id": "A", "text": "42"}, {"id": "A", "text": "36"}]}, "choice_ids_invalid"),
        (
            {"choices": [{"id": "A", "text": "42"}, {"id": "B", "text": " 42 "}]},
            "choice_text_duplicate",
        ),
        ({"topic": "astrology"}, "unknown_topic"),
        ({"difficulty": "NOPE"}, "unknown_difficulty"),
        ({"operands": [6]}, "operands_invalid"),
        ({"operation": "ADD"}, "operation_topic_mismatch"),
        ({"operation": "", "operands": [6, 7]}, "operands_without_operation"),
    ],
)
def test_structural_failures_are_blocking(overrides, expected):
    assert expected in codes(make_question(**overrides), Severity.BLOCKING)


def test_numeric_answer_must_be_a_number_and_have_no_choices():
    q = make_question(question_type="NUMERIC", choices=[], correct_answer="forty two")
    assert "answer_not_a_number" in codes(q, Severity.BLOCKING)
    q2 = make_question(
        question_type="NUMERIC",
        choices=[],
        stem="What is 6 x 8?",
        operands=[6, 8],
        correct_answer="48",
    )
    assert not codes(q2, Severity.BLOCKING) and "answer_verified" in codes(q2)
    q3 = make_question(
        question_type="NUMERIC",
        stem="What is 6 x 9?",
        operands=[6, 9],
        correct_answer="54",
        choices=[{"id": "A", "text": "x"}],
    )
    assert "choices_not_allowed" in codes(q3, Severity.BLOCKING)


def test_stem_and_operands_must_agree():
    q = make_question(stem="What is 6 x 8?", operands=[6, 7])
    assert "stem_disagrees_with_operands" in codes(q, Severity.BLOCKING)


def test_arithmetic_is_found_in_the_stem_when_operands_are_missing():
    q = make_question(operation="", operands=[], stem="What is 6 x 7?")
    assert "answer_verified" in codes(q)
    wrong = make_question(operation="", operands=[], stem="What is 6 x 7?", correct_answer="B")
    assert "answer_key_wrong" in codes(wrong, Severity.BLOCKING)


def test_inexact_division_is_blocking_and_exact_division_verifies():
    bad = make_question(
        topic="division", operation="DIVIDE", operands=[7, 2], stem="What is 7 / 2?"
    )
    assert "operation_not_exact" in codes(bad, Severity.BLOCKING)
    good = make_question(
        topic="division",
        operation="DIVIDE",
        operands=[42, 6],
        stem="What is 42 / 6?",
        choices=[{"id": "A", "text": "7"}, {"id": "B", "text": "8"}],
    )
    assert not codes(good, Severity.BLOCKING)


def test_short_answer_and_prose_cannot_be_verified_automatically():
    q = make_question(
        subject="SCIENCE",
        topic="animals",
        question_type="SHORT_ANSWER",
        stem="Which animal makes honey?",
        choices=[],
        correct_answer="bee",
        operation="",
        operands=[],
    )
    found = {f.check: f.severity for f in validation.collect(q)}
    assert found["unverifiable"] == Severity.WARNING


def test_exact_normalized_and_near_duplicates():
    original = make_question()
    exact = make_question()
    assert "duplicate_exact" in codes(exact, Severity.BLOCKING)
    assert "duplicate_exact" not in codes(original)  # the older question is the original
    typeset = make_question(stem="what is 6 X 7")
    assert "duplicate_normalized" in codes(typeset, Severity.BLOCKING)
    near = make_question(
        stem="What is 6 x 7? Count carefully please friend",
        operands=[6, 7],
        choices=[{"id": "A", "text": "42"}, {"id": "B", "text": "40"}],
    )
    assert "duplicate_normalized" not in codes(near)


def test_near_duplicate_is_a_warning():
    make_question(
        stem="A pirate has 6 boxes with 7 gold coins in every single box. How many coins?"
    )
    near = make_question(
        stem="A pirate has 6 boxes with 7 gold coins in every single box. How many coins now?",
        choices=[{"id": "A", "text": "42"}, {"id": "B", "text": "13"}],
    )
    found = {f.check: f.severity for f in validation.collect(near)}
    assert found.get("near_duplicate") == Severity.WARNING


def test_rejected_questions_do_not_count_as_originals():
    make_question(review_status="REJECTED")
    assert "duplicate_exact" not in codes(make_question())


def test_safety_findings_block():
    q = make_question(stem="What is 6 x 7? Look at www.example.com for help")
    assert "unsafe_url" in codes(q, Severity.BLOCKING)
    p = make_question(stem="Tell me your home address, then say what is 6 x 7?")
    assert "unsafe_personal_information" in codes(p, Severity.BLOCKING)


def test_quality_warnings():
    leak = make_question(hint="The answer is 42.")
    assert "hint_reveals_answer" in codes(leak, Severity.WARNING)
    long_stem = make_question(grade="K", stem="What is 6 x 7? " + "word " * 30)
    assert "stem_long_for_grade" in codes(long_stem, Severity.WARNING)
    big = make_question(grade="2", choices=[{"id": "A", "text": "42"}, {"id": "B", "text": "40"}])
    assert "answer_outside_grade_range" not in codes(big)  # 42 <= 100


def test_run_validation_stores_a_report_and_revalidation_replaces_it():
    q = make_question(correct_answer="B")
    validation.run_validation(q)
    q.refresh_from_db()
    assert q.validation_status == ValidationStatus.FAIL and q.validation_run == 1
    assert validation.blocking(q)
    q.correct_answer = "A"
    q.save()
    validation.run_validation(q)
    q.refresh_from_db()
    assert q.validation_run == 2 and q.validation_status == ValidationStatus.WARNING
    assert not validation.blocking(q)
    assert q.findings.filter(run=1).exists()  # history kept


def test_skill_in_catalog_clears_the_warning(release):
    from apps.catalog.models import LearningObjective

    LearningObjective.objects.create(
        code="multiplication-facts", domain="math", title="x", source={}, last_seen_release=release
    )
    assert "skill_not_in_catalog" not in codes(make_question())
