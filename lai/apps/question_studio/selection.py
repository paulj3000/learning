"""Serving published questions to Treasure Rush (LAI-AQS-020 to 022).

Only an ACTIVE `QuestionRevision` can be served, so a draft, a rejected or an unapproved question
is unreachable by construction. The revision is turned into the same `MathChallenge` the TR-1
generator makes, so `ChallengeAttempt`, `grade_answer` and mastery evidence are unchanged: Django
grades by comparing the child's integer with the stored one, and Bedrock is not involved at
runtime. Anything that cannot be served exactly (text answers, division, an answer the attempt
model cannot hold) is skipped, and when a chest has no usable pool it keeps its authored
`ChallengeSpec` generator.
"""

import secrets
from dataclasses import dataclass

from apps.catalog.models import LearningObjective
from apps.education.challenges import (
    BAND_LIMITS,
    MAX_NUMBER_INPUT,
    MathChallenge,
    Operation,
    ResponseMode,
)

from . import taxonomy
from .models import QuestionPool, QuestionRevision, RevisionStatus
from .validation import answer_value, compute

SERVED_OPERATIONS = (Operation.ADD, Operation.SUBTRACT, Operation.MULTIPLY)
SMALL_INT = 32767  # the attempt's SmallIntegerField columns
CANDIDATE_LIMIT = 500


@dataclass(frozen=True, slots=True)
class BankChallenge:
    revision: QuestionRevision
    challenge: MathChallenge


class _Content:
    """A revision's content with the attribute names `validation.answer_value` expects."""

    def __init__(self, content: dict):
        self.question_type = content.get("questionType", "")
        self.choices = content.get("choices") or []
        self.correct_answer = str(content.get("correctAnswer", ""))


def to_challenge(revision: QuestionRevision, age_band: str) -> MathChallenge | None:
    """The challenge a child of `age_band` would see, or None when this revision cannot be
    served exactly. The arithmetic is re-checked here, so a bad answer key can never be graded."""
    content = revision.content
    band = BAND_LIMITS.get(age_band)
    if band is None or content.get("subject") != taxonomy.Subject.MATH:
        return None
    try:
        operation = Operation(content.get("operation"))
    except ValueError:
        return None
    operands = content.get("operands") or []
    if operation not in SERVED_OPERATIONS or len(operands) != 2:
        return None
    if not all(isinstance(o, int) and 0 <= o <= SMALL_INT for o in operands):
        return None
    answer = answer_value(_Content(content))
    if answer is None or not 0 <= answer <= SMALL_INT or compute(operation, *operands) != answer:
        return None
    # The grade's number range is only a validation warning, so a reviewer can approve past it;
    # at serve time it is a hard limit, or a Grade K "30 + 20" reaches a Sprout (QA-AQS-D2).
    limit = taxonomy.max_answer_for(str(content.get("grade", "")))
    if max(answer, *operands) > limit:
        return None
    kind = content.get("questionType")
    if kind == taxonomy.QuestionType.NUMERIC:
        if ResponseMode.NUMBER_INPUT not in band.response_modes or answer > MAX_NUMBER_INPUT:
            return None
        mode, choices = ResponseMode.NUMBER_INPUT, ()
    elif kind == taxonomy.QuestionType.MULTIPLE_CHOICE:
        values = []
        for choice in content.get("choices") or []:
            try:
                values.append(int(str(choice.get("text", "")).strip()))
            except ValueError:
                return None
        distinct = sorted(set(values))
        in_range = all(0 <= v <= SMALL_INT for v in distinct)
        in_range = in_range and all(v <= limit for v in distinct)
        if len(distinct) != len(values) or answer not in distinct or not in_range:
            return None
        if (
            not 2 <= len(distinct) <= band.max_choices
            or ResponseMode.CHOICE not in band.response_modes
        ):
            return None
        mode, choices = ResponseMode.CHOICE, tuple(distinct)
    else:
        return None
    return MathChallenge(
        skill_id=content.get("skillCode", ""),
        operation=operation,
        operands=tuple(operands),
        answer=answer,
        response_mode=mode,
        choices=choices,
    )


def pool_for(region_id: str, entity_id: str) -> QuestionPool | None:
    """The enabled pool for a chest: an exact entity beats the whole-region pool."""
    pools = QuestionPool.objects.filter(enabled=True, region_id=region_id)
    return pools.filter(entity_id=entity_id).first() or pools.filter(entity_id="").first()


def eligible_revisions(
    pool: QuestionPool, age_band: str
) -> list[tuple[QuestionRevision, MathChallenge]]:
    grades = [g for g in taxonomy.Grade.values if age_band in taxonomy.bands_for_grade(g)]
    revisions = QuestionRevision.objects.filter(
        status=RevisionStatus.ACTIVE,
        subject=pool.subject,
        grade__in=grades,
        skill_code__in=LearningObjective.objects.values("code"),
    )
    if pool.adventure_id:
        revisions = revisions.filter(adventure_id=pool.adventure_id)
    for field in ("grade", "topic", "skill_code", "difficulty"):
        if value := getattr(pool, field):
            revisions = revisions.filter(**{field: value})
    found = []
    for revision in revisions.order_by("published_at", "id")[:CANDIDATE_LIMIT]:
        challenge = to_challenge(revision, age_band)
        if challenge is not None:
            found.append((revision, challenge))
    return found


def pick_bank_challenge(
    age_band: str, session, region_id: str, entity_id: str
) -> BankChallenge | None:
    """A published question for this chest that the session has not used yet, or None to fall
    back to the chest's authored challenge (no pool, too few questions, or all already used)."""
    pool = pool_for(region_id, entity_id)
    if pool is None:
        return None
    eligible = eligible_revisions(pool, age_band)
    if len(eligible) < max(1, pool.min_pool_size):
        return None
    from apps.game_sessions.models import ChallengeAttempt

    used = set(
        ChallengeAttempt.objects.filter(
            session=session, bank_revision_id__isnull=False
        ).values_list("bank_revision_id", flat=True)
    )
    fresh = [pair for pair in eligible if pair[0].pk not in used]
    if not fresh:
        return None
    revision, challenge = secrets.choice(fresh)
    return BankChallenge(revision, challenge)
