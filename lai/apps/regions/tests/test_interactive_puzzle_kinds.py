"""Issue #102: NAVIGATE_ROUTE, SORT_ITEMS and SHARE_ITEMS (parameter rules, graders, skills), the
optional skill on movement kinds, and hint-assisted evidence through the real play API."""

import copy

import pytest

from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence, SkillProgress
from apps.game_sessions.models import PuzzleAttempt
from apps.inventory.models import GrantedRule
from apps.progression.models import WorldChange
from apps.regions import puzzles
from apps.regions.models import AreaPuzzle, PlacementKind, PuzzleKind, WorldObjectPlacement
from apps.regions.seeding import seed_puzzle

from .test_puzzles import PLATFORMS, VALVES, puzzle_body, session_for, solve

ROUTE = {
    "presentation": "MAP",
    "subject": "MATHEMATICS",
    "skill": "following-instructions",
    "variants": [
        {
            "id": "v1",
            "prompt": "Pip's map: walk to the X, but not through the rocks.",
            "columns": 3,
            "rows": 3,
            "start": [0, 0],
            "goal": [2, 2],
            "blocked": [[1, 0], [1, 1]],
            "maxMoves": 6,
        },
        {
            "id": "v2",
            "prompt": "Two steps east.",
            "columns": 3,
            "rows": 2,
            "start": [0, 0],
            "goal": [2, 0],
            "maxMoves": 2,
            "skill": "observation",
        },
    ],
    "hints": ["The rocks are in the middle column.", "Go down first."],
}
RIGHT_STONES = {"placements": {"gap-a": "middle", "gap-b": "big"}}
RIGHT_ROUTE = {"variantId": "v1", "moves": ["S", "S", "E", "E"]}
WRONG_ROUTE = {"variantId": "v1", "moves": ["E", "E", "S", "S"]}  # walks into a rock

SORT = {
    "presentation": "BINS",
    "subject": "LOGIC",
    "skill": "classification",
    "variants": [
        {
            "id": "v1",
            "prompt": "Shells in the bucket, stones in the crate.",
            "bins": [
                {"id": "bucket", "label": "Shells", "symbol": "moon"},
                {"id": "crate", "label": "Stones", "symbol": "square"},
            ],
            "items": [
                {"id": "conch", "label": "Conch", "bin": "bucket"},
                {"id": "scallop", "label": "Scallop", "bin": "bucket"},
                {"id": "pebble", "label": "Pebble", "bin": "crate"},
            ],
        }
    ],
    "hints": ["Shells come from the sea."],
}
RIGHT_SORT = {
    "variantId": "v1",
    "placements": {"conch": "bucket", "scallop": "bucket", "pebble": "crate"},
}
WRONG_SORT = {
    "variantId": "v1",
    "placements": {"conch": "bucket", "scallop": "crate", "pebble": "crate"},
}

SHARE = {
    "presentation": "CHESTS",
    "subject": "MATHEMATICS",
    "skill": "equal-sharing",
    "variants": [
        {
            "id": "v1",
            "prompt": "Share 6 coins so each pirate gets the same.",
            "total": 6,
            "containers": [
                {"id": "pip", "label": "Pip", "target": 3},
                {"id": "polly", "label": "Polly", "target": 3},
            ],
        },
        {
            "id": "v2",
            "prompt": "Fill each barrel to its mark.",
            "total": 5,
            "containers": [
                {"id": "big", "label": "Big barrel", "target": 4},
                {"id": "small", "label": "Small barrel", "target": 1},
            ],
            "skill": "measurement",
        },
    ],
    "hints": ["Give one coin to each pirate, then again."],
}
RIGHT_SHARE = {"variantId": "v1", "counts": {"pip": 3, "polly": 3}}
WRONG_SHARE = {"variantId": "v1", "counts": {"pip": 4, "polly": 2}}

NEW_KINDS = [
    (PuzzleKind.NAVIGATE_ROUTE, ROUTE),
    (PuzzleKind.SORT_ITEMS, SORT),
    (PuzzleKind.SHARE_ITEMS, SHARE),
]


def problems_for(kind, params):
    return puzzles.body_problems(kind, puzzle_body("p", kind, "SOME_KEY", params))


def edited(params, mutate):
    copied = copy.deepcopy(params)
    mutate(copied)
    return copied


class TestValidators:
    @pytest.mark.parametrize(("kind", "params"), NEW_KINDS)
    def test_good_parameters_have_no_problems(self, kind, params):
        assert problems_for(kind, params) == []

    @pytest.mark.parametrize(
        ("mutate", "expected"),
        [
            (lambda p: p["variants"][0].update(maxMoves=3), "cannot be solved"),
            (
                lambda p: p["variants"][0].update(blocked=[[1, 0], [1, 1], [1, 2]]),
                "cannot be solved",
            ),
            (lambda p: p["variants"][0].update(goal=[5, 5]), "start and goal"),
            (lambda p: p["variants"][0].update(blocked=[[0, 0]]), "cannot be blocked"),
            (lambda p: p["variants"][0].update(goal=[0, 0]), "somewhere other than the start"),
            (lambda p: p["variants"][0].update(columns=9), "columns"),
            (lambda p: p["variants"][0].update(maxMoves=13), "maxMoves"),
            (lambda p: p["variants"][0].update(secret="x"), "unknown settings"),
            (lambda p: p.update(presentation="MAZE"), "presentation"),
            (lambda p: p.pop("skill"), "skill"),
        ],
    )
    def test_each_bad_route_case_is_reported(self, mutate, expected):
        problems = problems_for(PuzzleKind.NAVIGATE_ROUTE, edited(ROUTE, mutate))
        assert any(expected in problem for problem in problems), problems

    @pytest.mark.parametrize(
        ("mutate", "expected"),
        [
            (lambda p: p["variants"][0]["items"][0].update(bin="shelf"), "must be one of the bins"),
            (
                lambda p: p["variants"][0].update(items=p["variants"][0]["items"][:2]),
                "every bin needs at least one item",
            ),
            (lambda p: p["variants"][0].update(bins=p["variants"][0]["bins"][:1]), "bins"),
            (lambda p: p.update(itemEntities={"conch": "cove-a"}), "entity map"),
        ],
    )
    def test_each_bad_sort_case_is_reported(self, mutate, expected):
        problems = problems_for(PuzzleKind.SORT_ITEMS, edited(SORT, mutate))
        assert any(expected in problem for problem in problems), problems

    @pytest.mark.parametrize(
        ("mutate", "expected"),
        [
            (lambda p: p["variants"][0].update(total=7), "add up to the total"),
            (lambda p: p["variants"][0]["containers"][0].update(target=-1), "target"),
            (lambda p: p["variants"][0].update(total=21), "total"),
            (lambda p: p["variants"][0].update(containers=[]), "containers"),
        ],
    )
    def test_each_bad_share_case_is_reported(self, mutate, expected):
        problems = problems_for(PuzzleKind.SHARE_ITEMS, edited(SHARE, mutate))
        assert any(expected in problem for problem in problems), problems

    @pytest.mark.parametrize("kind", [k for k, _ in NEW_KINDS])
    @pytest.mark.parametrize(
        "junk",
        [
            None,
            [],
            "x",
            {"variants": "x"},
            {"variants": [None]},
            {"variants": [{"id": "v1", "columns": "3", "containers": "x", "items": [1]}]},
        ],
    )
    def test_malformed_parameters_never_raise(self, kind, junk):
        assert puzzles.body_problems(kind, puzzle_body("p", kind, "SOME_KEY", junk))

    @pytest.mark.parametrize(
        ("kind", "params"),
        [(PuzzleKind.PLACE_PLATFORMS, PLATFORMS), (PuzzleKind.VALVE_SEQUENCE, VALVES)],
    )
    def test_movement_kinds_accept_an_optional_skill_slug(self, kind, params):
        assert problems_for(kind, params) == []
        assert problems_for(kind, {**params, "skill": "comparing-lengths"}) == []
        assert any("skill" in p for p in problems_for(kind, {**params, "skill": "Not A Slug"}))


class TestGraders:
    def test_route(self):
        kind = PuzzleKind.NAVIGATE_ROUTE
        assert puzzles.grade(kind, ROUTE, RIGHT_ROUTE) is True
        assert puzzles.grade(kind, ROUTE, WRONG_ROUTE) is False
        assert puzzles.grade(kind, ROUTE, {"variantId": "v1", "moves": ["N"]}) is False  # off map
        assert puzzles.grade(kind, ROUTE, {"variantId": "v1", "moves": ["S", "S"]}) is False
        # A longer route that still arrives, within maxMoves.
        assert puzzles.grade(
            kind, ROUTE, {"variantId": "v1", "moves": ["S", "N", "S", "S", "E", "E"]}
        )
        # Past maxMoves is a wrong answer, not a malformed one.
        too_long = {"variantId": "v1", "moves": ["S", "N", "S", "N", "S", "S", "E", "E"]}
        assert puzzles.grade(kind, ROUTE, too_long) is False
        assert puzzles.grade(kind, ROUTE, {"variantId": "v2", "moves": ["E", "E"]}) is True

    @pytest.mark.parametrize(
        "submission",
        [
            {},
            {"variantId": "v1"},
            {"variantId": "v9", "moves": []},
            {"variantId": "v1", "moves": ["UP"]},
            {"variantId": "v1", "moves": "SSEE"},
            {"variantId": "v1", "moves": ["S"] * 25},
            {"variantId": "v1", "moves": [], "extra": 1},
        ],
    )
    def test_route_rejects_malformed(self, submission):
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(PuzzleKind.NAVIGATE_ROUTE, ROUTE, submission)

    def test_sort(self):
        kind = PuzzleKind.SORT_ITEMS
        assert puzzles.grade(kind, SORT, RIGHT_SORT) is True
        assert puzzles.grade(kind, SORT, WRONG_SORT) is False
        partial = {"variantId": "v1", "placements": {"conch": "bucket", "scallop": "bucket"}}
        assert puzzles.grade(kind, SORT, partial) is False

    @pytest.mark.parametrize(
        "submission",
        [
            {"variantId": "v1", "placements": {"crab": "bucket"}},
            {"variantId": "v1", "placements": {"conch": "shelf"}},
            {"variantId": "v1", "placements": ["conch"]},
            {"variantId": "v1", "placements": {"conch": 1}},
        ],
    )
    def test_sort_rejects_malformed(self, submission):
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(PuzzleKind.SORT_ITEMS, SORT, submission)

    def test_share(self):
        kind = PuzzleKind.SHARE_ITEMS
        assert puzzles.grade(kind, SHARE, RIGHT_SHARE) is True
        assert puzzles.grade(kind, SHARE, WRONG_SHARE) is False
        assert puzzles.grade(kind, SHARE, {"variantId": "v1", "counts": {"pip": 3}}) is False
        assert puzzles.grade(kind, SHARE, {"variantId": "v2", "counts": {"big": 4, "small": 1}})

    @pytest.mark.parametrize(
        "submission",
        [
            {"variantId": "v1", "counts": {"captain": 3}},
            {"variantId": "v1", "counts": {"pip": -1}},
            {"variantId": "v1", "counts": {"pip": True}},
            {"variantId": "v1", "counts": {"pip": 7}},
            {"variantId": "v1", "counts": [3, 3]},
        ],
    )
    def test_share_rejects_malformed(self, submission):
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(PuzzleKind.SHARE_ITEMS, SHARE, submission)


class TestSkills:
    def test_new_kinds_name_the_band_or_variant_skill(self):
        assert puzzles.skill_for(PuzzleKind.NAVIGATE_ROUTE, ROUTE, RIGHT_ROUTE) == (
            "following-instructions"
        )
        assert (
            puzzles.skill_for(PuzzleKind.NAVIGATE_ROUTE, ROUTE, {"variantId": "v2", "moves": []})
            == "observation"
        )
        assert puzzles.skill_for(PuzzleKind.SORT_ITEMS, SORT, RIGHT_SORT) == "classification"
        assert puzzles.skill_for(PuzzleKind.SHARE_ITEMS, SHARE, RIGHT_SHARE) == "equal-sharing"
        assert (
            puzzles.skill_for(PuzzleKind.SHARE_ITEMS, SHARE, {"variantId": "v2", "counts": {}})
            == "measurement"
        )

    def test_a_movement_kind_teaches_a_skill_only_when_it_names_one(self):
        kind = PuzzleKind.PLACE_PLATFORMS
        assert puzzles.skill_for(kind, PLATFORMS, {"placements": {}}) is None
        named = {**PLATFORMS, "skill": "comparing-lengths"}
        assert puzzles.skill_for(kind, named, {"placements": {}}) == "comparing-lengths"

    @pytest.mark.parametrize(
        "kind",
        [PuzzleKind.OBSERVE_FEATURES, PuzzleKind.COLLECT_OBJECT, PuzzleKind.RETURN_TO_NPC],
    )
    def test_collecting_looking_and_returning_never_teach_a_skill(self, kind):
        assert kind not in puzzles.EVIDENCE_KINDS
        assert puzzles.skill_for(kind, {"skill": "counting-sets"}, {}) is None

    def test_every_new_kind_is_a_quiz_kind_with_practice_replay(self):
        from apps.game_sessions.play import PRACTICE_KINDS

        for kind, _ in NEW_KINDS:
            assert kind in puzzles.SKILL_KINDS
            assert kind in PRACTICE_KINDS


# --- Through the play API -------------------------------------------------------------------------


@pytest.fixture
def interactive(treasure):
    """Treasure Cove with one published puzzle of each new kind and a skilled stone crossing."""
    region = treasure.region
    for index, (kind, params) in enumerate(NEW_KINDS):
        puzzle_id = kind.lower().replace("_", "-")
        seed_puzzle(
            region,
            puzzle_id=puzzle_id,
            kind=kind,
            entity_ids=[],
            body=puzzle_body(
                puzzle_id,
                kind,
                f"COVE_{kind}",
                params,
                reward="reward-treasure-rush-cove-chest" if index == 0 else None,
            ),
            sort_order=index,
        )
    stone_entities = ["small", "big", "middle", "gap-a", "gap-b"]
    for index, entity in enumerate(stone_entities):
        WorldObjectPlacement.objects.create(
            region=region, entity_id=entity, kind=PlacementKind.PROP, x=index, z=-4
        )
    seed_puzzle(
        region,
        puzzle_id="stones",
        kind=PuzzleKind.PLACE_PLATFORMS,
        entity_ids=stone_entities,
        body=puzzle_body(
            "stones",
            PuzzleKind.PLACE_PLATFORMS,
            "COVE_STONES",
            {**PLATFORMS, "skill": "comparing-lengths"},
        ),
        sort_order=9,
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return treasure


CASES = [
    ("navigate-route", RIGHT_ROUTE, WRONG_ROUTE, "following-instructions"),
    ("sort-items", RIGHT_SORT, WRONG_SORT, "classification"),
    ("share-items", RIGHT_SHARE, WRONG_SHARE, "equal-sharing"),
]


def solve_with(client, child, session, puzzle_id, submission, hints=None):
    from .test_puzzles import base, post

    body = {"submission": submission}
    if hints is not None:
        body["hintsUsed"] = hints
    return post(client, f"{base(child)}sessions/{session}/puzzles/{puzzle_id}/solve/", body)


def evidence(child, code):
    return list(
        SkillEvidence.objects.filter(child=child, learning_objective_code=code)
        .order_by("observed_at", "pk")
        .values_list("result", "support_level")
    )


@pytest.mark.postgres
@pytest.mark.django_db
class TestPlay:
    @pytest.mark.parametrize(("puzzle_id", "right", "_wrong", "code"), CASES)
    def test_a_first_unhinted_solve_is_independent_evidence(
        self, interactive, api, puzzle_id, right, _wrong, code
    ):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        response = solve(client, child, session, puzzle_id, right)
        assert response.status_code == 200, response.content
        assert response.json()["solvedNow"] is True
        assert response.json()["skillPracticed"]["code"] == code
        assert response.json()["skillPracticed"]["title"]
        assert "supportLevel" not in response.json()  # parent views only (LAI 04, GE-101)
        assert evidence(child, code) == [("CORRECT", 0)]
        progress = SkillProgress.objects.get(child=child, learning_objective_code=code)
        assert (progress.exposure_count, progress.independent_success_count) == (1, 1)

    @pytest.mark.parametrize(("puzzle_id", "right", "wrong", "code"), CASES)
    def test_a_mistake_then_a_hinted_solve_is_supported_and_never_punished(
        self, interactive, api, puzzle_id, right, wrong, code
    ):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        first = solve_with(client, child, session, puzzle_id, wrong).json()
        assert (first["correct"], first["feedback"], first["failedAttempts"]) == (
            False,
            "TRY_AGAIN",
            1,
        )
        second = solve_with(client, child, session, puzzle_id, right, hints=1).json()
        assert second["correct"] is True and second["solvedNow"] is True
        assert evidence(child, code) == [("INCORRECT", 0), ("CORRECT", 1)]
        progress = SkillProgress.objects.get(child=child, learning_objective_code=code)
        assert progress.exposure_count == 2
        assert progress.independent_success_count == 0
        assert progress.supported_success_count == 1
        # The world change is the same as an unhinted first-try solve.
        assert (
            WorldChange.objects.filter(
                child=child, change_key=f"COVE_{puzzle_id.upper().replace('-', '_')}"
            ).count()
            == 1
        )

    def test_hints_alone_mark_a_first_answer_supported(self, interactive, api):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        solve_with(client, child, session, "sort-items", RIGHT_SORT, hints=1)
        assert evidence(child, "classification") == [("CORRECT", 1)]

    def test_hints_are_capped_at_the_bands_hint_count(self, interactive, api):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        solve_with(client, child, session, "navigate-route", RIGHT_ROUTE, hints=4)
        assert PuzzleAttempt.objects.get(child=child).hints_used == len(ROUTE["hints"])

    @pytest.mark.parametrize("hints", [-1, 5, "two", None])
    def test_an_out_of_range_hint_count_is_a_400_and_records_nothing(self, interactive, api, hints):
        from .test_puzzles import base, post

        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        response = post(
            client,
            f"{base(child)}sessions/{session}/puzzles/sort-items/solve/",
            {"submission": RIGHT_SORT, "hintsUsed": hints},
        )
        assert response.status_code == 400
        assert not PuzzleAttempt.objects.filter(child=child).exists()

    def test_a_hinted_solve_grants_the_same_reward(self, interactive, api):
        families = interactive.families
        for child, hints in ((families.a1, None), (families.a2, 2)):
            client = api(families.a)
            session = session_for(client, child)
            body = solve_with(client, child, session, "navigate-route", RIGHT_ROUTE, hints).json()
            assert body["solvedNow"] is True
        rules = {
            child.pk: sorted(
                GrantedRule.objects.filter(child=child).values_list("rule__rule_id", flat=True)
            )
            for child in (families.a1, families.a2)
        }
        assert rules[families.a1.pk] == rules[families.a2.pk] != []

    @pytest.mark.parametrize(("puzzle_id", "right", "wrong", "code"), CASES)
    def test_replay_is_graded_practice_that_records_nothing(
        self, interactive, api, puzzle_id, right, wrong, code
    ):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        solve(client, child, session, puzzle_id, right)
        before = (
            PuzzleAttempt.objects.count(),
            SkillEvidence.objects.count(),
            WorldChange.objects.count(),
            GrantedRule.objects.count(),
        )
        replay_session = session_for(client, child)
        for submission, correct in ((wrong, False), (right, True)):
            body = solve(client, child, replay_session, puzzle_id, submission).json()
            assert (body["correct"], body["practice"], body["alreadySolved"]) == (
                correct,
                True,
                True,
            )
            assert body["skillPracticed"] is None
        assert before == (
            PuzzleAttempt.objects.count(),
            SkillEvidence.objects.count(),
            WorldChange.objects.count(),
            GrantedRule.objects.count(),
        )

    def test_a_movement_puzzle_records_evidence_only_for_its_named_concept(self, interactive, api):
        client, child = api(interactive.families.a), interactive.families.a1
        session = session_for(client, child)
        body = solve(client, child, session, "stones", RIGHT_STONES).json()
        assert body["solvedNow"] is True
        assert evidence(child, "comparing-lengths") == [("CORRECT", 0)]
