"""Golden-vector parity for the Python NPC rules (LAI-0605).

Every case in `npc.json` was produced by the TypeScript NPC engine (`react/src/features/npc/`).
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.progression import npc

SUITE = "npc"
PORTS = {
    "evaluateCondition": npc.evaluate_condition,
    "selectDialogueNode": npc.select_dialogue_node,
    "availableChoices": npc.available_choices,
    "advanceDialogue": npc.advance_dialogue,
    "dialogueOutcome": npc.dialogue_outcome,
    "relationshipLevelForPoints": npc.relationship_level_for_points,
    "awardRelationshipPoints": npc.award_relationship_points,
    "setMemoryFlags": lambda flags, flags_to_set: npc.set_memory_flags(flags, flags_to_set),
    "parseMemoryFlags": npc.parse_memory_flags,
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
