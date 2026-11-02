"""Golden-vector parity for the Django AI rules (LAI-0701).

Every case in `ai-safety.json` was produced by the TypeScript validators, context builder and
fallback tables that the Amplify routes use today; the Django ports in `apps/ai` must agree on
every one, reasons included.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.ai import content_safety, contracts, fallbacks, limits, tutor_content

SUITE = "ai-safety"


def _companion(raw, context):
    return contracts.validate_companion_turn(
        raw,
        expected_intent=context["expectedIntent"],
        max_length=context["maxLength"],
        allowed_choice_ids=context.get("allowedChoiceIds"),
    ).as_dict()


def _context(input):
    built = tutor_content.build_tutor_context(
        age_band=input["ageBand"],
        skill_id=input["skillId"],
        hint_level=input["hintLevel"],
        mastery_summaries=input.get("masterySummaries"),
        quest_title=input.get("questTitle"),
        quest_stage_title=input.get("questStageTitle"),
        authored_base_text=input.get("authoredBaseText"),
    )
    return None if built is None else built.as_dict()


PORTS = {
    "containsUrl": lambda text: content_safety.contains_url(text),
    "requestsPersonalInformation": lambda text: content_safety.requests_personal_information(text),
    "claimsLearningJudgment": lambda text: content_safety.claims_learning_judgment(text),
    "normalizeEmotion": lambda value: contracts.normalize_emotion(value),
    "validateCompanionTurn": _companion,
    "validateTutorTurn": lambda raw, context: contracts.validate_tutor_turn(raw, context).as_dict(),
    "disallowedCurriculumTerms": lambda text, allowed_vocabulary: (
        tutor_content.disallowed_curriculum_terms(text, allowed_vocabulary)
    ),
    "strategyForHintLevel": lambda hint_level: tutor_content.strategy_for_hint_level(hint_level),
    "allowedVocabularyForSkill": tutor_content.allowed_vocabulary_for_skill,
    "isTutorableSkill": tutor_content.is_tutorable_skill,
    "buildTutorContext": _context,
    "maxSpokenLengthByAgeBand": lambda: limits.MAX_SPOKEN_LENGTH_BY_AGE_BAND,
    "companionFallbackTurns": lambda: fallbacks.FALLBACK_TURNS,
    "tutorFallbackTurns": lambda: {
        **fallbacks.FALLBACK_TUTOR_TURNS,
        "REDIRECT": fallbacks.TUTOR_REDIRECT_TURN,
    },
}


def test_every_function_in_the_suite_has_a_python_port():
    assert set(load_suite(SUITE)["functions"]) == set(PORTS)


@pytest.mark.parametrize(
    ("function", "case"),
    [(name, case) for name in PORTS for case in cases(SUITE, name)],
    ids=lambda value: value if isinstance(value, str) else case_id(value),
)
def test_python_matches_typescript(function, case):
    assert_case(case, lambda inputs: PORTS[function](**inputs))
