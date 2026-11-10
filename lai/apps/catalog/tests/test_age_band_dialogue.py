"""LAI-0817: age-band NPC dialogue. Publishing rules and what each band is served."""

import copy
import uuid

import pytest
from django.contrib.auth.models import Permission

from apps.catalog import authoring, records
from apps.catalog.importer import import_content
from apps.catalog.models import NpcDefinition
from apps.catalog.tests.helpers import write_export
from apps.catalog.tests.test_authoring import collections_with_npc
from apps.game_sessions.play_state import npc_dialogue
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")


def line(node_id, text, *, bands=None, follow_up=False, choices=(), conditions=()):
    node = {"id": node_id, "text": text, "choices": list(choices), "conditions": list(conditions)}
    if bands is not None:
        node["ageBands"] = list(bands)
    if follow_up:
        node["followUpOnly"] = True
    return node


@pytest.fixture
def pip(tmp_path):
    collections = collections_with_npc()
    collections["islands.json"]["islands"][0]["supportedAgeBands"] = list(BANDS)
    import_content(write_export(tmp_path / "v1", collections))
    return NpcDefinition.objects.get(npc_id="pip")


@pytest.fixture
def staff():
    account = ParentAccount.objects.create(
        cognito_sub=f"django-admin-only:dialogue-{uuid.uuid4()}",
        admin_username=f"dialogue-{uuid.uuid4().hex[:8]}",
        is_staff=True,
    )
    for codename in ("edit_content_draft", "publish_content"):
        account.user_permissions.add(Permission.objects.get(codename=codename))
    return account


def with_dialogue(npc, nodes):
    body = copy.deepcopy(authoring.current_body(npc))
    body["dialogue"] = nodes
    return body


def served_ids(child, band, npc):
    child.age_band = band
    return [n["nodeId"] for n in npc_dialogue(child, None, npc)]


GOOD = [
    line("hello-sprout", "Hi! Let us count.", bands=["SPROUT"]),
    line("hello-big", "Welcome back, builder.", bands=["PATHFINDER", "EXPLORER"]),
    line("fallback", "Ahoy!", follow_up=False, bands=None),
]


class TestPublishingRules:
    def test_a_banded_conversation_with_a_line_for_every_band_publishes(self, pip, staff):
        body = with_dialogue(pip, GOOD)
        assert authoring.validate(pip, body) == []
        draft = authoring.create_draft(pip, body, user=staff)
        assert authoring.publish(draft, user=staff).status == "PUBLISHED"

    def test_a_band_with_no_unconditioned_opener_is_refused(self, pip):
        body = with_dialogue(pip, [line("only-sprout", "Hi!", bands=["SPROUT"])])
        problems = authoring.validate(pip, body)
        assert any("age band PATHFINDER has no conversation opener" in p for p in problems)
        assert any("age band EXPLORER" in p for p in problems)
        assert not any("age band SPROUT has no" in p for p in problems)

    def test_conditioned_or_follow_up_lines_do_not_count_as_openers(self, pip):
        nodes = [
            line("a", "Hi", bands=["SPROUT"]),
            line("b", "Later", bands=["PATHFINDER", "EXPLORER"], follow_up=True),
            line(
                "c",
                "Quest done",
                bands=["PATHFINDER", "EXPLORER"],
                conditions=[{"type": "QUEST_COMPLETED", "questId": "repair"}],
            ),
        ]
        problems = authoring.validate(pip, with_dialogue(pip, nodes))
        assert any("PATHFINDER has no conversation opener" in p for p in problems)

    def test_an_npc_with_no_banded_lines_is_unchanged(self, pip):
        body = with_dialogue(pip, [line("a", "Hi"), line("b", "Bye", follow_up=True)])
        assert authoring.validate(pip, body) == []

    def test_a_choice_that_leaves_a_band_without_a_next_line_is_refused(self, pip):
        nodes = [
            line(
                "ask",
                "Want to play?",
                choices=[{"id": "yes", "label": "Yes", "nextNodeId": "big-only"}],
            ),
            line("big-only", "Hard puzzle", bands=["EXPLORER"], follow_up=True),
            line("easy", "Easy hello", bands=["SPROUT", "PATHFINDER"]),
        ]
        problems = authoring.validate(pip, with_dialogue(pip, nodes))
        assert any(
            "every choice in node 'ask' leads to lines that age band SPROUT" in p for p in problems
        )

    def test_duplicate_ids_and_unknown_choice_targets_are_refused(self, pip):
        nodes = [
            line("a", "One"),
            line("a", "Two", choices=[{"id": "x", "label": "Go", "nextNodeId": "missing"}]),
        ]
        problems = authoring.validate(pip, with_dialogue(pip, nodes))
        assert any("used more than once" in p for p in problems)
        assert any("unknown node 'missing'" in p for p in problems)

    def test_unknown_band_names_are_refused_by_the_schema(self, pip):
        body = with_dialogue(pip, [line("a", "Hi", bands=["TODDLER"])])
        assert authoring.validate(pip, body)

    def test_quest_and_adventure_references_must_exist(self, pip):
        node = line("a", "Fix the bridge!")
        node["questId"], node["adventureSlug"] = "repair", "fix-bridge"
        assert authoring.validate(pip, with_dialogue(pip, [node])) == []
        node["questId"], node["adventureSlug"] = "ghost", "nowhere"
        problems = authoring.validate(pip, with_dialogue(pip, [node]))
        assert any("unknown quest 'ghost'" in p for p in problems)
        assert any("unknown adventure 'nowhere'" in p for p in problems)

    def test_per_band_copy_limits_apply_to_banded_lines(self, pip):
        body = with_dialogue(pip, [line("a", "x" * 200, bands=["SPROUT"]), line("b", "Hi")])
        problems = authoring.validate(pip, body)
        assert any("$.dialogue[0].text: longer than 160 characters" in p for p in problems)

    def test_speaker_is_child_facing_text_and_is_screened(self, pip):
        node = line("a", "Hi")
        node["speaker"] = "Tell me your home address"
        assert any("child-safety" in p for p in authoring.validate(pip, with_dialogue(pip, [node])))


class TestServedDialogue:
    def _publish(self, pip, staff, nodes):
        authoring.publish(
            authoring.create_draft(pip, with_dialogue(pip, nodes), user=staff), user=staff
        )
        pip.refresh_from_db()

    def test_each_band_hears_only_its_own_lines(self, pip, staff, families):
        self._publish(pip, staff, GOOD)
        child = families.a1
        assert served_ids(child, "SPROUT", pip) == ["hello-sprout", "fallback"]
        assert served_ids(child, "PATHFINDER", pip) == ["hello-big", "fallback"]
        assert served_ids(child, "EXPLORER", pip) == ["hello-big", "fallback"]

    def test_lines_without_bands_reach_every_band(self, pip, families):
        nodes = [line("a", "Hi")]
        pip.__class__.objects.filter(pk=pip.pk).update(source={**pip.source, "dialogue": nodes})
        pip.refresh_from_db()
        for band in BANDS:
            assert served_ids(families.a1, band, pip) == ["a"]

    def test_a_choice_to_a_line_the_band_never_hears_is_not_offered(self, pip, staff, families):
        nodes = [
            line(
                "ask",
                "Want to play?",
                choices=[
                    {"id": "easy", "label": "Easy", "nextNodeId": "easy"},
                    {"id": "hard", "label": "Hard", "nextNodeId": "hard"},
                ],
            ),
            line("easy", "Easy puzzle", follow_up=True),
            line("hard", "Hard puzzle", bands=["EXPLORER"], follow_up=True),
        ]
        self._publish(pip, staff, nodes)
        child = families.a1
        child.age_band = "SPROUT"
        sprout = {n["nodeId"]: n for n in npc_dialogue(child, None, pip)}
        assert [c["choiceId"] for c in sprout["ask"]["choices"]] == ["easy"]
        assert "hard" not in sprout
        child.age_band = "EXPLORER"
        explorer = {n["nodeId"]: n for n in npc_dialogue(child, None, pip)}
        assert [c["choiceId"] for c in explorer["ask"]["choices"]] == ["easy", "hard"]

    def test_a_visit_keeps_the_dialogue_it_started_with(self, pip, staff, families):
        """The band filter reads the pinned body, so a publish mid-visit changes nothing."""
        from apps.catalog.models import Adventure
        from apps.game_sessions import services

        bridge = Adventure.objects.get(slug="fix-bridge")
        session, _ = services.start_or_resume_session(families.a1, bridge)
        authoring.pin(session, [pip])
        self._publish(pip, staff, GOOD)
        child = families.a1
        child.age_band = "SPROUT"
        before = [n["nodeId"] for n in npc_dialogue(child, session, pip)]
        assert before == []  # the pinned (empty) dialogue, not the new banded one
        assert [n["nodeId"] for n in npc_dialogue(child, None, pip)] == ["hello-sprout", "fallback"]


def test_the_pure_rule_checks_only_what_it_is_given():
    problems: list[str] = []
    records.npc_dialogue_problems({"dialogue": []}, BANDS, "npc 'x'", problems)
    assert problems == []


def puzzle_line(node_id, text, part="intro", *, bands=None, puzzle="cove-look"):
    node = line(node_id, text, bands=bands, follow_up=True)
    node["puzzleLine"] = {"puzzleId": puzzle, "part": part}
    return node


class TestPuzzleLines:
    """LAI-0817 (FP-D9): what an NPC says in a 3D Area puzzle's panel."""

    def test_banded_puzzle_lines_publish_and_do_not_count_as_openers(self, pip, staff):
        nodes = [
            line("hello", "Ahoy!"),
            puzzle_line("look-path", "Look up.", bands=["PATHFINDER"]),
            puzzle_line("look-exp", "Find three clues.", bands=["EXPLORER"]),
            puzzle_line("look-done", "Well spotted!", "completeMessage"),
        ]
        body = with_dialogue(pip, nodes)
        assert authoring.validate(pip, body) == []
        authoring.publish(authoring.create_draft(pip, body, user=staff), user=staff)
        # Banded puzzle lines alone never satisfy (or break) the conversation opener rule.
        problems = authoring.validate(pip, with_dialogue(pip, nodes[1:]))
        assert problems == []

    def test_puzzle_lines_are_not_served_in_conversation(self, pip, families):
        nodes = [line("hello", "Ahoy!"), puzzle_line("look", "Look up.")]
        pip.source = with_dialogue(pip, nodes)
        child = families.a1
        for band in BANDS:
            assert served_ids(child, band, pip) == ["hello"]

    def test_two_lines_for_the_same_band_puzzle_and_part_are_refused(self, pip):
        nodes = [
            line("hello", "Ahoy!"),
            puzzle_line("a", "Look up.", bands=["PATHFINDER", "EXPLORER"]),
            puzzle_line("b", "Look down.", bands=["EXPLORER"]),
            puzzle_line("c", "Done!", "completeMessage", bands=["EXPLORER"]),
        ]
        problems = authoring.validate(pip, with_dialogue(pip, nodes))
        assert problems == [
            "npc 'pip': age band EXPLORER hears two intro lines for puzzle 'cove-look' "
            "('a' and 'b')"
        ]

    def test_a_puzzle_line_must_be_a_bare_follow_up(self, pip):
        chatty = puzzle_line("a", "Look up.")
        chatty["choices"] = [{"id": "ok", "label": "OK"}]
        opener = puzzle_line("b", "Done!", "completeMessage")
        del opener["followUpOnly"]
        problems = authoring.validate(pip, with_dialogue(pip, [line("hi", "Hi"), chatty, opener]))
        assert sum("must be follow-up only" in p for p in problems) == 2

    def test_a_choice_cannot_lead_to_a_puzzle_line(self, pip):
        nodes = [
            line("hi", "Hi", choices=[{"id": "go", "label": "Go", "nextNodeId": "a"}]),
            puzzle_line("a", "Look up."),
        ]
        problems = authoring.validate(pip, with_dialogue(pip, nodes))
        assert any("leads to puzzle line 'a'" in p for p in problems)

    @pytest.mark.parametrize(
        "puzzle_line_value",
        [
            {"puzzleId": "cove-look", "part": "hints"},
            {"puzzleId": "Not A Slug", "part": "intro"},
            {"puzzleId": "cove-look"},
        ],
    )
    def test_a_malformed_puzzle_line_is_refused(self, pip, puzzle_line_value):
        node = puzzle_line("a", "Look up.")
        node["puzzleLine"] = puzzle_line_value
        assert authoring.validate(pip, with_dialogue(pip, [line("hi", "Hi"), node]))

    def test_the_pure_rule_reports_each_problem(self):
        problems: list[str] = []
        bad = {"id": "x", "text": "t", "followUpOnly": True, "puzzleLine": {"part": "intro"}}
        records.puzzle_line_problems([bad], "npc 'x'", problems)
        assert problems == ["npc 'x': puzzle line 'x' needs exactly puzzleId and part"]
