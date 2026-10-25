"""Server-side quest advancement matches the client's rules (TR-4). No database."""

from apps.quests.engine import QuestContext, QuestState, advance_quest, start_state

CHEST = {"id": "open", "kind": "BUILD", "changeKey": "CHEST_OPENED"}
COIN = {"id": "coin", "kind": "FIND", "itemId": "golden-doubloon"}
SHELL = {"id": "shell", "kind": "FIND", "itemId": "spiral-shell", "optional": True}
TALK = {"id": "talk", "kind": "TALK_TO", "npcId": "pirate-pip", "memoryFlag": "met"}

STAGES = [
    {"id": "one", "objectives": [CHEST, SHELL], "nextStageId": "two",
     "worldChanges": [{"locationSlug": "bay", "changeType": "CREATE", "changeKey": "FLAG_UP"}]},
    {"id": "two", "objectives": [COIN]},
]
COMPLETION = {
    "journalNote": "done",
    "worldChanges": [{"locationSlug": "bay", "changeType": "CREATE", "changeKey": "PARTY"}],
}


def ctx(changes=(), items=(), adventures=(), quests=()):
    return QuestContext(frozenset(changes), frozenset(items), frozenset(adventures), frozenset(quests))


def test_nothing_done_changes_nothing():
    result = advance_quest(STAGES, COMPLETION, start_state("one"), ctx())
    assert not result.changed
    assert result.state == start_state("one")


def test_one_stage_completes_and_owes_its_world_changes():
    result = advance_quest(STAGES, COMPLETION, start_state("one"), ctx(changes={"CHEST_OPENED"}))
    assert result.state.current_stage_id == "two"
    assert result.newly_completed_stage_ids == ("one",)
    assert [c["changeKey"] for c in result.world_changes] == ["FLAG_UP"]
    assert not result.just_completed


def test_optional_objectives_are_credited_but_never_gate():
    with_shell = ctx(changes={"CHEST_OPENED"}, items={"spiral-shell"})
    assert "shell" in advance_quest(STAGES, COMPLETION, start_state("one"), with_shell).state.completed_objective_ids
    without = advance_quest(STAGES, COMPLETION, start_state("one"), ctx(changes={"CHEST_OPENED"}))
    assert without.state.current_stage_id == "two"


def test_it_walks_every_satisfied_stage_and_completes():
    done = ctx(changes={"CHEST_OPENED"}, items={"golden-doubloon"})
    result = advance_quest(STAGES, COMPLETION, start_state("one"), done)
    assert result.state.status == "COMPLETED"
    assert result.just_completed
    assert result.newly_completed_stage_ids == ("one", "two")
    assert [c["changeKey"] for c in result.world_changes] == ["FLAG_UP", "PARTY"]


def test_a_completed_quest_never_moves():
    finished = QuestState("COMPLETED", "two", ("one", "two"), ("open", "coin"))
    result = advance_quest(STAGES, COMPLETION, finished, ctx())
    assert not result.changed and result.state is finished


def test_the_first_matching_branch_wins():
    stages = [
        {"id": "a", "objectives": [CHEST], "nextStageId": "plain",
         "branches": [{"conditions": [{"type": "ITEM_OWNED", "itemId": "spiral-shell"}],
                       "nextStageId": "special"}]},
        {"id": "plain", "objectives": [TALK]},
        {"id": "special", "objectives": [TALK]},
    ]
    chosen = advance_quest(stages, {}, start_state("a"), ctx({"CHEST_OPENED"}, {"spiral-shell"}))
    assert chosen.state.current_stage_id == "special"
    plain = advance_quest(stages, {}, start_state("a"), ctx({"CHEST_OPENED"}))
    assert plain.state.current_stage_id == "plain"


def test_objectives_the_server_cannot_prove_are_never_credited():
    stages = [{"id": "a", "objectives": [TALK]}]
    result = advance_quest(stages, {}, start_state("a"), ctx())
    assert result.state.status == "ACTIVE"
    assert result.state.completed_objective_ids == ()


def test_an_authored_cycle_does_not_hang():
    stages = [
        {"id": "a", "objectives": [CHEST], "nextStageId": "b"},
        {"id": "b", "objectives": [CHEST], "nextStageId": "a"},
    ]
    result = advance_quest(stages, {}, start_state("a"), ctx({"CHEST_OPENED"}))
    assert result.state.status == "ACTIVE"
    assert set(result.state.completed_stage_ids) == {"a", "b"}


def test_collect_counts_distinct_owned_items():
    collect = {"id": "c", "kind": "COLLECT", "itemIds": ["x", "y", "z"], "requiredCount": 2}
    stages = [{"id": "a", "objectives": [collect]}]
    assert advance_quest(stages, {}, start_state("a"), ctx(items={"x"})).state.status == "ACTIVE"
    assert advance_quest(stages, {}, start_state("a"), ctx(items={"x", "z"})).state.status == "COMPLETED"
