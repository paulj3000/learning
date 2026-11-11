"""The pure dialogue engine (LAI-NPC-011/012): selection, entering, choices and actions.

No database: the engine works on snapshot dicts and a `ConditionContext`.
"""

import pytest

from apps.npcs import dialogue
from apps.npcs.conditions import ConditionContext


def node(key, text="Hello!", *, next=None, choices=(), bands=(), conds=()):
    return {
        "nodeKey": key,
        "text": text,
        "emotion": "happy",
        "animationState": None,
        "audio": None,
        "ageBands": list(bands),
        "conditions": list(conds),
        "next": next,
        "allowAiHint": False,
        "allowedTopic": "",
        "choices": list(choices),
    }


def choice(key, *, next=None, action="NONE", value=None, conds=()):
    return {
        "choiceKey": key,
        "label": key.title(),
        "next": next,
        "conditions": list(conds),
        "action": action,
        "actionValue": value,
    }


def dlg(
    key, nodes, *, trigger="on_interact", start=None, priority=0, bands=(), conds=(), once=False
):
    return {
        "dialogueKey": key,
        "trigger": trigger,
        "mode": "AUTHORED",
        "ageBands": list(bands),
        "conditions": list(conds),
        "priority": priority,
        "oncePerChild": once,
        "startNode": start or nodes[0]["nodeKey"],
        "nodes": nodes,
    }


def ctx(band="PATHFINDER", **kw):
    return ConditionContext(age_band=band, **kw)


BRANCHING = dlg(
    "branch",
    [
        node(
            "ask",
            choices=[
                choice("left", next="forest"),
                choice("right", next="beach"),
                choice("secret", next="cave", conds=[{"type": "LOCAL_FLAG", "flag": "map"}]),
                choice("bye", action="END"),
            ],
        ),
        node("forest", "Trees!", next="end"),
        node("beach", "Waves!", next="end"),
        node("cave", "Shh!"),
        node("end", "Bye now."),
    ],
)


def test_selects_highest_priority_then_key():
    low = dlg("a-low", [node("n")], priority=0)
    high_b = dlg("b-high", [node("n")], priority=5)
    high_a = dlg("a-high", [node("n")], priority=5)
    other = dlg("other", [node("n")], trigger="on_spawn", priority=99)
    chosen, _ = dialogue.select([low, high_b, high_a, other], "on_interact", ctx(), set())
    assert chosen["dialogueKey"] == "a-high"


def test_selection_filters_bands_conditions_and_once_per_child():
    sprout_only = dlg("sprout", [node("n")], bands=["SPROUT"], priority=9)
    needs_flag = dlg(
        "flagged", [node("n")], conds=[{"type": "LOCAL_FLAG", "flag": "x"}], priority=8
    )
    first = dlg("first", [node("n")], once=True, priority=7)
    fallback = dlg("fallback", [node("n")])
    all_ = [sprout_only, needs_flag, first, fallback]
    assert dialogue.select(all_, "on_interact", ctx(), set())[0]["dialogueKey"] == "first"
    assert dialogue.select(all_, "on_interact", ctx(), {"first"})[0]["dialogueKey"] == "fallback"
    assert dialogue.select(all_, "on_interact", ctx("SPROUT"), set())[0]["dialogueKey"] == "sprout"
    flagged = ctx(local_flags={"x": True})
    assert dialogue.select(all_, "on_interact", flagged, set())[0]["dialogueKey"] == "flagged"
    assert dialogue.select(all_, "on_player_near", ctx(), set()) is None


def test_start_skips_hidden_nodes_and_skips_dialogues_with_nothing_to_show():
    d = dlg(
        "skip",
        [
            node("sprout-hi", bands=["SPROUT"], next="all-hi"),
            node("all-hi", "Hi all", next="end"),
            node("end"),
        ],
    )
    _, first = dialogue.select([d], "on_interact", ctx("SPROUT"), set())
    assert first["nodeKey"] == "sprout-hi"
    _, first = dialogue.select([d], "on_interact", ctx("EXPLORER"), set())
    assert first["nodeKey"] == "all-hi"
    hidden = dlg("hidden", [node("only", bands=["SPROUT"])], priority=10)
    shown = dlg("shown", [node("x")])
    chosen, _ = dialogue.select([hidden, shown], "on_interact", ctx("EXPLORER"), set())
    assert chosen["dialogueKey"] == "shown"


def test_enter_guards_against_cycles_of_hidden_nodes():
    d = dlg(
        "loop",
        [node("a", bands=["SPROUT"], next="b"), node("b", bands=["SPROUT"], next="a")],
    )
    assert dialogue.enter(d, "a", ctx("EXPLORER")) is None


def test_branching_paths_and_conditional_choices():
    start = dialogue.node_by_key(BRANCHING, "ask")
    assert [c["choiceKey"] for c in dialogue.visible_choices(start, ctx())] == [
        "left",
        "right",
        "bye",
    ]
    with_map = ctx(local_flags={"map": True})
    assert "secret" in [c["choiceKey"] for c in dialogue.visible_choices(start, with_map)]
    assert dialogue.choose(BRANCHING, start, "left", ctx()).node["nodeKey"] == "forest"
    assert dialogue.choose(BRANCHING, start, "right", ctx()).node["nodeKey"] == "beach"
    assert dialogue.choose(BRANCHING, start, "secret", with_map).node["nodeKey"] == "cave"
    assert dialogue.choose(BRANCHING, start, "bye", ctx()).ended


def test_invalid_transitions_are_refused():
    start = dialogue.node_by_key(BRANCHING, "ask")
    with pytest.raises(dialogue.InvalidChoice):
        dialogue.choose(BRANCHING, start, "secret", ctx())  # hidden for this child
    with pytest.raises(dialogue.InvalidChoice):
        dialogue.choose(BRANCHING, start, "nope", ctx())
    with pytest.raises(dialogue.InvalidChoice):
        dialogue.advance(BRANCHING, start, ctx())  # node has choices
    forest = dialogue.node_by_key(BRANCHING, "forest")
    with pytest.raises(dialogue.InvalidChoice):
        dialogue.choose(BRANCHING, forest, "left", ctx())  # not this node's choice
    assert dialogue.advance(BRANCHING, forest, ctx()).node["nodeKey"] == "end"
    assert dialogue.advance(BRANCHING, dialogue.node_by_key(BRANCHING, "end"), ctx()).ended


def test_a_node_whose_choices_are_all_hidden_advances():
    d = dlg(
        "hidden-choices",
        [
            node("q", choices=[choice("c", conds=[{"type": "FIRST_VISIT"}])], next="after"),
            node("after"),
        ],
    )
    q = dialogue.node_by_key(d, "q")
    assert dialogue.advance(d, q, ctx(prior_visits=3)).node["nodeKey"] == "after"


def test_transition_to_a_node_of_another_dialogue_ends():
    d = dlg("x", [node("a", choices=[choice("go", next="elsewhere")])])
    assert dialogue.choose(d, d["nodes"][0], "go", ctx()).ended


def test_set_local_flag_is_validated_and_capped():
    d = dlg(
        "flags",
        [
            node(
                "a",
                choices=[
                    choice("ok", action="SET_LOCAL_FLAG", value="heard-story", next="b"),
                    choice("bad", action="SET_LOCAL_FLAG", value="not a slug!"),
                ],
            ),
            node("b", conds=[{"type": "LOCAL_FLAG", "flag": "heard-story"}]),
        ],
    )
    step = dialogue.choose(d, d["nodes"][0], "ok", ctx())
    assert step.local_flags == {"heard-story": True}
    assert step.node["nodeKey"] == "b"  # the new flag is visible to the next node
    assert dialogue.choose(d, d["nodes"][0], "bad", ctx()).local_flags == {}
    full = {f"f{i}": True for i in range(dialogue.MAX_LOCAL_FLAGS)}
    capped = dialogue.choose(d, d["nodes"][0], "ok", ctx(local_flags=full))
    assert capped.local_flags == full


def test_offer_quest_and_request_hint_only_report():
    d = dlg(
        "offer",
        [
            node(
                "a",
                choices=[
                    choice("quest", action="OFFER_QUEST", value="pips-quest", next="b"),
                    choice("hint", action="REQUEST_HINT", next="b"),
                ],
            ),
            node("b"),
        ],
    )
    offered = dialogue.choose(d, d["nodes"][0], "quest", ctx())
    assert offered.quest_offer == "pips-quest" and offered.node["nodeKey"] == "b"
    hinted = dialogue.choose(d, d["nodes"][0], "hint", ctx())
    assert hinted.quest_offer is None and hinted.local_flags == {}


def test_an_unknown_action_fails_closed():
    d = dlg("weird", [node("a", choices=[choice("x", action="GIVE_GOLD")])])
    with pytest.raises(dialogue.InvalidChoice):
        dialogue.choose(d, d["nodes"][0], "x", ctx())
