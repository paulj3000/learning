"""Ownership and security of the Heart of Firepeak routes (docs/firepeak/HEART_OF_FIREPEAK_DESIGN.md).

Builds its own minimal published `firepeak-heart` 3D Area so it does not depend on the seed.
Covers: another family's child (404), the Sprouts band (not visible), staff-only admin for
puzzle publishing, and a solve endpoint that never trusts client-provided correctness.
"""

import json

import pytest
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.models import Location
from apps.core.content_status import ContentStatus
from apps.regions.models import AreaPuzzle, PlacementKind, PuzzleKind, WorldObjectPlacement, WorldRegion
from apps.regions.seeding import seed_puzzle
from apps.users import services
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "firepeak-heart"
PICKUP = "fh-test-ember"
OBSERVE = {
    "features": [
        {"id": "crater", "label": "Crater", "explanation": "The bowl."},
        {"id": "vent", "label": "Vent", "explanation": "Steam."},
    ],
    "hints": ["Look slowly."],
}


@pytest.fixture
def heart(families):
    import_content()
    region = WorldRegion.objects.create(
        region_id=REGION,
        location=Location.objects.get(slug="firepeak-heart"),
        title="Heart of Firepeak",
        status=ContentStatus.PUBLISHED,
        age_bands=["PATHFINDER", "EXPLORER"],
    )
    WorldObjectPlacement.objects.create(
        region=region,
        entity_id=PICKUP,
        kind=PlacementKind.COLLECTIBLE,
        pickup_change_key="FH_TEST_EMBER",
        x=1,
        z=1,
    )
    WorldObjectPlacement.objects.create(
        region=region, entity_id="fh-test-rock", kind=PlacementKind.PROP, x=2, z=2
    )
    seed_puzzle(
        region,
        puzzle_id="fh-test-look",
        kind=PuzzleKind.OBSERVE_FEATURES,
        entity_ids=["fh-test-rock"],
        body={
            "puzzleId": "fh-test-look",
            "kind": PuzzleKind.OBSERVE_FEATURES,
            "title": "Look",
            "requiresChangeKeys": [],
            "worldChangeKey": "FH_TEST_LOOKED",
            "rewardRuleId": None,
            "ageBands": {"PATHFINDER": OBSERVE, "EXPLORER": OBSERVE},
        },
    )
    AreaPuzzle.objects.update(status=ContentStatus.PUBLISHED)
    return families


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def start(client, child):
    response = post(client, f"{base(child)}regions/{REGION}/session/")
    assert response.status_code in (200, 201), response.content
    return response.json()["sessionId"]


def solve_url(child, session):
    return f"{base(child)}sessions/{session}/puzzles/fh-test-look/solve/"


def test_the_owner_can_open_and_start(heart, api):
    client, child = api(heart.a), heart.a1
    assert client.get(f"{base(child)}regions/{REGION}/").status_code == 200
    assert start(client, child)


def test_another_familys_child_gets_404_everywhere(heart, api):
    session = start(api(heart.a), heart.a1)
    intruder, theirs = api(heart.b), heart.a1  # family B's token against family A's child
    assert intruder.get(f"{base(theirs)}regions/{REGION}/").status_code == 404
    assert post(intruder, f"{base(theirs)}regions/{REGION}/session/").status_code == 404
    submission = {"submission": {"observed": ["crater", "vent"]}}
    assert post(intruder, solve_url(theirs, session), submission).status_code == 404
    pickup = f"{base(theirs)}sessions/{session}/pickups/{PICKUP}/"
    assert post(intruder, pickup).status_code == 404
    # Own child, someone else's session id.
    assert post(intruder, solve_url(heart.b1, session), submission).status_code == 404
    assert post(intruder, f"{base(heart.b1)}sessions/{session}/pickups/{PICKUP}/").status_code == 404


def test_anonymous_requests_are_refused(heart, api):
    anon = Client(raise_request_exception=False)
    assert anon.get(f"{base(heart.a1)}regions/{REGION}/").status_code in (401, 403)


def test_a_sprouts_child_cannot_open_the_area(heart, api):
    sprout = services.create_child_profile(
        heart.a,
        nickname="Sprout-S1",
        age_band="SPROUT",
        avatar_key="FOX",
        reading_mode="READ_ALONG",
        interests=[],
    )
    client = api(heart.a)
    assert client.get(f"{base(sprout)}regions/{REGION}/").status_code == 404
    assert post(client, f"{base(sprout)}regions/{REGION}/session/").status_code == 404
    body = client.get(f"{base(sprout)}islands/").json()
    areas = [p["area"] for i in body["islands"] for p in i["places"] if p["area"]]
    assert all(a["regionId"] != REGION for a in areas)


def test_the_client_cannot_assert_correctness(heart, api):
    client, child = api(heart.a), heart.a1
    session = start(client, child)
    top = post(client, solve_url(child, session), {"correct": True})
    assert top.status_code == 400
    nested = post(client, solve_url(child, session), {"submission": {"correct": True}})
    assert nested.status_code == 400
    assert "invalid_submission" in nested.content.decode()
    mixed = post(client, solve_url(child, session), {"submission": {"observed": []}, "correct": True})
    assert mixed.status_code == 400
    # A wrong but well-formed answer is graded by the server, not credited.
    wrong = post(client, solve_url(child, session), {"submission": {"observed": ["crater"]}})
    assert wrong.status_code == 200 and wrong.json()["correct"] is False


def test_puzzle_publishing_in_admin_is_staff_only(heart):
    puzzle = AreaPuzzle.objects.get()
    AreaPuzzle.objects.filter(pk=puzzle.pk).update(status=ContentStatus.DRAFT)
    anon = Client(raise_request_exception=False)
    assert anon.get("/admin/regions/areapuzzle/").status_code == 302
    parent = Client(raise_request_exception=False)
    account = ParentAccount.objects.get(cognito_sub="sub-family-a")
    assert not account.is_staff
    parent.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    for client in (anon, parent):
        response = client.post(
            "/admin/regions/areapuzzle/",
            {"action": "publish_puzzles", "_selected_action": [puzzle.pk]},
        )
        assert response.status_code in (302, 403)
        assert "/admin/login" in response.get("Location", "/admin/login") or response.status_code == 403
    puzzle.refresh_from_db()
    assert puzzle.status == ContentStatus.DRAFT
