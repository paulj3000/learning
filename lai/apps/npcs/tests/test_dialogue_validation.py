"""Dialogue release validation (LAI-NPC-011/012): problems block publishing."""

import pytest

from apps.catalog.models import Quest
from apps.npcs.models import NpcDialogue, NpcDialogueChoice, NpcDialogueNode, NpcRelease
from apps.npcs.publishing import PublishError, publish
from apps.npcs.validation import dialogue as dialogue_validation

from .helpers import content_release, make_character, make_dialogue, make_placement, make_staff
from .test_dialogue_engine import choice, dlg, node

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def snap(*dialogues, bands=()):
    return {
        "characters": {
            "pip": {"npcId": "pip", "ageBands": list(bands), "dialogues": list(dialogues)}
        }
    }


def problems_for(*dialogues, bands=()):
    return dialogue_validation.problems(snap(*dialogues, bands=bands))


def make_quest(slug="pips-quest", *, active=True, memory_flag=None):
    objective = {"id": "o1", "label": "Talk", "kind": "TALK_TO", "npcId": "pip"}
    if memory_flag:
        objective["memoryFlag"] = memory_flag
    return Quest.objects.create(
        slug=slug,
        title=slug,
        age_bands=["PATHFINDER"],
        active=active,
        source={"stages": [{"id": "s1", "objectives": [objective]}]},
        last_seen_release=content_release(),
    )


def test_a_valid_branching_dialogue_has_no_problems():
    good = dlg(
        "good",
        [node("a", choices=[choice("x", next="b"), choice("y", action="END")]), node("b")],
    )
    assert problems_for(good) == []


def test_graph_problems_are_reported():
    assert any("has no nodes" in p for p in problems_for(dlg("empty", [node("x")]) | {"nodes": []}))
    no_start = dlg("ns", [node("a")]) | {"startNode": None}
    assert any("has no start node" in p for p in problems_for(no_start))
    bad_start = dlg("bs", [node("a")], start="zzz")
    assert any("start node zzz is not in this dialogue" in p for p in problems_for(bad_start))
    dangling = dlg("dg", [node("a", next="ghost", choices=[choice("c", next="nowhere")])])
    found = problems_for(dangling)
    assert any("leads to ghost" in p for p in found)
    assert any("choice c leads to nowhere" in p for p in found)
    orphan = dlg("orph", [node("a"), node("lonely")])
    assert any("node lonely cannot be reached" in p for p in problems_for(orphan))


def test_auto_advance_cycles_are_reported_but_choice_loops_are_fine():
    loop = dlg("loop", [node("a", next="b"), node("b", next="a")])
    assert any("loops forever through a -> b -> a" in p for p in problems_for(loop))
    menu = dlg("menu", [node("a", choices=[choice("again", next="b")]), node("b", next="a")])
    assert not any("loops forever" in p for p in problems_for(menu))


def test_copy_rules():
    found = problems_for(
        dlg(
            "copy",
            [
                node("a", "Visit www.example.com now", next="b"),
                node("b", "Wait — what?", next="c"),
                node("c", "x" * 401, next="d"),
                node("d", "   ", choices=[choice("c" * 81)]),
            ],
        )
    )
    assert any("node a text contains a web address" in p for p in found)
    assert any("node b text contains an em dash" in p for p in found)
    assert any("node c text is longer than 400" in p for p in found)
    assert any("node d text is empty" in p for p in found)
    assert any("label is longer than 80" in p for p in found)


def test_actions_need_valid_values():
    make_quest("live-quest")
    make_quest("old-quest", active=False)
    make_quest("talk-quest", memory_flag="talked-to-pip")
    d = dlg(
        "acts",
        [
            node(
                "a",
                choices=[
                    choice("ok-offer", action="OFFER_QUEST", value="live-quest"),
                    choice("old-offer", action="OFFER_QUEST", value="old-quest"),
                    choice("no-offer", action="OFFER_QUEST", value="missing"),
                    choice("bad-flag", action="SET_LOCAL_FLAG", value="bad flag"),
                    choice("memory", action="SET_LOCAL_FLAG", value="talked-to-pip"),
                    choice("ok-flag", action="SET_LOCAL_FLAG", value="heard-story"),
                    choice("extra", action="END", value="oops"),
                    choice("empty", action="SET_LOCAL_FLAG"),
                    choice("weird", action="GIVE_GOLD"),
                ],
            )
        ],
    )
    found = problems_for(d)
    text = "\n".join(found)
    assert "ok-offer" not in text and "ok-flag" not in text
    assert "old-offer offers quest old-quest, which is not an active quest" in text
    assert "no-offer offers quest missing" in text
    assert "bad-flag sets flag 'bad flag'" in text
    assert "memory sets flag talked-to-pip, which is a quest memory flag" in text
    assert "extra: END takes no value" in text
    assert "empty: SET_LOCAL_FLAG needs a value" in text
    assert "unknown action 'GIVE_GOLD'" in text


def test_conditions_are_checked():
    d = dlg("c", [node("a", conds=[{"type": "NOPE"}])], conds=[{"type": "AGE_BAND", "in": []}])
    found = problems_for(d)
    assert any("dialogue c conditions" in p for p in found)
    assert any("node a conditions" in p for p in found)


def test_age_band_coverage():
    d = dlg(
        "bands",
        [node("a", bands=["SPROUT"], next="b"), node("b", bands=["PATHFINDER"])],
    )
    found = problems_for(d)
    assert found == ["pip dialogue bands has no start line for age band EXPLORER"]
    # A character that serves only Sprouts and Pathfinders is covered.
    assert problems_for(d, bands=["SPROUT", "PATHFINDER"]) == []
    # So is a dialogue limited to those bands.
    assert problems_for(dlg("b2", d["nodes"], bands=["SPROUT"])) == []


def test_ambiguous_dialogues_are_reported():
    a = dlg("alpha", [node("n")])
    b = dlg("beta", [node("n")])
    assert any("alpha and beta answer on_interact" in p for p in problems_for(a, b))
    assert not problems_for(a, dlg("beta", [node("n")], priority=1))
    assert not problems_for(a, dlg("beta", [node("n")], conds=[{"type": "FIRST_VISIT"}]))
    assert not problems_for(a, dlg("beta", [node("n")], trigger="on_spawn"))
    split_a = dlg("alpha", [node("n")], bands=["SPROUT"])
    split_b = dlg("beta", [node("n")], bands=["EXPLORER"])
    assert not problems_for(split_a, split_b)


def test_dialogue_problems_block_publish():
    staff = make_staff()
    character = make_character("pip-test")
    make_placement(character)
    dialogue = make_dialogue(character)
    lonely = NpcDialogueNode.objects.create(dialogue=dialogue, node_key="lonely", text="Hm.")
    bye = dialogue.nodes.get(node_key="bye")
    NpcDialogueChoice.objects.create(
        node=bye, choice_key="url", label="Go to www.example.com", next_node=lonely
    )
    NpcDialogue.objects.filter(pk=dialogue.pk).update(start_node=None)
    with pytest.raises(PublishError) as error:
        publish(staff)
    assert error.value.code == "invalid"
    assert "pip-test dialogue hello has no start node" in error.value.problems
    assert any("choice url label contains a web address" in p for p in error.value.problems)
    assert not NpcRelease.objects.exists()


def test_a_clean_dialogue_publishes():
    character = make_character("pip-test")
    make_placement(character)
    make_dialogue(character)
    assert publish(make_staff()).number == 1
