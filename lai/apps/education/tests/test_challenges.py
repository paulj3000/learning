"""Treasure Rush TR-1: server-side math challenge generation and grading."""

import json
from itertools import product
from pathlib import Path

import pytest

from apps.education.challenges import (
    BAND_LIMITS,
    MAX_NUMBER_INPUT,
    SKILL_RULES,
    ChallengeParameters,
    Correctness,
    InvalidAnswer,
    InvalidChallengeParameters,
    MathChallenge,
    Operation,
    ResponseMode,
    generate_challenge,
    grade_answer,
    public_challenge,
    validate_parameters,
)
from apps.users.models import AgeBand

CURRICULUM = Path(__file__).resolve().parents[4] / "content" / "exported" / "curriculum.json"
SEEDS = range(200)


def counting(max_value=5, mode=ResponseMode.CHOICE, choice_count=3, min_value=1):
    return ChallengeParameters("counting-sets", min_value, max_value, mode, choice_count)


def addition(max_value=10, mode=ResponseMode.NUMBER_INPUT, choice_count=0, min_value=0):
    return ChallengeParameters("addition-within-ten", min_value, max_value, mode, choice_count)


def valid_parameter_grid():
    """Every valid combination of skill, band, range, and response mode, small enough to sweep."""
    for (skill_id, rule), band in product(SKILL_RULES.items(), AgeBand.values):
        if band not in rule.age_bands:
            continue
        limits = BAND_LIMITS[band]
        top = min(rule.max_value, limits.max_value)
        for low, high, mode in product(range(0, 3), range(2, top + 1), limits.response_modes):
            counts = range(2, limits.max_choices + 1) if mode == ResponseMode.CHOICE else (0,)
            for count in counts:
                params = ChallengeParameters(skill_id, low, high, mode, count)
                if not validate_parameters(params, band):
                    yield params, band


# --- Consistency with the curriculum and the age-band rules --------------------------------------


def test_skill_rules_match_the_exported_curriculum():
    curriculum = json.loads(CURRICULUM.read_text())
    skills = {skill["id"]: skill for skill in curriculum["skills"]}
    grade_of_domain = {domain["id"]: domain["gradeId"] for domain in curriculum["domains"]}
    bands_of_grade = {grade["id"]: set(grade["ageBands"]) for grade in curriculum["grades"]}

    for skill_id, rule in SKILL_RULES.items():
        assert skill_id in skills, skill_id
        grade = grade_of_domain[skills[skill_id]["domainId"]]
        assert rule.age_bands == bands_of_grade[grade], skill_id


def test_every_age_band_has_limits():
    assert set(BAND_LIMITS) == set(AgeBand.values)


def test_sprouts_never_type_an_answer():
    assert BAND_LIMITS[AgeBand.SPROUT].response_modes == {ResponseMode.CHOICE}


def test_the_grid_covers_every_band_and_skill():
    covered = {(params.skill_id, band) for params, band in valid_parameter_grid()}
    expected = {(s, b) for s, rule in SKILL_RULES.items() for b in rule.age_bands}
    assert covered == expected


# --- Parameter validation --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "band", "code"),
    [
        (counting(), "TODDLER", "unknown_age_band"),
        (
            ChallengeParameters("long-division", 0, 5, ResponseMode.CHOICE, 3),
            AgeBand.SPROUT,
            "unknown_skill",
        ),
        (
            addition(max_value=5, mode=ResponseMode.CHOICE, choice_count=3),
            AgeBand.SPROUT,
            "skill_not_for_age_band",
        ),
        (counting(max_value=6), AgeBand.SPROUT, "max_value_above_age_band_limit"),
        (counting(max_value=11), AgeBand.PATHFINDER, "max_value_above_skill_limit"),
        (
            counting(mode=ResponseMode.NUMBER_INPUT, choice_count=0),
            AgeBand.SPROUT,
            "response_mode_not_for_age_band",
        ),
        (counting(choice_count=4), AgeBand.SPROUT, "choice_count_out_of_range"),
        (counting(choice_count=1), AgeBand.SPROUT, "choice_count_out_of_range"),
        (addition(choice_count=2), AgeBand.EXPLORER, "choice_count_without_choices"),
        (addition(min_value=-1), AgeBand.EXPLORER, "min_value_negative"),
        (addition(min_value=6), AgeBand.EXPLORER, "range_too_small"),
        (counting(min_value=4, max_value=3), AgeBand.SPROUT, "range_too_small"),
        (counting(max_value=2, choice_count=3), AgeBand.SPROUT, "range_too_small_for_choices"),
    ],
)
def test_invalid_parameters_are_named(params, band, code):
    assert code in validate_parameters(params, band)


def test_generation_refuses_invalid_parameters_with_their_codes():
    with pytest.raises(InvalidChallengeParameters) as raised:
        generate_challenge(counting(max_value=6), AgeBand.SPROUT, seed=1)
    assert raised.value.codes == ("max_value_above_age_band_limit",)


# --- Generation ------------------------------------------------------------------------------


def test_generation_is_deterministic_for_a_seed():
    params = addition(mode=ResponseMode.CHOICE, choice_count=4)
    first = [generate_challenge(params, AgeBand.PATHFINDER, seed) for seed in SEEDS]
    again = [generate_challenge(params, AgeBand.PATHFINDER, seed) for seed in SEEDS]
    assert first == again
    assert len({challenge.operands for challenge in first}) > 10


def test_every_generated_challenge_is_well_formed():
    checked = 0
    for params, band in valid_parameter_grid():
        rule = SKILL_RULES[params.skill_id]
        for seed in range(0, 200, 7):
            challenge = generate_challenge(params, band, seed)
            assert challenge.operation == rule.operation
            assert all(params.min_value <= operand for operand in challenge.operands)
            if rule.operation == Operation.COUNT:
                assert challenge.operands == (challenge.answer,)
                assert 1 <= challenge.answer <= params.max_value
            elif rule.operation == Operation.ADD:
                assert sum(challenge.operands) == challenge.answer <= params.max_value
            else:
                first, second = challenge.operands
                assert first <= params.max_value
                assert first - second == challenge.answer >= 0
            if params.response_mode == ResponseMode.CHOICE:
                choices = challenge.choices
                assert len(choices) == len(set(choices)) == params.choice_count
                assert list(choices) == sorted(choices)
                assert challenge.answer in choices
                floor = 1 if rule.operation == Operation.COUNT else 0
                assert all(floor <= choice <= params.max_value for choice in choices)
            else:
                assert challenge.choices == ()
            checked += 1
    assert checked > 1000


def test_the_answer_is_not_always_in_the_same_choice_position():
    params = counting(choice_count=3)
    positions = {
        generate_challenge(params, AgeBand.SPROUT, seed).choices.index(
            generate_challenge(params, AgeBand.SPROUT, seed).answer
        )
        for seed in SEEDS
    }
    assert positions == {0, 1, 2}


def test_the_public_shape_never_contains_the_answer():
    challenge = generate_challenge(counting(), AgeBand.SPROUT, seed=3)
    shown = public_challenge(challenge)
    assert set(shown) == {"skillId", "operation", "operands", "responseMode", "choices"}
    assert json.dumps(shown)  # plain JSON, ready for a serializer


# --- Grading ---------------------------------------------------------------------------------


TYPED = MathChallenge("addition-within-ten", Operation.ADD, (3, 4), 7, ResponseMode.NUMBER_INPUT)
PICKED = MathChallenge("counting-sets", Operation.COUNT, (3,), 3, ResponseMode.CHOICE, (2, 3, 4))


def test_grading_a_typed_answer():
    assert grade_answer(TYPED, 7) == Correctness.CORRECT
    assert grade_answer(TYPED, 6) == Correctness.INCORRECT
    assert grade_answer(TYPED, 0) == Correctness.INCORRECT


def test_grading_a_chosen_answer():
    assert grade_answer(PICKED, 3) == Correctness.CORRECT
    assert grade_answer(PICKED, 4) == Correctness.INCORRECT


def test_correctness_uses_the_typescript_engine_vocabulary():
    assert {c.value for c in Correctness} == {"correct", "incorrect"}


@pytest.mark.parametrize("raw", [True, False, 7.0, "7", None, [7], {"value": 7}])
def test_non_integer_answers_are_malformed(raw):
    with pytest.raises(InvalidAnswer):
        grade_answer(TYPED, raw)


@pytest.mark.parametrize("raw", [-1, MAX_NUMBER_INPUT + 1])
def test_out_of_range_typed_answers_are_malformed(raw):
    with pytest.raises(InvalidAnswer):
        grade_answer(TYPED, raw)


def test_a_choice_that_was_not_offered_is_malformed():
    with pytest.raises(InvalidAnswer):
        grade_answer(PICKED, 5)
