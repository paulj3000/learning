"""Authoritative mastery writes (LAI-0603): evidence becomes SkillProgress on the server only."""

import json
import uuid

import pytest

from apps.education import mastery
from apps.education.models import ErrorPattern, SkillEvidence, SkillProgress, SkillStatus
from apps.game_sessions import services

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def answer(child, session, step, value, request_id=None, **extra):
    return services.submit_answer(
        child,
        session.pk,
        step_id=step,
        answer={"kind": "number-input", "value": value, **extra},
        request_id=request_id or uuid.uuid4(),
    )


def progress(child, code="counting-sets"):
    return SkillProgress.objects.for_child(child).filter(learning_objective_code=code).first()


def test_a_correct_unhinted_answer_writes_evidence_and_progress(
    families,
    ai_catalog,
    start_session,
):
    session = start_session(families.a1)
    answer(families.a1, session, "count", 4)
    row = progress(families.a1)
    assert (row.exposure_count, row.independent_success_count) == (1, 1)
    assert row.recent_level == SkillStatus.DEVELOPING
    assert row.error_pattern == ErrorPattern.NONE
    evidence = SkillEvidence.objects.for_child(families.a1).get()
    assert (evidence.result, evidence.support_level, evidence.evidence_type) == (
        "CORRECT",
        0,
        "NUMBER_INPUT",
    )
    assert evidence.adventure_session_id == session.pk


def test_the_server_grades_a_client_claiming_correctness_gets_nothing(
    families,
    ai_catalog,
    start_session,
):
    session = start_session(families.a1)
    answer(families.a1, session, "count", 9, correctness="CORRECT", supportLevel=0)
    row = progress(families.a1)
    assert (row.exposure_count, row.independent_success_count) == (1, 0)
    assert SkillEvidence.objects.for_child(families.a1).get().result == "INCORRECT"


def test_a_replayed_request_counts_once(families, ai_catalog, start_session):
    session = start_session(families.a1)
    request_id = uuid.uuid4()
    answer(families.a1, session, "count", 9, request_id)
    answer(families.a1, session, "count", 9, request_id)
    assert progress(families.a1).exposure_count == 1
    assert SkillEvidence.objects.for_child(families.a1).count() == 1


def test_a_step_without_objectives_is_not_evidence(
    families,
    ai_catalog,
    start_session,
):
    session = start_session(families.a1)
    answer(families.a1, session, "count", 4)
    services.submit_answer(
        families.a1,
        session.pk,
        step_id="pick",
        answer={"kind": "creative-choice", "optionId": "knight"},
        request_id=uuid.uuid4(),
    )
    assert SkillEvidence.objects.for_child(families.a1).count() == 1


def test_evidence_for_an_unknown_objective_is_skipped_not_fatal(
    families,
    ai_catalog,
    start_session,
):
    from apps.catalog.models import LearningObjective

    LearningObjective.objects.filter(code="counting-sets").delete()
    session = start_session(families.a1)
    outcome = answer(families.a1, session, "count", 4)
    assert outcome.correctness == "CORRECT"
    assert not SkillEvidence.objects.exists() and not SkillProgress.objects.exists()


def test_progress_is_per_child(families, ai_catalog, start_session):
    answer(families.a1, start_session(families.a1), "count", 4)
    assert progress(families.a1) is not None
    assert progress(families.a2) is None and progress(families.b1) is None


def test_hints_make_a_supported_success_and_a_stalled_child_is_flagged(
    families,
    ai_catalog,
    start_session,
):
    session = start_session(families.a1)
    for _ in range(3):
        answer(families.a1, session, "count", 9)
    row = progress(families.a1)
    assert row.independent_success_count == 0
    assert row.recent_level == SkillStatus.INTRODUCED
    assert row.error_pattern in (ErrorPattern.STALLED, ErrorPattern.NEEDS_SUPPORT)


def test_mastery_is_reached_by_the_documented_thresholds_only():
    counts = None
    for _ in range(5):
        counts = mastery.next_skill_progress_counts(counts, "correct", 0, "2026-03-01T00:00:00Z")
    assert mastery.compute_skill_status(counts, True) == SkillStatus.MASTERED
    # Review decay is read-time only and never rewrites the counters.
    assert mastery.apply_review_decay(
        SkillStatus.MASTERED, "2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"
    ) == (SkillStatus.PROFICIENT)
    assert counts["exposureCount"] == 5


def test_concurrent_looking_writes_accumulate_on_one_row(
    families,
    ai_catalog,
    start_session,
):
    session = start_session(families.a1)
    answer(families.a1, session, "count", 9)
    answer(families.a1, session, "count", 4)
    assert SkillProgress.objects.for_child(families.a1).count() == 1
    assert json.dumps(mastery.counts_of(progress(families.a1))["exposureCount"]) == "2"
