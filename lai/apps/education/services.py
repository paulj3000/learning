"""Skill evidence writes for Treasure Rush challenge attempts (TR-4, adapted in POST-MERGE-03).

Each newly created evidence row is folded into the child's `SkillProgress` in the same
transaction (`mastery.apply_evidence`, LAI-0603); a replayed attempt finds its row and counts
nothing twice.
"""

from django.db import transaction

from apps.catalog.models import LearningObjective
from apps.game_sessions.models import Correctness as EvidenceResult

from .challenges import Correctness
from .mastery import apply_evidence
from .models import SkillEvidence

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
    codes (`counting-sets`, `addition-within-ten`, `subtraction-within-ten`). An objective the
    catalog does not hold raises `LearningObjective.DoesNotExist`: a content bug, not a child's.
    """
    if not attempt.correctness:
        raise NotGradedYet("Only an answered attempt is evidence.")
    LearningObjective.objects.get(code=attempt.skill_id)
    with transaction.atomic():
        evidence, created = SkillEvidence.objects.get_or_create(
            challenge_attempt=attempt,
            defaults={
                "child": attempt.child,
                "learning_objective_code": attempt.skill_id,
                "evidence_type": CHALLENGE_EVIDENCE_TYPE,
                "result": _RESULTS[Correctness(attempt.correctness)],
                "support_level": attempt.hint_level,
                "duration_ms": attempt.duration_ms,
                "observed_at": attempt.answered_at,
            },
        )
        if created:
            apply_evidence(evidence)
        return evidence, created


def record_step_evidence(session, step: dict, *, correctness: str, support_level: int, at) -> int:
    """Evidence for one server-graded adventure step answer, one row per step objective.

    `step` is the authored step body the session is graded on (its pinned revision, ADR-047
    LAI-0813, or the catalog source for a session started before pinning). Called by
    `game_sessions.services.submit_answer` inside its transaction, after the engine has decided
    `correctness` (the client never supplies it). A step with no objectives, or a
    `NOT_APPLICABLE` result (a narrative step), is not evidence. An objective code the catalog
    does not hold is skipped rather than failing the child's answer: that is a content gap for
    staff, and the answer itself is already recorded. Replays never reach this function
    (`submit_answer` returns the stored outcome first). Returns the number of rows written.
    """
    objective_ids = [code for code in step.get("objectiveIds") or [] if isinstance(code, str)]
    if correctness == EvidenceResult.NOT_APPLICABLE or not objective_ids:
        return 0
    known = set(
        LearningObjective.objects.filter(code__in=objective_ids).values_list("code", flat=True)
    )
    written = 0
    for code in dict.fromkeys(objective_ids):
        if code not in known:
            continue
        evidence = SkillEvidence.objects.create(
            child=session.child,
            adventure_session=session,
            learning_objective_code=code,
            evidence_type=str(step.get("type") or "STEP")[:32],
            difficulty=session.adventure.skill_level,
            result=correctness,
            support_level=min(max(int(support_level), 0), 32767),
            observed_at=at,
        )
        apply_evidence(evidence)
        written += 1
    return written
