"""Skill evidence from challenge attempts (TR-4): one per attempt, only after grading."""

import pytest

from apps.education.models import SkillEvidence
from apps.education.services import NotGradedYet, record_attempt_evidence
from apps.game_sessions.models import Correctness as EvidenceResult
from apps.game_sessions.play import (
    issue_chest_challenge,
    start_or_resume_region_session,
    submit_chest_answer,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def issued(treasure, child=None):
    child = child or treasure.families.a1
    session, _ = start_or_resume_region_session(child, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest, seed=3)
    return attempt


def test_an_unanswered_attempt_is_not_evidence(treasure):
    with pytest.raises(NotGradedYet):
        record_attempt_evidence(issued(treasure))


def test_evidence_is_written_once_per_attempt(treasure):
    attempt = issued(treasure)
    submit_chest_answer(attempt.child, attempt.pk, attempt.answer, hint_level=2, duration_ms=1500)
    attempt.refresh_from_db()
    again, created = record_attempt_evidence(attempt)
    assert not created
    assert SkillEvidence.objects.filter(challenge_attempt=attempt).count() == 1
    assert again.learning_objective_code == "addition-within-ten"
    assert (again.evidence_type, again.result, again.support_level, again.duration_ms) == (
        "CHALLENGE",
        EvidenceResult.CORRECT,
        2,
        1500,
    )
    assert (
        again.challenge_attempt.session_id == attempt.session_id
        and again.observed_at == attempt.answered_at
    )


def test_evidence_carries_no_answer_or_free_text():
    fields = {field.name for field in SkillEvidence._meta.get_fields()}
    assert not fields & {"answer", "submitted_answer", "text", "nickname"}
