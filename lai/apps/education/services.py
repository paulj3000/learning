"""Skill evidence writes (TR-4)."""

from django.db import transaction

from .challenges import Correctness
from .models import EvidenceResult, LearningObjective, SkillEvidence

# The evidence type a server-generated challenge records; step-based adventures use the step
# type (`NUMBER_INPUT`, `CHOICE`, ...) as on the client.
CHALLENGE_EVIDENCE_TYPE = "CHALLENGE"

_RESULTS = {
    Correctness.CORRECT: EvidenceResult.CORRECT,
    Correctness.INCORRECT: EvidenceResult.INCORRECT,
}


class NotGradedYet(ValueError):
    pass


def record_attempt_evidence(attempt) -> tuple[SkillEvidence, bool]:
    """Evidence for one answered challenge attempt. Idempotent per attempt.

    The objective is the attempt's curriculum skill: TR-1 skill ids are learning objective
    codes (`counting-sets`, `addition-within-ten`, `subtraction-within-ten`). A missing
    objective raises `LearningObjective.DoesNotExist`: that is a content bug, not a child's.
    """
    if not attempt.correctness:
        raise NotGradedYet("Only an answered attempt is evidence.")
    objective = LearningObjective.objects.get(code=attempt.skill_id)
    with transaction.atomic():
        return SkillEvidence.objects.get_or_create(
            attempt=attempt,
            defaults={
                "child": attempt.child,
                "session": attempt.session,
                "learning_objective": objective,
                "evidence_type": CHALLENGE_EVIDENCE_TYPE,
                "result": _RESULTS[Correctness(attempt.correctness)],
                "support_level": attempt.hint_level,
                "duration_ms": attempt.duration_ms,
                "observed_at": attempt.answered_at,
            },
        )
