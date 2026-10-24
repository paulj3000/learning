"""Parameterised math challenges, generated and graded on the server (Treasure Rush TR-1).

A challenge is built from administrator-configured parameters (skill, value range, response
mode) and a server-chosen seed, so the same inputs always produce the same challenge. The
expected answer stays on the server: `public_challenge` is the only shape a client may see, and
`grade_answer` is the only place correctness is decided (CLAUDE.md section 7; ADR-020 keeps the
engine out of grading).

Pure functions, no ORM and no copy. The client renders the prompt from `operation` and
`operands` through its own localizable strings, so nothing here is child-facing text.

Skill and age-band rules mirror the exported curriculum (`content/exported/curriculum.json`);
`tests/test_challenges.py` fails if they drift apart.
"""

import random
from dataclasses import dataclass
from enum import StrEnum

from apps.users.models import AgeBand


class Operation(StrEnum):
    COUNT = "COUNT"
    ADD = "ADD"
    SUBTRACT = "SUBTRACT"


class ResponseMode(StrEnum):
    CHOICE = "CHOICE"
    NUMBER_INPUT = "NUMBER_INPUT"


class Correctness(StrEnum):
    """Same values as the TypeScript `Correctness` the adventure engine returns."""

    CORRECT = "correct"
    INCORRECT = "incorrect"


@dataclass(frozen=True, slots=True)
class SkillRule:
    operation: Operation
    max_value: int
    age_bands: frozenset[str]


@dataclass(frozen=True, slots=True)
class BandLimits:
    max_value: int
    response_modes: frozenset[ResponseMode]
    max_choices: int


# Curriculum skill id -> what a challenge for it may contain. Age bands come from the skill's
# grade in the curriculum export: math-early-years is SPROUT/PATHFINDER, grade-1-2 is
# PATHFINDER/EXPLORER.
SKILL_RULES: dict[str, SkillRule] = {
    "counting-sets": SkillRule(
        Operation.COUNT, 10, frozenset({AgeBand.SPROUT, AgeBand.PATHFINDER})
    ),
    "addition-within-ten": SkillRule(
        Operation.ADD, 10, frozenset({AgeBand.PATHFINDER, AgeBand.EXPLORER})
    ),
    "subtraction-within-ten": SkillRule(
        Operation.SUBTRACT, 10, frozenset({AgeBand.PATHFINDER, AgeBand.EXPLORER})
    ),
}

# CLAUDE.md section 3: Sprouts are picture-first with one-step decisions, so they get a small
# set of choices and no free number entry.
BAND_LIMITS: dict[str, BandLimits] = {
    AgeBand.SPROUT: BandLimits(5, frozenset({ResponseMode.CHOICE}), 3),
    AgeBand.PATHFINDER: BandLimits(10, frozenset(ResponseMode), 4),
    AgeBand.EXPLORER: BandLimits(20, frozenset(ResponseMode), 4),
}

MIN_CHOICES = 2
# Upper bound on a typed answer; anything larger is malformed input, not a wrong answer.
MAX_NUMBER_INPUT = 100


@dataclass(frozen=True, slots=True)
class ChallengeParameters:
    """What an administrator configures for one challenge slot (TR-2 stores these as rows)."""

    skill_id: str
    min_value: int
    max_value: int
    response_mode: ResponseMode
    choice_count: int = 0


@dataclass(frozen=True, slots=True)
class MathChallenge:
    skill_id: str
    operation: Operation
    operands: tuple[int, ...]
    answer: int
    response_mode: ResponseMode
    choices: tuple[int, ...] = ()


class InvalidChallengeParameters(ValueError):
    """Parameters that `validate_parameters` rejects. `codes` are stable machine codes."""

    def __init__(self, codes: tuple[str, ...]):
        super().__init__(", ".join(codes))
        self.codes = codes


class InvalidAnswer(ValueError):
    """Malformed input (wrong type, out of range, not an offered choice): not a wrong answer."""


def validate_parameters(params: ChallengeParameters, age_band: str) -> tuple[str, ...]:
    """Return every rule the parameters break, as machine codes; empty means valid."""
    band = BAND_LIMITS.get(age_band)
    if band is None:
        return ("unknown_age_band",)
    rule = SKILL_RULES.get(params.skill_id)
    if rule is None:
        return ("unknown_skill",)

    errors: list[str] = []
    if age_band not in rule.age_bands:
        errors.append("skill_not_for_age_band")
    if params.min_value < 0:
        errors.append("min_value_negative")
    if params.max_value > rule.max_value:
        errors.append("max_value_above_skill_limit")
    if params.max_value > band.max_value:
        errors.append("max_value_above_age_band_limit")
    if params.response_mode not in band.response_modes:
        errors.append("response_mode_not_for_age_band")

    lowest_answer = _lowest_answer(rule.operation, params.min_value)
    if _highest_answer(rule.operation, params) < lowest_answer:
        errors.append("range_too_small")

    if params.response_mode == ResponseMode.CHOICE:
        if not MIN_CHOICES <= params.choice_count <= band.max_choices:
            errors.append("choice_count_out_of_range")
        elif len(_answer_pool(rule.operation, params.max_value)) < params.choice_count:
            errors.append("range_too_small_for_choices")
    elif params.choice_count != 0:
        errors.append("choice_count_without_choices")
    return tuple(dict.fromkeys(errors))


def generate_challenge(params: ChallengeParameters, age_band: str, seed: int) -> MathChallenge:
    """Build one challenge. Deterministic: the same parameters, band, and seed give the same
    challenge, so a stored seed is enough to reproduce what a child was shown."""
    errors = validate_parameters(params, age_band)
    if errors:
        raise InvalidChallengeParameters(errors)

    operation = SKILL_RULES[params.skill_id].operation
    # Reproducibility, not secrecy, is the requirement: the answer never leaves the server.
    rng = random.Random(seed)  # noqa: S311
    low, high = params.min_value, params.max_value
    if operation == Operation.COUNT:
        answer = rng.randint(max(low, 1), high)
        operands: tuple[int, ...] = (answer,)
    elif operation == Operation.ADD:
        first = rng.randint(low, high - low)
        second = rng.randint(low, high - first)
        operands, answer = (first, second), first + second
    else:
        first = rng.randint(low, high)
        second = rng.randint(low, first)
        operands, answer = (first, second), first - second

    choices: tuple[int, ...] = ()
    if params.response_mode == ResponseMode.CHOICE:
        choices = _choices(rng, operation, answer, params)
    return MathChallenge(
        params.skill_id, operation, operands, answer, params.response_mode, choices
    )


def public_challenge(challenge: MathChallenge) -> dict:
    """The only representation a client receives. It never contains the answer."""
    return {
        "skillId": challenge.skill_id,
        "operation": str(challenge.operation),
        "operands": list(challenge.operands),
        "responseMode": str(challenge.response_mode),
        "choices": list(challenge.choices),
    }


def grade_answer(challenge: MathChallenge, raw_answer: object) -> Correctness:
    """Decide correctness. Raises `InvalidAnswer` for input that is not a possible answer."""
    # bool is an int subclass; True must not be read as 1.
    if not isinstance(raw_answer, int) or isinstance(raw_answer, bool):
        raise InvalidAnswer("answer must be an integer")
    if challenge.response_mode == ResponseMode.CHOICE:
        if raw_answer not in challenge.choices:
            raise InvalidAnswer("answer is not one of the offered choices")
    elif not 0 <= raw_answer <= MAX_NUMBER_INPUT:
        raise InvalidAnswer("answer is out of range")
    return Correctness.CORRECT if raw_answer == challenge.answer else Correctness.INCORRECT


def _lowest_answer(operation: Operation, min_value: int) -> int:
    if operation == Operation.COUNT:
        return max(min_value, 1)
    if operation == Operation.ADD:
        return 2 * min_value
    return 0


def _highest_answer(operation: Operation, params: ChallengeParameters) -> int:
    if operation == Operation.SUBTRACT:
        # The minuend must be at least the smallest subtrahend.
        return params.max_value - params.min_value if params.max_value >= params.min_value else -1
    return params.max_value


def _answer_pool(operation: Operation, max_value: int) -> range:
    """Values a choice may show: answers are never negative, and a count is never zero."""
    return range(1 if operation == Operation.COUNT else 0, max_value + 1)


def _choices(
    rng: random.Random, operation: Operation, answer: int, params: ChallengeParameters
) -> tuple[int, ...]:
    """The answer plus nearby distractors, shown in ascending order so position gives no clue."""
    others = sorted(
        (value for value in _answer_pool(operation, params.max_value) if value != answer),
        key=lambda value: (abs(value - answer), value),
    )
    wanted = params.choice_count - 1
    near = others[: wanted * 2]
    return tuple(sorted([answer, *rng.sample(near, wanted)]))
