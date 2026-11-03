"""3D Area puzzles (ADR-047 F, LAI-0812): parameter rules, graders, the solve route, stage order,
idempotent rewards, child scoping, and session pinning (LAI-0813)."""

import copy
import json

import pytest

from apps.catalog import authoring
from apps.catalog.tests.helpers import publish_edit
from apps.core.content_status import ContentStatus
from apps.game_sessions.models import PuzzleAttempt
from apps.inventory.models import GrantedRule
from apps.progression.models import WorldChange
from apps.regions import puzzles
from apps.regions.models import AreaPuzzle, PlacementKind, PuzzleKind, WorldObjectPlacement
from apps.regions.seeding import SeedContentInvalid, seed_puzzle

REGION = "treasure-rush-cove"

OBSERVE = {
    "intro": "Look through the telescope.",
    "features": [
        {"id": "crater", "label": "Crater", "explanation": "The bowl at the top."},
        {"id": "vent", "label": "Steam vent", "explanation": "A crack that lets out steam."},
    ],
    "hints": ["Turn the telescope slowly."],
}
PLATFORMS = {
    "intro": "Fill each gap with a stone that fits.",
    "stones": [
        {"id": "small", "label": "Small stone", "size": 1},
        {"id": "big", "label": "Big stone", "size": 3},
        {"id": "middle", "label": "Middle stone", "size": 2},
    ],
    "slots": [
        {"id": "gap-a", "label": "First gap", "gap": 2},
        {"id": "gap-b", "label": "Second gap", "gap": 3},
    ],
    "showOutlines": True,
}
VALVES = {
    "intro": "Send the steam out through the vent.",
    "channels": [
        {"id": "passage", "label": "Passage"},
        {"id": "pipe", "label": "Copper pipe"},
        {"id": "tank", "label": "Tank"},
        {"id": "vent", "label": "Sky vent"},
    ],
    "start": "passage",
    "goal": "vent",
    "valves": [
        {"id": "red", "label": "Red valve", "from": "passage", "to": "pipe"},
        {"id": "blue", "label": "Blue valve", "from": "pipe", "to": "tank"},
        {"id": "green", "label": "Green valve", "from": "tank", "to": "vent"},
    ],
    "hintAfterAttempts": 2,
    "hints": ["Follow the steam from the passage."],
}


class TestRules:
    @pytest.mark.parametrize(
        ("kind", "params"),
        [
            (PuzzleKind.OBSERVE_FEATURES, OBSERVE),
            (PuzzleKind.PLACE_PLATFORMS, PLATFORMS),
            (PuzzleKind.VALVE_SEQUENCE, VALVES),
            (PuzzleKind.COLLECT_OBJECT, {"intro": "Look.", "discoveryMessage": "Found it."}),
        ],
    )
    def test_valid_parameters_have_no_problems(self, kind, params):
        assert puzzles.RULES[kind].band_problems(params, "$") == []

    def test_an_unsolvable_platform_puzzle_is_refused(self):
        params = copy.deepcopy(PLATFORMS)
        params["slots"][0]["gap"] = 4
        assert any("cannot be solved" in p for p in puzzles._platform_problems(params, "$"))

    def test_an_unsolvable_valve_graph_is_refused(self):
        params = copy.deepcopy(VALVES)
        params["valves"][2]["to"] = "passage"
        assert any("no order" in p for p in puzzles._valve_problems(params, "$"))

    def test_unknown_settings_and_too_many_hints_are_refused(self):
        params = {**OBSERVE, "secret": 1, "hints": ["a", "b", "c", "d", "e"]}
        problems = puzzles._observe_problems(params, "$")
        assert any("unknown settings secret" in p for p in problems)
        assert any("at most 4" in p for p in problems)

    def test_observe_grading_needs_every_feature(self):
        grade = puzzles.RULES[PuzzleKind.OBSERVE_FEATURES].grade
        assert grade(OBSERVE, {"observed": ["vent", "crater"]}) is True
        assert grade(OBSERVE, {"observed": ["crater"]}) is False

    def test_platform_grading_matches_each_gap_size(self):
        grade = puzzles.RULES[PuzzleKind.PLACE_PLATFORMS].grade
        assert grade(PLATFORMS, {"placements": {"gap-a": "middle", "gap-b": "big"}}) is True
        assert grade(PLATFORMS, {"placements": {"gap-a": "big", "gap-b": "middle"}}) is False
        assert grade(PLATFORMS, {"placements": {"gap-a": "middle"}}) is False
        assert grade(PLATFORMS, {"placements": {"gap-a": "big", "gap-b": "big"}}) is False

    def test_valves_are_cause_and_effect_not_a_hidden_order(self):
        assert puzzles.solve_valves(VALVES) == ["red", "blue", "green"]
        # A valve whose channel has no steam does nothing, so extra turns are harmless.
        assert puzzles.simulate_valves(VALVES, ["green", "red", "blue", "green"]) == "vent"
        assert puzzles.simulate_valves(VALVES, ["blue", "red", "green"]) == "pipe"

    @pytest.mark.parametrize(
        ("kind", "submission"),
        [
            (PuzzleKind.OBSERVE_FEATURES, {"observed": "crater"}),
            (PuzzleKind.OBSERVE_FEATURES, {"observed": [], "extra": 1}),
            (PuzzleKind.PLACE_PLATFORMS, {"placements": {"gap-a": "nope"}}),
            (PuzzleKind.VALVE_SEQUENCE, {"sequence": ["purple"]}),
            (PuzzleKind.VALVE_SEQUENCE, "red,blue"),
            (PuzzleKind.COLLECT_OBJECT, {"anything": True}),
        ],
    )
    def test_malformed_submissions_are_invalid(self, kind, submission):
        params = {
            PuzzleKind.OBSERVE_FEATURES: OBSERVE,
            PuzzleKind.PLACE_PLATFORMS: PLATFORMS,
            PuzzleKind.VALVE_SEQUENCE: VALVES,
            PuzzleKind.COLLECT_OBJECT: {},
        }[kind]
        with pytest.raises(puzzles.InvalidSubmission):
            puzzles.grade(kind, params, submission)


def puzzle_body(puzzle_id, kind, change_key, params, *, requires=(), reward=None):
    return {
        "puzzleId": puzzle_id,
        "kind": kind,
        "title": puzzle_id.replace("-", " ").title(),
        "requiresChangeKeys": list(requires),
        "worldChangeKey": change_key,
        "rewardRuleId": reward,
        "ageBands": {"PATHFINDER": params},
    }


@pytest.fixture
def area(treasure):
    """Treasure Cove with two published puzzles: a telescope, then valves that need it first."""
    region = treasure.region
    for index, valve in enumerate(("red", "blue", "green")):
        WorldObjectPlacement.objects.create(
            region=region, entity_id=valve, kind=PlacementKind.PROP, x=index, z=-2
        )
    telescope, _ = seed_puzzle(
        region,
        puzzle_id="look",
        kind=PuzzleKind.OBSERVE_FEATURES,
        entity_ids=["cove-bridge-signpost"],
        body=puzzle_body("look", PuzzleKind.OBSERVE_FEATURES, "COVE_LOOKED", OBSERVE),
    )
    valves, _ = seed_puzzle(
        region,
        puzzle_id="valves",
        kind=PuzzleKind.VALVE_SEQUENCE,
        entity_ids=["red", "blue", "green"],
        body=puzzle_body(
            "valves",
            PuzzleKind.VALVE_SEQUENCE,
            "COVE_STEAM_REDIRECTED",
            VALVES,
            requires=["COVE_LOOKED"],
            reward="reward-treasure-rush-cove-chest",
        ),
        sort_order=1,
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return treasure, telescope, valves


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def session_for(client, child):
    response = post(client, f"{base(child)}regions/{REGION}/session/")
    assert response.status_code in (200, 201)
    return response.json()["sessionId"]


def solve(client, child, session, puzzle_id, submission):
    return post(
        client,
        f"{base(child)}sessions/{session}/puzzles/{puzzle_id}/solve/",
        {"submission": submission},
    )


@pytest.mark.postgres
@pytest.mark.django_db
class TestSolveRoute:
    def test_the_bootstrap_lists_band_parameters_and_state(self, area, api):
        treasure, _, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        body = client.get(f"{base(child)}regions/{REGION}/").json()
        states = {p["puzzleId"]: p for p in body["puzzles"]}
        assert states["look"]["parameters"] == OBSERVE
        assert states["look"]["locked"] is False and states["look"]["solved"] is False
        assert states["valves"]["locked"] is True
        assert states["valves"]["entityIds"] == ["red", "blue", "green"]

    def test_a_wrong_answer_is_recorded_and_changes_nothing(self, area, api):
        treasure, _, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        response = solve(client, child, session, "look", {"observed": ["crater"]})
        assert response.status_code == 200
        assert response.json()["correct"] is False and response.json()["failedAttempts"] == 1
        assert not WorldChange.objects.filter(child=child, change_key="COVE_LOOKED").exists()
        assert PuzzleAttempt.objects.get(child=child).correct is False

    def test_stage_order_is_enforced_by_the_server(self, area, api):
        treasure, _, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        locked = solve(client, child, session, "valves", {"sequence": ["red", "blue", "green"]})
        assert locked.status_code == 409
        assert locked.json()["error"]["code"] == "puzzle_locked"

        solved = solve(client, child, session, "look", {"observed": ["crater", "vent"]})
        assert solved.json()["correct"] is True and solved.json()["solvedNow"] is True
        valves = solve(client, child, session, "valves", {"sequence": ["red", "blue", "green"]})
        body = valves.json()
        assert body["correct"] is True and body["solvedNow"] is True
        assert [item["itemId"] for item in body["newItems"]] == ["golden-doubloon"]

    def test_solving_again_grants_nothing_twice(self, area, api):
        treasure, _, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        solve(client, child, session, "look", {"observed": ["crater", "vent"]})
        solve(client, child, session, "valves", {"sequence": ["red", "blue", "green"]})

        again = solve(client, child, session, "valves", {"sequence": ["red", "blue", "green"]})

        assert again.json()["alreadySolved"] is True and again.json()["newItems"] == []
        assert GrantedRule.objects.filter(child=child).count() == 1
        assert (
            WorldChange.objects.filter(child=child, change_key="COVE_STEAM_REDIRECTED").count() == 1
        )

    def test_a_malformed_submission_is_400_and_records_nothing(self, area, api):
        treasure, _, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        response = solve(client, child, session, "look", {"observed": "everything"})
        assert response.status_code == 400
        assert not PuzzleAttempt.objects.exists()
        extra = post(
            client,
            f"{base(child)}sessions/{session}/puzzles/look/solve/",
            {"submission": {"observed": []}, "solved": True},
        )
        assert extra.status_code == 400

    def test_another_childs_session_is_not_found(self, area, api):
        treasure, _, _ = area
        session = session_for(api(treasure.families.a), treasure.families.a1)
        intruder = api(treasure.families.b)
        response = solve(
            intruder, treasure.families.b1, session, "look", {"observed": ["crater", "vent"]}
        )
        assert response.status_code == 404
        sibling = solve(
            api(treasure.families.a), treasure.families.a2, session, "look", {"observed": []}
        )
        assert sibling.status_code == 404

    def test_a_draft_puzzle_and_an_unknown_one_are_not_found(self, area, api):
        treasure, telescope, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        AreaPuzzle.objects.filter(pk=telescope.pk).update(status=ContentStatus.DRAFT)
        assert solve(client, child, session, "look", {"observed": []}).status_code == 404
        assert solve(client, child, session, "nope", {"observed": []}).status_code == 404

    def test_a_publish_during_a_visit_keeps_the_visits_version(self, area, api):
        treasure, telescope, _ = area
        client, child = api(treasure.families.a), treasure.families.a1
        session = session_for(client, child)
        body = authoring.current_body(telescope)
        body["ageBands"]["PATHFINDER"]["features"].append(
            {"id": "lava", "label": "Lava", "explanation": "Melted rock."}
        )
        publish_edit(telescope, body)

        # This visit still needs only the two features it started with...
        visit = client.get(f"{base(child)}regions/{REGION}/").json()
        look = next(p for p in visit["puzzles"] if p["puzzleId"] == "look")
        assert [f["id"] for f in look["parameters"]["features"]] == ["crater", "vent"]
        assert solve(client, child, session, "look", {"observed": ["crater", "vent"]}).json()[
            "correct"
        ]
        attempt = PuzzleAttempt.objects.get(child=child)
        assert attempt.revision.number == 1

        # ...and a new visit by a sibling gets the published version.
        sibling = treasure.families.a2
        new = session_for(client, sibling)
        response = solve(client, sibling, new, "look", {"observed": ["crater", "vent"]})
        assert response.json()["correct"] is False


@pytest.mark.postgres
@pytest.mark.django_db
class TestAuthoring:
    def test_publishing_invalid_puzzle_parameters_is_refused(self, area):
        _, telescope, _ = area
        body = authoring.current_body(telescope)
        body["ageBands"]["PATHFINDER"]["features"] = []
        with pytest.raises(authoring.PublishRefused, match="features"):
            publish_edit(telescope, body)

    def test_the_mechanic_and_a_shared_change_key_cannot_change(self, area):
        _, telescope, _ = area
        body = {**authoring.current_body(telescope), "kind": PuzzleKind.VALVE_SEQUENCE}
        assert any("must stay" in p for p in authoring.validate(telescope, body))
        body = {**authoring.current_body(telescope), "worldChangeKey": "COVE_STEAM_REDIRECTED"}
        assert any("already recorded" in p for p in authoring.validate(telescope, body))

    def test_a_seed_with_invalid_content_is_refused(self, treasure):
        with pytest.raises(SeedContentInvalid):
            seed_puzzle(
                treasure.region,
                puzzle_id="bad",
                kind=PuzzleKind.OBSERVE_FEATURES,
                entity_ids=[],
                body=puzzle_body("bad", PuzzleKind.OBSERVE_FEATURES, "BAD", {"intro": ""}),
            )
        assert not AreaPuzzle.objects.filter(puzzle_id="bad").exists()
