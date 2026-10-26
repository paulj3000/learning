"""Skill evidence and mastery progression (TR-4, LAI-0603).

Two writers:

- `record_step_evidence` (LAI-0603): the evidence a resolved step-adventure answer produces, and
  the `SkillProgress` counters it moves. Called by `game_sessions.services.submit_answer` inside
  the answer's own transaction, never by a view, and never with a client value.
- `record_attempt_evidence` (TR-4): a Treasure Rush challenge attempt's evidence row only. Its
  attempts are evidence per try, retries included, which is not the step rule (one piece of
  evidence when the step resolves), so they do not move `SkillProgress` yet (follow-up LAI-0610).

The arithmetic is `apps.education.mastery`, the golden-vector port of the TypeScript Mastery
Engine. Nothing here grades an answer: `correctness` and `support_level` are the engine's.
"""

from datetime import datetime

from django.db import IntegrityError, transaction

from apps.catalog.models import LearningObjective
from apps.game_sessions.models import Correctness as EvidenceResult

from . import mastery
from .challenges import Correctness
from .models import SkillEvidence, SkillProgress

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
        return SkillEvidence.objects.get_or_create(
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


# --- Step-adventure evidence and mastery (LAI-0603) -------------------------------------------

_STEP_RESULTS = {
    "correct": EvidenceResult.CORRECT,
    "incorrect": EvidenceResult.INCORRECT,
    "partial": EvidenceResult.PARTIAL,
}


def known_objective_codes(codes) -> list[str]:
    """The step's objective codes the catalog holds, de-duplicated, in authored order.

    A code the catalog does not hold is skipped rather than guessed or created: a content bug
    must not invent a skill row for a child, and must not fail the child's answer either.
    """
    wanted = list(dict.fromkeys(code for code in codes if isinstance(code, str) and code))
    known = set(LearningObjective.objects.filter(code__in=wanted).values_list("code", flat=True))
    return [code for code in wanted if code in known]


def counts_of(progress: SkillProgress | None) -> mastery.Counts | None:
    if progress is None:
        return None
    return {
        "exposureCount": progress.exposure_count,
        "independentSuccessCount": progress.independent_success_count,
        "supportedSuccessCount": progress.supported_success_count,
        "consecutiveIndependentCorrect": progress.consecutive_independent_correct,
        "lastPracticedAt": progress.last_practiced_at.isoformat()
        if progress.last_practiced_at
        else None,
    }


def _locked_progress(child, code: str) -> SkillProgress | None:
    rows = SkillProgress.objects.select_for_update().filter(child=child)
    return rows.filter(learning_objective_code=code).first()


def _apply(child, code: str, correctness: str, support_level: int, at: datetime) -> SkillProgress:
    """`upsertSkillProgress`, server-side: one more exposure on the child's row for `code`."""
    progress = _locked_progress(child, code)
    counts = mastery.next_skill_progress_counts(
        counts_of(progress), correctness, support_level, at.isoformat()
    )
    fields = {
        "exposure_count": counts["exposureCount"],
        "independent_success_count": counts["independentSuccessCount"],
        "supported_success_count": counts["supportedSuccessCount"],
        "consecutive_independent_correct": counts["consecutiveIndependentCorrect"],
        # A row being written means an exposure, so LOCKED cannot apply: the writer passes
        # `prerequisitesSatisfied=true`, exactly as `upsertSkillProgress` does.
        "recent_level": mastery.compute_skill_status(counts, True),
        "error_pattern": mastery.compute_error_pattern(counts),
        "last_practiced_at": at,
    }
    if progress is None:
        try:
            with transaction.atomic():
                return SkillProgress.objects.create(
                    child=child, learning_objective_code=code, **fields
                )
        except IntegrityError:
            # Another transaction created the row first (`skill_progress_once`): apply on top.
            return _apply(child, code, correctness, support_level, at)
    for name, value in fields.items():
        setattr(progress, name, value)
    progress.save(update_fields=list(fields))
    return progress


@transaction.atomic
def record_step_evidence(
    session,
    action,
    *,
    step_type: str,
    objective_ids,
    correctness: str,
    support_level: int,
    at: datetime,
) -> list[SkillProgress]:
    """Evidence and mastery for one resolved step: one row per known objective, then counters.

    The caller (`submit_answer`) has already graded the answer with the engine, recorded the
    `AdventureAction` that advanced the session, and holds the session's row lock. The rule is
    the client's former `recordEvidenceForStep` + `upsertSkillProgress`: evidence only when the
    step resolves (never on a RETRY), never for an ungraded (`not_applicable`) step, once per
    objective. `evidence_once_per_action_objective` makes a second write for the same answer
    fail instead of counting twice.
    """
    result = _STEP_RESULTS.get(correctness)
    if result is None or support_level < 0:
        return []  # ungraded, or not an engine outcome: no evidence
    updated = []
    for code in known_objective_codes(objective_ids):
        SkillEvidence.objects.create(
            child=session.child,
            adventure_session=session,
            adventure_action=action,
            learning_objective_code=code,
            evidence_type=step_type,
            result=result,
            support_level=support_level,
            observed_at=at,
        )
        updated.append(_apply(session.child, code, correctness, support_level, at))
    return updated
