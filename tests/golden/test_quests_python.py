"""Golden-vector parity for the Python quest engine (TR-4, completed in LAI-0605).

Every case in `quests.json` was produced by the TypeScript Quest Engine. The vectors use the
TypeScript shapes (camelCase context, a `definition` and a `state` record); the adapters below
only translate them to the Python engine's types and back.
"""

import pytest
from golden_vectors import assert_case, case_id, cases, load_suite

from apps.quests import engine

SUITE = "quests"


def context_of(raw: dict) -> engine.QuestContext:
    return engine.QuestContext(
        world_change_keys=frozenset(raw["worldChangeKeys"]),
        owned_item_ids=frozenset(raw["ownedItemIds"]),
        completed_adventure_slugs=frozenset(raw["completedAdventureSlugs"]),
        completed_quest_ids=frozenset(raw["completedQuestIds"]),
        visited_location_slugs=frozenset(raw["visitedLocationSlugs"]),
        npc_memory_flags=raw["npcMemoryFlags"],
        relationship_levels=raw["relationshipLevels"],
        skill_statuses=raw["skillStatuses"],
        discovery_keys=frozenset(raw["discoveryKeys"]),
    )


def is_objective_complete(objective, context):
    return engine.objective_complete(objective, context_of(context))


def evaluate_quest_condition(condition, context, state=None):
    completed = (state or {}).get("completedObjectiveIds", [])
    return engine.condition_holds(condition, context_of(context), completed)


def advance_quest(definition, state, context):
    result = engine.advance_quest(
        definition["stages"],
        definition.get("completion", {}),
        engine.QuestState(
            status=state["status"],
            current_stage_id=state["currentStageId"],
            completed_stage_ids=tuple(state["completedStageIds"]),
            completed_objective_ids=tuple(state["completedObjectiveIds"]),
        ),
        context_of(context),
    )
    return {
        "state": {
            **state,
            "status": result.state.status,
            "currentStageId": result.state.current_stage_id,
            "completedStageIds": list(result.state.completed_stage_ids),
            "completedObjectiveIds": list(result.state.completed_objective_ids),
        },
        "changed": result.changed,
        "newlyCompletedStageIds": list(result.newly_completed_stage_ids),
        "newlyCompletedObjectiveIds": list(result.newly_completed_objective_ids),
        "worldChanges": list(result.world_changes),
        "justCompleted": result.just_completed,
    }


PORTS = {
    "isObjectiveComplete": is_objective_complete,
    "evaluateQuestCondition": evaluate_quest_condition,
    "advanceQuest": advance_quest,
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
