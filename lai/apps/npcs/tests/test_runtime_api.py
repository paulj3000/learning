"""Runtime read API (LAI-NPC-007, contract section 5.1): scope, age bands, spawn conditions,
variant resolution, server-only keys, authorization (bearer and game cookie)."""

import json

import pytest
from django.db import connection
from django.test import Client
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.npcs.publishing import publish, retire
from apps.progression.models import WorldChange

from .helpers import (
    make_behavior,
    make_character,
    make_dialogue,
    make_place,
    make_placement,
    make_staff,
    make_variant,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
COOKIE = "lai_game_session"
SERVER_ONLY = ("persona", "dialogues", "spawnConditions", "availability", "isDefault", "island")


@pytest.fixture
def staff():
    return make_staff()


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def code(response) -> str:
    return response.json()["error"]["code"]


def place_url(child, place="test-bay") -> str:
    return f"{base(child)}places/{place}/npcs/"


def area_url(child, region=REGION) -> str:
    return f"{base(child)}regions/{region}/npcs/"


def all_keys(value) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, inner in value.items():
            found.add(key)
            found |= all_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            found |= all_keys(inner)
    return found


@pytest.fixture
def parent_a(families, api):
    return api(families.a)


# --- catalog and Place scope ---------------------------------------------------------------------


def test_catalog_lists_characters_for_the_childs_age_band(families, parent_a, staff):
    make_character("for-everyone")
    make_character("pathfinders", age_bands=["PATHFINDER"])
    make_character("sprouts-only", age_bands=["SPROUT"])
    release = publish(staff)
    response = parent_a.get(f"{base(families.a1)}npcs/")
    assert response.status_code == 200
    body = response.json()
    assert body["contractVersion"] == 1 and body["release"] == release.number
    assert [c["npcId"] for c in body["characters"]] == ["for-everyone", "pathfinders"]


def test_place_route_serves_only_place_level_placements_with_resolved_fields(
    families, parent_a, staff
):
    pip = make_character("pip-test")
    make_dialogue(pip)
    make_variant(pip, "festive")
    make_placement(
        pip,
        "dock",
        behavior=make_behavior("look-around", facePlayer=True),
        x=3.0,
        z=6.0,
        rotation_y=1.5,
        interaction_radius=2.5,
        spawn_conditions=[{"type": "ALWAYS"}],
    )
    make_character("unplaced")
    release = publish(staff)

    response = parent_a.get(place_url(families.a1))
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["contractVersion"] == 1 and body["release"] == release.number
    assert body["scope"] == {"place": "test-bay", "area": None}
    assert set(body["characters"]) == {"pip-test"}  # exactly those placed
    [placement] = body["placements"]
    assert placement == {
        "placementKey": "dock",
        "npcId": "pip-test",
        "variant": "classic",
        "behavior": {
            "key": "look-around",
            "type": "stationary",
            "parameters": placement["behavior"]["parameters"],
        },
        "position": {"x": 3.0, "y": 0.0, "z": 6.0},
        "rotationY": 1.5,
        "scale": 1.0,
        "interactionRadius": 2.5,
    }
    assert placement["behavior"]["parameters"]["facePlayer"] is True
    assert [v["variantKey"] for v in body["characters"]["pip-test"]["variants"]] == [
        "classic",
        "festive",
    ]
    assert not all_keys(body) & set(SERVER_ONLY)


def test_no_behavior_is_null(families, parent_a, staff):
    make_placement(make_character())
    publish(staff)
    [placement] = parent_a.get(place_url(families.a1)).json()["placements"]
    assert placement["behavior"] is None


def test_place_route_excludes_ineligible_characters(families, parent_a, staff):
    make_placement(make_character("sprout-npc", age_bands=["SPROUT"]), "a")
    make_placement(make_character("explorer-npc", age_bands=["EXPLORER", "PATHFINDER"]), "b")
    publish(staff)
    body = parent_a.get(place_url(families.a1)).json()
    assert [p["npcId"] for p in body["placements"]] == ["explorer-npc"]
    assert set(body["characters"]) == {"explorer-npc"}


def test_spawn_conditions_follow_world_changes(families, parent_a, staff):
    child = families.a1
    make_placement(
        make_character("after-bridge"),
        "after",
        spawn_conditions=[{"type": "WORLD_CHANGE", "key": "BRIDGE_FIXED"}],
    )
    make_placement(
        make_character("before-bridge"),
        "before",
        spawn_conditions=[{"type": "WORLD_CHANGE", "key": "BRIDGE_FIXED", "present": False}],
    )
    publish(staff)
    before = parent_a.get(place_url(child)).json()
    assert [p["npcId"] for p in before["placements"]] == ["before-bridge"]

    WorldChange.objects.create(
        child=child,
        location_slug="test-bay",
        change_type="REPAIR",
        change_key="BRIDGE_FIXED",
        created_at=timezone.now(),
    )
    after = parent_a.get(place_url(child)).json()
    assert [p["npcId"] for p in after["placements"]] == ["after-bridge"]
    assert set(after["characters"]) == {"after-bridge"}
    # Another child of the same family is unaffected.
    other = parent_a.get(place_url(families.a2)).json()
    assert [p["npcId"] for p in other["placements"]] == ["before-bridge"]


def test_variant_resolution_falls_back_by_availability(families, parent_a, staff):
    child = families.a1
    locked = [{"type": "AGE_BAND", "in": ["EXPLORER"]}]
    character = make_character("dresser")  # "classic" is the default, always available
    festive = make_variant(character, "festive", availability=locked)
    autumn = make_variant(character, "autumn", sort_order=1)
    make_placement(character, "wants-locked", variant=festive)
    make_placement(character, "wants-autumn", variant=autumn)
    make_placement(character, "wants-nothing")
    # A character whose every variant is locked still shows its default.
    picky = make_character("picky", with_variant=False)
    make_variant(picky, "only", is_default=True, availability=locked)
    make_placement(picky, "picky-spot")
    publish(staff)
    by_key = {
        p["placementKey"]: p["variant"] for p in parent_a.get(place_url(child)).json()["placements"]
    }
    assert by_key == {
        "wants-locked": "classic",
        "wants-autumn": "autumn",
        "wants-nothing": "classic",
        "picky-spot": "only",
    }


def test_condition_context_is_read_once_per_request(families, parent_a, staff):
    for index in range(6):
        make_placement(
            make_character(f"npc-{index}"),
            f"spot-{index}",
            spawn_conditions=[{"type": "RETURN_VISIT"}, {"type": "WORLD_CHANGE", "key": "X"}],
        )
    publish(staff)
    parent_a.get(place_url(families.a1))  # warm the release cache
    with CaptureQueriesContext(connection) as few:
        parent_a.get(place_url(families.a1))
    assert len(few.captured_queries) < 15


def test_drafts_are_never_served(families, parent_a, staff):
    character = make_character("pip-test")
    placement = make_placement(character, x=1.0)
    publish(staff)
    first = parent_a.get(place_url(families.a1)).json()
    character.definition.display_name = "Draft Name"
    character.definition.save()
    placement.x = 99.0
    placement.save()
    make_placement(make_character("draft-newcomer"), "new")
    assert parent_a.get(place_url(families.a1)).json() == first


def _assert_empty_reads(client, child):
    """No ACTIVE release: the reads are an ordinary empty catalog and scene (QA finding F-A)."""
    catalog = client.get(f"{base(child)}npcs/")
    assert catalog.status_code == 200
    assert catalog.json() == {"contractVersion": 1, "release": 0, "characters": []}
    scene = client.get(place_url(child))
    assert scene.status_code == 200
    body = scene.json()
    assert body["release"] == 0 and body["characters"] == {} and body["placements"] == []
    assert body["scope"]["area"] is None


def test_no_active_release_and_retired_release_are_empty_200(families, parent_a, staff):
    child = families.a1
    make_place()
    _assert_empty_reads(parent_a, child)
    make_placement(make_character())
    release = publish(staff)
    assert parent_a.get(place_url(child)).json()["release"] == release.number
    retire(release, staff)
    _assert_empty_reads(parent_a, child)


def test_no_active_release_still_scopes_child_and_place(families, parent_a):
    make_place()
    assert parent_a.get(place_url(families.b1)).status_code == 404  # another family's child
    response = parent_a.get(place_url(families.a1, "nowhere"))
    assert response.status_code == 404 and code(response) == "place_not_found"


def test_unknown_place_is_404(families, parent_a, staff):
    make_placement(make_character())
    publish(staff)
    response = parent_a.get(place_url(families.a1, "nowhere"))
    assert response.status_code == 404 and code(response) == "place_not_found"


# --- authorization -------------------------------------------------------------------------------


def test_routes_are_child_scoped(families, api, parent_a, staff):
    make_placement(make_character())
    publish(staff)
    for url in (f"{base(families.b1)}npcs/", place_url(families.b1)):
        assert parent_a.get(url).status_code == 404  # another family's child
        assert api().get(url).status_code == 401  # nobody signed in
    assert api(families.b).get(place_url(families.b1)).status_code == 200


# --- 3D Area scope and the game cookie -----------------------------------------------------------


def open_runtime(parent_client, child, region=REGION) -> Client:
    ticket = parent_client.post(
        f"{base(child)}game-launches/",
        json.dumps({"regionId": region}),
        content_type="application/json",
    ).json()["ticket"]
    redeemed = parent_client.post(
        "/api/v1/game-launches/redeem/",
        json.dumps({"ticket": ticket}),
        content_type="application/json",
    )
    assert redeemed.status_code == 201, redeemed.json()
    runtime = Client(raise_request_exception=False)
    runtime.cookies[COOKIE] = redeemed.cookies[COOKIE].value
    return runtime


@pytest.fixture
def cove(treasure, staff):
    """One NPC in Treasure Cove's 3D Area and one at Place level of the same Place."""
    in_area = make_character("cove-npc")
    make_placement(in_area, "cove-spot", region=treasure.region)
    place_level = make_character("bay-npc")
    from apps.npcs.models import NpcPlacement

    NpcPlacement.objects.create(
        character=place_level,
        placement_key="bay-spot",
        world=treasure.region.location.world,
        location=treasure.region.location,
    )
    publish(staff)
    return treasure


def test_area_and_place_routes_split_by_scope(cove, api):
    child = cove.families.a1
    parent = api(cove.families.a)
    place = cove.region.location.slug
    area = parent.get(area_url(child)).json()
    assert area["scope"] == {"place": place, "area": REGION}
    assert [p["placementKey"] for p in area["placements"]] == ["cove-spot"]
    assert set(area["characters"]) == {"cove-npc"}
    at_place = parent.get(place_url(child, place)).json()
    assert [p["placementKey"] for p in at_place["placements"]] == ["bay-spot"]
    assert set(at_place["characters"]) == {"bay-npc"}


def test_game_cookie_reaches_only_its_own_area(cove, api):
    from apps.catalog.models import Location
    from apps.core.content_status import ContentStatus
    from apps.regions.models import WorldRegion

    child = cove.families.a1
    parent = api(cove.families.a)
    WorldRegion.objects.create(
        region_id="second-cove",
        location=Location.objects.get(slug="wonderwild-forest"),
        title="Second Cove",
        status=ContentStatus.PUBLISHED,
    )
    runtime = open_runtime(parent, child)
    own = runtime.get(area_url(child))
    assert own.status_code == 200
    assert [p["placementKey"] for p in own.json()["placements"]] == ["cove-spot"]
    assert runtime.get(area_url(child, "second-cove")).status_code == 404
    assert parent.get(area_url(child, "second-cove")).status_code == 200  # bearer can
    # Place routes do not accept the game cookie at all, so it does not authenticate there.
    assert runtime.get(place_url(child, cove.region.location.slug)).status_code in (401, 403)
    assert runtime.get(f"{base(child)}npcs/").status_code in (401, 403)  # bearer-only
    assert runtime.get(area_url(cove.families.a2)).status_code == 404  # its own child only


def test_unknown_area_is_404(cove, api):
    response = api(cove.families.a).get(area_url(cove.families.a1, "no-such-area"))
    assert response.status_code == 404 and code(response) == "area_not_found"
