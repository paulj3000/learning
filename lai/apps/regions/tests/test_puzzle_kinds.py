"""CHOOSE_ANSWER and ORDER_SEQUENCE (Heart of Firepeak design section 5): parameter rules,
graders, authoring cross-checks, the migration, and practice replay (FPV-D6)."""

import copy

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from apps.catalog import authoring
from apps.core.content_status import ContentStatus
from apps.game_sessions.models import PuzzleAttempt
from apps.inventory.models import GrantedRule
from apps.progression.models import WorldChange
from apps.regions import puzzles
from apps.regions.models import AreaPuzzle, PlacementKind, PuzzleKind, WorldObjectPlacement
from apps.regions.seeding import SeedContentInvalid, seed_puzzle

from .test_puzzles import puzzle_body, session_for, solve

CHOOSE = {
    "presentation": "PLATFORMS",
    "subject": "MATHEMATICS",
    "skill": "addition-within-10",
    "optionEntities": {"a": "fh-stone-a", "b": "fh-stone-b"},
    "variants": [
        {
            "id": "v1",
            "prompt": "2 + 3 = ?",
            "options": [
                {"id": "a", "label": "4", "symbol": "circle"},
                {"id": "b", "label": "5", "symbol": "square"},
            ],
            "answer": "b",
            "explanation": "2 and 3 make 5.",
        },
        {
            "id": "v2",
            "prompt": "1 + 1 = ?",
            "options": [{"id": "a", "label": "2"}, {"id": "b", "label": "3"}],
            "answer": "a",
            "explanation": "1 and 1 make 2.",
        },
    ],
    "hints": ["Count on your fingers."],
    "hintAfterAttempts": 2,
}
ORDER = {
    "presentation": "SWITCHES",
    "subject": "LOGIC",
    "skill": "sequencing",
    "itemEntities": {"red": "fh-switch-red", "blue": "fh-switch-blue", "gold": "fh-switch-gold"},
    "variants": [
        {
            "id": "v1",
            "prompt": "Press the switches in order.",
            "items": [
                {"id": "red", "label": "Fire switch", "symbol": "triangle"},
                {"id": "blue", "label": "Water switch"},
                {"id": "gold", "label": "Sun switch"},
            ],
            "answer": ["red", "blue", "gold"],
            "explanation": "Fire, then water, then sun.",
        }
    ],
    "hints": [],
}
CHOOSE_ENTITIES = ["fh-stone-a", "fh-stone-b"]
ORDER_ENTITIES = ["fh-switch-red", "fh-switch-blue", "fh-switch-gold"]


def problems_for(kind, params):
    return puzzles.RULES[kind].band_problems(params, "$")


def edited(params, mutate):
    clone = copy.deepcopy(params)
    mutate(clone)
    return clone


class TestValidators:
    @pytest.mark.parametrize(
        ("kind", "params"),
        [(PuzzleKind.CHOOSE_ANSWER, CHOOSE), (PuzzleKind.ORDER_SEQUENCE, ORDER)],
    )
    def test_good_parameters_have_no_problems(self, kind, params):
        assert problems_for(kind, params) == []
        assert puzzles.body_problems(kind, puzzle_body("p", kind, "SOME_KEY", params)) == []

    @pytest.mark.parametrize(
        ("mutate", "expected"),
        [
            (lambda p: p.update(presentation="NOPE"), "presentation"),
            (lambda p: p.update(subject="ART"), "subject"),
            (lambda p: p.update(skill="Not A Slug"), "skill"),
            (lambda p: p.update(variants=[]), "variants"),
            (lambda p: p.update(variants=CHOOSE["variants"][:1] * 9), "variants"),
            (lambda p: p["variants"][1].update(id="v1"), "ids must be unique"),
            (lambda p: p["variants"][0].update(id="V 1"), "variants[0].id"),
            (lambda p: p["variants"][0].update(prompt="x" * 201), "prompt"),
            (lambda p: p["variants"][0].update(prompt=""), "prompt"),
            (lambda p: p["variants"][0].update(explanation="x" * 241), "explanation"),
            (lambda p: p["variants"][0].update(answer="z"), "answer"),
            (lambda p: p["variants"][0].update(options=p["variants"][0]["options"][:1]), "options"),
            (lambda p: p["variants"][0]["options"][0].update(symbol="blob"), "symbol"),
            (lambda p: p["variants"][0]["options"][1].update(id="a"), "ids must be unique"),
            (lambda p: p["variants"][0].update(extra=1), "unknown settings"),
            (lambda p: p["optionEntities"].update(c="fh-stone-c"), "keys of the entity map"),
            (lambda p: p["optionEntities"].update(b="fh-stone-a"), "own placement"),
            (lambda p: p.update(optionEntities=[]), "optionEntities"),
            (lambda p: p.update(surprise=True), "unknown settings"),
            (lambda p: p.update(intro="Hello"), "NPC dialogue"),
            (lambda p: p.update(hintAfterAttempts=0), "hintAfterAttempts"),
        ],
    )
    def test_each_bad_choose_answer_case_is_reported(self, mutate, expected):
        problems = problems_for(PuzzleKind.CHOOSE_ANSWER, edited(CHOOSE, mutate))
        assert any(expected in problem for problem in problems), problems

    @pytest.mark.parametrize(
        ("mutate", "expected"),
        [
            (lambda p: p.update(presentation="PLATFORMS"), "presentation"),
            (lambda p: p["variants"][0].update(answer=["red", "blue"]), "answer"),
            (lambda p: p["variants"][0].update(answer=["red", "red", "gold"]), "answer"),
            (lambda p: p["variants"][0].update(answer=["red", "blue", "pink"]), "answer"),
            (lambda p: p["variants"][0].update(answer="red"), "answer"),
            (lambda p: p["variants"][0].update(items=p["variants"][0]["items"][:1]), "items"),
            (
                lambda p: p["variants"][0]["items"].extend(
                    {"id": f"x{i}", "label": "x"} for i in range(4)
                ),
                "items",
            ),
            (lambda p: p["variants"][0]["items"][0].update(symbol="blob"), "symbol"),
            (lambda p: p["variants"][0]["items"][1].update(id="red"), "ids must be unique"),
            (lambda p: p["itemEntities"].pop("gold"), "keys of the entity map"),
        ],
    )
    def test_each_bad_order_sequence_case_is_reported(self, mutate, expected):
        problems = problems_for(PuzzleKind.ORDER_SEQUENCE, edited(ORDER, mutate))
        assert any(expected in problem for problem in problems), problems

    @pytest.mark.parametrize("kind", [PuzzleKind.CHOOSE_ANSWER, PuzzleKind.ORDER_SEQUENCE])
    @pytest.mark.parametrize(
        "junk",
        [{}, {"variants": "x"}, {"variants": [1]}, {"variants": [{}], "optionEntities": 5}],
    )
    def test_malformed_parameters_never_raise(self, kind, junk):
        assert problems_for(kind, junk)


class TestGraders:
    def test_choose_answer(self):
        grade = puzzles.RULES[PuzzleKind.CHOOSE_ANSWER].grade
        assert grade(CHOOSE, {"variantId": "v1", "choice": "b"}) is True
        assert grade(CHOOSE, {"variantId": "v1", "choice": "a"}) is False
        assert grade(CHOOSE, {"variantId": "v2", "choice": "a"}) is True

    @pytest.mark.parametrize(
        "submission",
        [
            None,
            [],
            {},
            {"variantId": "v1"},
            {"choice": "a"},
            {"variantId": "nope", "choice": "a"},
            {"variantId": "v1", "choice": "z"},
            {"variantId": "v1", "choice": 1},
            {"variantId": 1, "choice": "a"},
            {"variantId": "v1", "choice": "a", "extra": 1},
        ],
    )
    def test_choose_answer_rejects_malformed(self, submission):
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(PuzzleKind.CHOOSE_ANSWER, CHOOSE, submission)

    def test_order_sequence(self):
        grade = puzzles.RULES[PuzzleKind.ORDER_SEQUENCE].grade
        assert grade(ORDER, {"variantId": "v1", "order": ["red", "blue", "gold"]}) is True
        assert grade(ORDER, {"variantId": "v1", "order": ["blue", "red", "gold"]}) is False

    @pytest.mark.parametrize(
        "submission",
        [
            None,
            {"variantId": "v1"},
            {"variantId": "nope", "order": ["red", "blue", "gold"]},
            {"variantId": "v1", "order": ["red", "blue"]},
            {"variantId": "v1", "order": ["red", "red", "gold"]},
            {"variantId": "v1", "order": ["red", "blue", "pink"]},
            {"variantId": "v1", "order": "red"},
            {"variantId": "v1", "order": ["red", "blue", "gold"], "extra": 1},
        ],
    )
    def test_order_sequence_rejects_malformed(self, submission):
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(PuzzleKind.ORDER_SEQUENCE, ORDER, submission)


@pytest.fixture
def quiz(treasure):
    """Treasure Cove with a published CHOOSE_ANSWER and ORDER_SEQUENCE puzzle."""
    region = treasure.region
    for index, entity in enumerate([*CHOOSE_ENTITIES, *ORDER_ENTITIES]):
        WorldObjectPlacement.objects.create(
            region=region, entity_id=entity, kind=PlacementKind.PROP, x=index, z=-3
        )
    choose, _ = seed_puzzle(
        region,
        puzzle_id="choose",
        kind=PuzzleKind.CHOOSE_ANSWER,
        entity_ids=CHOOSE_ENTITIES,
        body=puzzle_body(
            "choose",
            PuzzleKind.CHOOSE_ANSWER,
            "COVE_CHOSE",
            CHOOSE,
            reward="reward-treasure-rush-cove-chest",
        ),
    )
    order, _ = seed_puzzle(
        region,
        puzzle_id="order",
        kind=PuzzleKind.ORDER_SEQUENCE,
        entity_ids=ORDER_ENTITIES,
        body=puzzle_body("order", PuzzleKind.ORDER_SEQUENCE, "COVE_ORDERED", ORDER),
        sort_order=1,
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return treasure, choose, order


RIGHT_CHOOSE = {"variantId": "v1", "choice": "b"}
WRONG_CHOOSE = {"variantId": "v1", "choice": "a"}
RIGHT_ORDER = {"variantId": "v1", "order": ["red", "blue", "gold"]}
WRONG_ORDER = {"variantId": "v1", "order": ["gold", "blue", "red"]}


@pytest.mark.postgres
@pytest.mark.django_db
class TestPractice:
    def test_the_first_solve_records_and_a_wrong_answer_is_a_normal_attempt(self, quiz, api):
        treasure = quiz[0]
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        wrong = solve(client, child, session, "choose", WRONG_CHOOSE).json()
        assert wrong["correct"] is False
        assert wrong["practice"] is False
        assert wrong["failedAttempts"] == 1
        right = solve(client, child, session, "choose", RIGHT_CHOOSE).json()
        assert right["correct"] is True
        assert right["solvedNow"] is True
        assert right["practice"] is False
        assert right["alreadySolved"] is False

    @pytest.mark.parametrize(
        ("puzzle_id", "right", "wrong"),
        [
            ("choose", RIGHT_CHOOSE, WRONG_CHOOSE),
            ("order", RIGHT_ORDER, WRONG_ORDER),
        ],
    )
    def test_a_solved_puzzle_grades_and_records_nothing(self, quiz, api, puzzle_id, right, wrong):
        treasure = quiz[0]
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        assert solve(client, child, session, puzzle_id, right).json()["solvedNow"] is True
        attempts = PuzzleAttempt.objects.count()
        changes = WorldChange.objects.count()
        grants = GrantedRule.objects.count()

        for submission, correct in ((wrong, False), (right, True)):
            response = solve(client, child, session, puzzle_id, submission)
            assert response.status_code == 200
            body = response.json()
            assert body["correct"] is correct
            assert body["feedback"] == ("CORRECT" if correct else "TRY_AGAIN")
            assert body["alreadySolved"] is True
            assert body["practice"] is True
            assert body["solvedNow"] is False
            assert body["attemptId"] is None
            assert body["newItems"] == []

        assert PuzzleAttempt.objects.count() == attempts
        assert WorldChange.objects.count() == changes
        assert GrantedRule.objects.count() == grants

    def test_a_malformed_practice_submission_is_still_a_400(self, quiz, api):
        treasure = quiz[0]
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        solve(client, child, session, "choose", RIGHT_CHOOSE)
        response = solve(client, child, session, "choose", {"variantId": "v1", "choice": "zzz"})
        assert response.status_code == 400
        assert "invalid_submission" in response.content.decode()

    def test_other_kinds_keep_returning_already_solved_without_grading(self, area_fixture, api):
        treasure = area_fixture
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        assert solve(client, child, session, "look", {"observed": ["crater", "vent"]}).json()[
            "solvedNow"
        ]
        again = solve(client, child, session, "look", {"observed": []}).json()
        assert again["correct"] is True
        assert again["alreadySolved"] is True
        assert again["practice"] is False


@pytest.fixture
def area_fixture(treasure):
    from .test_puzzles import OBSERVE

    seed_puzzle(
        treasure.region,
        puzzle_id="look",
        kind=PuzzleKind.OBSERVE_FEATURES,
        entity_ids=["cove-bridge-signpost"],
        body=puzzle_body("look", PuzzleKind.OBSERVE_FEATURES, "COVE_LOOKED", OBSERVE),
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return treasure


@pytest.mark.postgres
@pytest.mark.django_db
class TestAuthoringCrossChecks:
    def test_option_and_item_entities_must_be_puzzle_entities(self, quiz):
        _, choose, order = quiz
        body = authoring.current_body(choose)
        body["ageBands"]["PATHFINDER"]["optionEntities"]["a"] = "somewhere-else"
        assert any("somewhere-else" in p for p in authoring.validate(choose, body))
        body = authoring.current_body(order)
        body["ageBands"]["PATHFINDER"]["itemEntities"]["red"] = "somewhere-else"
        assert any("somewhere-else" in p for p in authoring.validate(order, body))

    def test_a_valid_body_has_no_problems(self, quiz):
        _, choose, order = quiz
        assert authoring.validate(choose, authoring.current_body(choose)) == []
        assert authoring.validate(order, authoring.current_body(order)) == []

    def test_existing_object_keys_are_still_checked(self, quiz):
        _, choose, _ = quiz
        # stones/slots/valves cross-checks still apply to the older kinds (regression).
        from apps.regions.authoring_kinds import LIST_ENTITY_KEYS

        assert LIST_ENTITY_KEYS == ("stones", "slots", "valves")

    def test_a_seed_with_bad_quiz_content_is_refused(self, treasure):
        bad = edited(CHOOSE, lambda p: p["variants"][0].update(answer="z"))
        with pytest.raises(SeedContentInvalid):
            seed_puzzle(
                treasure.region,
                puzzle_id="bad",
                kind=PuzzleKind.CHOOSE_ANSWER,
                entity_ids=CHOOSE_ENTITIES,
                body=puzzle_body("bad", PuzzleKind.CHOOSE_ANSWER, "BAD_KEY", bad),
            )


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_the_kind_migration_applies_and_rolls_back():
    # Target the kind migration by name: later migrations (the castle's 0008 and 0009 on the
    # integration branch) may sit on top, so the regions leaf is not this migration.
    kinds = ("regions", "0007_puzzle_kinds_choose_order")
    previous = ("regions", "0006_merge_main")
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes("regions")
    assert kinds in executor.loader.graph.nodes
    try:
        executor.migrate([previous])
        assert "CHOOSE_ANSWER" not in _constraint_definition()
        executor = MigrationExecutor(connection)
        executor.migrate([kinds])
        constraint_sql = _constraint_definition()
        assert "CHOOSE_ANSWER" in constraint_sql
        assert "ORDER_SEQUENCE" in constraint_sql
    finally:
        # Leave the schema where the rest of the suite expects it.
        executor = MigrationExecutor(connection)
        executor.migrate(leaves)


def _constraint_definition() -> str:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
            "WHERE conname = 'regions_puzzle_kind_valid'"
        )
        return cursor.fetchone()[0]


class TestVariantSkill:
    """FPV-D10: a variant may name its own skill; evidence uses the answered variant's."""

    @pytest.mark.parametrize(
        ("kind", "params"),
        [(PuzzleKind.CHOOSE_ANSWER, CHOOSE), (PuzzleKind.ORDER_SEQUENCE, ORDER)],
    )
    def test_a_variant_skill_slug_is_accepted_and_a_bad_one_reported(self, kind, params):
        good = edited(params, lambda p: p["variants"][0].update(skill="counting-sets"))
        assert problems_for(kind, good) == []
        for bad in ("Not A Slug", "", 7):
            clone = edited(params, lambda p, bad=bad: p["variants"][0].update(skill=bad))
            assert "$.variants[0].skill: must be a lowercase slug" in problems_for(kind, clone)

    def test_the_answered_variant_overrides_the_band_skill(self):
        params = edited(CHOOSE, lambda p: p["variants"][1].update(skill="addition-within-ten"))
        kind = PuzzleKind.CHOOSE_ANSWER
        assert puzzles.skill_for(kind, params, {"variantId": "v1", "choice": "b"}) == (
            "addition-within-10"
        )
        assert puzzles.skill_for(kind, params, {"variantId": "v2", "choice": "a"}) == (
            "addition-within-ten"
        )
        assert puzzles.skill_for(PuzzleKind.ORDER_SEQUENCE, ORDER, RIGHT_ORDER) == "sequencing"

    @pytest.mark.parametrize(
        "kind",
        [k for k in PuzzleKind.values if k not in puzzles.SKILL_KINDS],
    )
    def test_mechanical_kinds_teach_no_curriculum_skill(self, kind):
        assert puzzles.skill_for(kind, {"skill": "patterns"}, {}) is None
