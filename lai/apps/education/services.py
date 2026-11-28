"""Skill evidence writes: challenge attempts (TR-4, POST-MERGE-03), adventure steps and Area
puzzle attempts (FPV-D10).

Each newly created evidence row is folded into the child's `SkillProgress` in the same
transaction (`mastery.apply_evidence`, LAI-0603); a replayed attempt finds its row and counts
nothing twice.
"""

import logging
from enum import StrEnum

from django.db import transaction

from apps.catalog.models import LearningObjective
from apps.game_sessions.models import Correctness as EvidenceResult

from .challenges import Correctness
from .mastery import apply_evidence
from .models import SkillEvidence

logger = logging.getLogger(__name__)

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


# --- Area puzzles (FPV-D10) ----------------------------------------------------------------------

PUZZLE_EVIDENCE_TYPE = "PUZZLE"


class PuzzleEvidence(StrEnum):
    """What `record_puzzle_evidence` did with one graded puzzle attempt."""

    RECORDED = "recorded"
    ALREADY_RECORDED = "already_recorded"
    NO_SKILL = "no_skill"  # a kind that teaches no curriculum skill (a valve, a collect)
    UNKNOWN_OBJECTIVE = "unknown_objective"  # content names a code the catalog does not hold


def record_puzzle_evidence(
    attempt, objective_code: str | None, *, failed_before: int
) -> PuzzleEvidence:
    """Evidence for one server-graded Area puzzle attempt, right or wrong. Idempotent per attempt.

    Called by `game_sessions.play.solve_puzzle` inside its transaction, after grading. The
    objective is `regions.puzzles.skill_for` (the answered variant's `skill`, else the band's).

    Expected gaps never fail the child's answer: a kind with no skill records nothing, and an
    objective the catalog does not hold is skipped with a content-only warning (puzzle and code,
    never a child) for staff to map; `puzzle_skill_report` lists them. Any other failure is a
    real error and propagates, so the attempt, world change and reward roll back together.

    Support level: the hints the child opened before this attempt (issue #102, capped at the
    band's hint count by `solve_puzzle`; unknown counts as none, as before #102), and at least 1
    when an earlier answer in this visit was wrong. Only a first, unhinted correct answer is
    independent (0), which is what mastery counts; a supported success still counts as practice
    and as supported success.
    """
    if not objective_code:
        return PuzzleEvidence.NO_SKILL
    if not LearningObjective.objects.filter(code=objective_code).exists():
        logger.warning(
            "puzzle evidence skipped: objective %r is not in the catalog (puzzle %s)",
            objective_code,
            attempt.puzzle_key,
        )
        return PuzzleEvidence.UNKNOWN_OBJECTIVE
    with transaction.atomic():
        evidence, created = SkillEvidence.objects.get_or_create(
            puzzle_attempt=attempt,
            defaults={
                "child": attempt.child,
                "learning_objective_code": objective_code,
                "evidence_type": PUZZLE_EVIDENCE_TYPE,
                "result": EvidenceResult.CORRECT if attempt.correct else EvidenceResult.INCORRECT,
                "support_level": max(attempt.hints_used or 0, 1 if failed_before else 0),
                "observed_at": attempt.submitted_at,
            },
        )
        if not created:
            return PuzzleEvidence.ALREADY_RECORDED
        apply_evidence(evidence)
        return PuzzleEvidence.RECORDED


def puzzle_skill_report() -> list[dict]:
    """Every skill a published Area puzzle names that is not a catalog objective (FPV-D10).

    One row per (3D Area, puzzle, band, variant or None for the band default, code). Content only:
    no child data. Puzzles practising such a skill record no evidence until staff map or add it.
    """
    from apps.catalog import authoring
    from apps.core.content_status import ContentStatus
    from apps.regions.models import AreaPuzzle
    from apps.regions.puzzles import EVIDENCE_KINDS

    known = set(LearningObjective.objects.values_list("code", flat=True))
    rows = []
    published = (
        AreaPuzzle.objects.filter(status=ContentStatus.PUBLISHED, kind__in=EVIDENCE_KINDS)
        .select_related("region")
        .order_by("region__region_id", "sort_order", "puzzle_id")
    )
    for puzzle in published:
        bands = authoring.current_body(puzzle).get("ageBands") or {}
        for band, params in sorted(bands.items()):
            named = [(None, params.get("skill"))]
            named += [
                (v.get("id"), v["skill"]) for v in params.get("variants") or [] if v.get("skill")
            ]
            for variant, code in named:
                # A movement kind that names no skill is an accomplishment, not a gap.
                if code and code not in known:
                    rows.append(
                        {
                            "region": puzzle.region.region_id,
                            "puzzle": puzzle.puzzle_id,
                            "band": band,
                            "variant": variant,
                            "code": code,
                        }
                    )
    return rows
