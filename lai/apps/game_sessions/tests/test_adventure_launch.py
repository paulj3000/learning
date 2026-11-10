"""Launching a Place's Adventure from an object in its 3D Area, and Island > Place discovery
(ADR-041). End to end through HTTP with locally signed tokens; the families' children are
Pathfinders, so the signpost offers them "Repair the Moonlight Bridge".
"""

import json
import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Adventure, Location, Quest, World
from apps.core.content_status import ContentStatus
from apps.game_sessions import services
from apps.game_sessions.models import AdventureSession, SessionKind, SessionStatus
from apps.regions.models import AdventureLaunchPoint, LaunchObjectKind, WorldRegion
from apps.regions.treasure_rush_seed import SIGNPOST_ID
from apps.progression.models import WorldChange
from apps.users.models import ChildProfile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
BRIDGE = "repair-the-moonlight-bridge"
LAUNCH = f"signpost-{BRIDGE}"


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def start(client, child, launch=LAUNCH, region=REGION):
    return post(client, f"{base(child)}regions/{region}/launch-points/{launch}/start/")


@pytest.fixture
def a(treasure, api):
    return api(treasure.families.a), treasure.families.a1


# --- the region bootstrap names the launch objects ------------------------------------------------


def test_the_bootstrap_lists_only_the_launch_points_for_the_childs_age_band(a):
    client, child = a
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    [entry] = body["launchPoints"]
    assert entry == {
        "launchId": LAUNCH,
        "entityId": SIGNPOST_ID,
        "objectKind": "SIGN",
        "label": "Help Pip repair the Moonlight Bridge",
        "prompt": "The sign points to the broken bridge.",
        "adventure": {
            "adventureId": BRIDGE,
            "title": Adventure.objects.get(slug=BRIDGE).title,
            "placeSlug": "pirate-builder-bay",
        },
    }
    assert SIGNPOST_ID in {o["entityId"] for o in body["objects"]}


def test_other_age_bands_see_their_own_bridge_adventure(a):
    client, child = a
    ChildProfile.objects.filter(pk=child.pk).update(age_band="SPROUT", session_minutes=6)
    [entry] = client.get(f"{base(child)}regions/{REGION}/").json()["launchPoints"]
    assert entry["adventure"]["adventureId"] == "three-planks-for-the-bridge"


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_unpublished_launch_points_are_not_offered_or_startable(a, status):
    client, child = a
    AdventureLaunchPoint.objects.update(status=status)
    assert client.get(f"{base(child)}regions/{REGION}/").json()["launchPoints"] == []
    assert start(client, child).status_code == 404


def test_the_existing_bootstrap_contract_is_unchanged_apart_from_the_new_key(a):
    """Additive keys only: `launchPoints` (ADR-041), `puzzles`, `catalog` and each NPC's
    `dialogue` (ADR-047, LAI-0812, FP-2)."""
    client, child = a
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert set(body) == {
        "puzzles",
        "catalog",
        "region",
        "spawn",
        "npcs",
        "objects",
        "chests",
        "quests",
        "session",
        "worldChanges",
        "launchPoints",
    }
    assert set(body["region"]) == {"regionId", "title", "locationSlug", "version", "scene"}


def test_the_regions_list_contract_is_unchanged(a):
    client, child = a
    [region] = client.get(f"{base(child)}regions/").json()["regions"]
    assert set(region) == {
        "regionId",
        "title",
        "description",
        "world",
        "location",
        "ageBands",
        "available",
        "lockedReason",
        "status",
        "chestsTotal",
        "chestsOpened",
        "thumbnailAssetId",
        "prerequisites",
        "resume",
        "lastPlayedAt",
    }


# --- starting the Adventure through the object ----------------------------------------------------


def test_the_object_starts_the_places_adventure_through_the_existing_session_service(a):
    client, child = a
    response = start(client, child)
    assert response.status_code == 201
    body = response.json()
    assert body["adventureId"] == BRIDGE and body["placeSlug"] == "pirate-builder-bay"
    assert body["returnTo"] == {"regionId": REGION} and body["regionId"] == REGION
    session = AdventureSession.objects.get(pk=body["session"]["id"])
    assert session.child_id == child.pk and session.kind == SessionKind.ADVENTURE
    assert session.adventure.slug == BRIDGE and session.status == SessionStatus.ACTIVE
    assert body["session"]["currentStepId"] == session.adventure.entry_step_id
    again = start(client, child)
    assert again.status_code == 200 and again.json()["session"]["id"] == body["session"]["id"]


def test_after_completion_the_child_returns_and_can_start_again(a):
    client, child = a
    first = start(client, child).json()
    services.complete_session(child, first["session"]["id"])
    assert first["returnTo"] == {"regionId": REGION}
    # Back in the 3D Area: the bootstrap still offers the object, and a new session starts.
    assert client.get(f"{base(child)}regions/{REGION}/").json()["launchPoints"]
    again = start(client, child)
    assert again.status_code == 201 and again.json()["session"]["id"] != first["session"]["id"]


def test_an_adventure_for_another_age_band_cannot_be_started(a):
    client, child = a
    response = start(client, child, launch="signpost-the-tide-gate-calculation")  # Explorer only
    assert response.status_code == 409 and response.json()["error"]["code"] == "content_unavailable"
    assert not AdventureSession.objects.filter(child=child).exists()


def test_an_inactive_adventure_or_place_cannot_be_started(a):
    client, child = a
    Adventure.objects.filter(slug=BRIDGE).update(active=False)
    assert start(client, child).status_code == 409
    Adventure.objects.filter(slug=BRIDGE).update(active=True)
    Location.objects.filter(slug="pirate-builder-bay").update(active=False)
    assert start(client, child).status_code == 404  # the 3D Area is no longer visible


def test_a_cross_place_launch_point_is_refused_even_if_it_reached_the_database(a):
    client, child = a
    forest_adventure = Adventure.objects.filter(
        location__slug="wonderwild-forest", age_bands__contains=["PATHFINDER"]
    ).first()
    # Bypasses `clean()` on purpose: the endpoint must not trust stored rows either.
    AdventureLaunchPoint.objects.create(
        region=WorldRegion.objects.get(region_id=REGION),
        launch_id="smuggled",
        entity_id=SIGNPOST_ID,
        object_kind=LaunchObjectKind.SIGN,
        adventure=forest_adventure,
        label="Go",
        status=ContentStatus.PUBLISHED,
    )
    assert "smuggled" not in {
        p["launchId"] for p in client.get(f"{base(child)}regions/{REGION}/").json()["launchPoints"]
    }
    assert start(client, child, launch="smuggled").status_code == 409
    assert not AdventureSession.objects.filter(child=child).exists()


def test_a_launch_point_of_another_3d_area_is_not_found(a):
    client, child = a
    forest = Location.objects.get(slug="wonderwild-forest")
    WorldRegion.objects.create(
        region_id="forest-area", location=forest, title="Forest", status=ContentStatus.PUBLISHED
    )
    assert start(client, child, region="forest-area").status_code == 404
    assert start(client, child, launch="no-such-point").status_code == 404


def test_the_body_is_closed(a):
    client, child = a
    url = f"{base(child)}regions/{REGION}/launch-points/{LAUNCH}/start/"
    assert post(client, url, {"adventureId": "the-tide-gate-calculation"}).status_code == 400
    assert post(client, url, {"childId": str(uuid.uuid4())}).status_code == 400


# --- child authorization --------------------------------------------------------------------------


def test_launching_is_child_scoped(treasure, api):
    families = treasure.families
    client = api(families.a)
    foreign = start(client, families.b1)
    unknown = post(
        client, f"/api/v1/children/{uuid.uuid4()}/regions/{REGION}/launch-points/{LAUNCH}/start/"
    )
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]
    assert start(api(), families.a1).status_code == 401
    assert start(api("sub-never-onboarded"), families.a1).status_code == 403
    assert start(client, families.a2).status_code == 201  # the parent's other child
    assert not AdventureSession.objects.filter(child=families.b1).exists()


def test_the_game_runtime_cookie_cannot_launch_adventures(treasure, api):
    from apps.game_sessions.tests.test_game_launch import open_runtime

    families = treasure.families
    runtime = open_runtime(api(families.a), families.a1)
    url = f"{base(families.a1)}regions/{REGION}/launch-points/{LAUNCH}/start/"
    assert runtime.post(url).status_code == 401


def test_an_inactive_child_cannot_be_started_through_unpublished_areas(a):
    client, child = a
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.DRAFT)
    assert start(client, child).status_code == 404


# --- Island > Place > 3D Area ---------------------------------------------------------------------


def test_islands_list_places_with_and_without_a_3d_area(a):
    client, child = a
    body = client.get(f"{base(child)}islands/").json()
    islands = {i["islandId"]: i for i in body["islands"]}
    assert "learning-adventure-island" in islands
    places = {p["placeId"]: p for p in islands["learning-adventure-island"]["places"]}
    assert places["pirate-builder-bay"]["area"]["regionId"] == REGION
    assert places["wonderwild-forest"]["area"] is None  # valid without a 3D Area
    assert places["wonderwild-forest"]["adventureCount"] >= 1


def test_one_island_is_selected_automatically(a):
    client, child = a
    World.objects.exclude(slug="learning-adventure-island").update(active=False)
    body = client.get(f"{base(child)}islands/").json()
    assert body["autoSelectIslandId"] == "learning-adventure-island"
    World.objects.update(active=True)
    if World.objects.count() > 1:
        assert client.get(f"{base(child)}islands/").json()["autoSelectIslandId"] is None


def test_inactive_islands_places_and_unpublished_areas_are_hidden(a):
    client, child = a
    Location.objects.filter(slug="wonderwild-forest").update(active=False)
    WorldRegion.objects.filter(region_id=REGION).update(status=ContentStatus.DRAFT)
    body = client.get(f"{base(child)}islands/").json()
    island = next(i for i in body["islands"] if i["islandId"] == "learning-adventure-island")
    places = {p["placeId"]: p for p in island["places"]}
    assert "wonderwild-forest" not in places
    assert places["pirate-builder-bay"]["area"] is None
    World.objects.filter(slug="learning-adventure-island").update(active=False)
    ids = {i["islandId"] for i in client.get(f"{base(child)}islands/").json()["islands"]}
    assert "learning-adventure-island" not in ids


def test_islands_carry_discovery_details(a):
    """AP-03: age bands, subjects, lock status and progress for each Island."""
    client, child = a
    islands = {i["islandId"]: i for i in client.get(f"{base(child)}islands/").json()["islands"]}
    home = islands["learning-adventure-island"]
    assert child.age_band in home["ageBands"]
    assert "Counting" in home["subjects"] and len(home["subjects"]) <= 6
    assert len(home["subjects"]) == len(set(home["subjects"]))
    assert home["thumbnailAssetId"] is None
    assert home["unlocked"] is True and home["lockedHint"] is None
    assert home["progress"] == {"placesExplored": 0, "placesTotal": len(home["places"])}
    assert all(place["explored"] is False for place in home["places"])
    # Storykeeper Castle is a Place; Treasure Cove is Pirate Builder Bay's 3D Area.
    places = {p["placeId"]: p for p in home["places"]}
    assert "storykeeper-castle" in places
    assert places["pirate-builder-bay"]["area"]["title"] == "Treasure Cove"


def test_an_island_opens_once_its_travel_world_change_exists(a):
    client, child = a
    cove = next(
        i
        for i in client.get(f"{base(child)}islands/").json()["islands"]
        if i["islandId"] == "creature-care-cove"
    )
    assert cove["unlocked"] is False
    assert "Pip" in cove["lockedHint"]
    WorldChange.objects.create(
        child=child,
        location_slug="pirate-builder-bay",
        change_type="REPAIR",
        change_key="BRIDGE_REPAIRED",
        created_at=timezone.now(),
    )
    cove = next(
        i
        for i in client.get(f"{base(child)}islands/").json()["islands"]
        if i["islandId"] == "creature-care-cove"
    )
    assert cove["unlocked"] is True and cove["lockedHint"] is None


def test_another_childs_world_change_does_not_open_an_island(a, treasure):
    client, child = a
    WorldChange.objects.create(
        child=treasure.families.b1,
        location_slug="pirate-builder-bay",
        change_type="REPAIR",
        change_key="BRIDGE_REPAIRED",
        created_at=timezone.now(),
    )
    cove = next(
        i
        for i in client.get(f"{base(child)}islands/").json()["islands"]
        if i["islandId"] == "creature-care-cove"
    )
    assert cove["unlocked"] is False


def test_a_secret_place_is_hidden_until_its_world_change_exists(a):
    client, child = a

    def home_places():
        islands = client.get(f"{base(child)}islands/").json()["islands"]
        home = next(i for i in islands if i["islandId"] == "learning-adventure-island")
        return {p["placeId"] for p in home["places"]}

    assert "castle-writing-room" not in home_places()
    WorldChange.objects.create(
        child=child,
        location_slug="storykeeper-castle",
        change_type="UNLOCK",
        change_key="THE_CASTLES_SECRET_DOOR_COMPLETE",
        created_at=timezone.now(),
    )
    assert "castle-writing-room" in home_places()


def test_entering_a_3d_area_marks_its_place_explored(a):
    client, child = a
    post(client, f"{base(child)}regions/{REGION}/session/")
    home = next(
        i
        for i in client.get(f"{base(child)}islands/").json()["islands"]
        if i["islandId"] == "learning-adventure-island"
    )
    places = {p["placeId"]: p for p in home["places"]}
    assert places["pirate-builder-bay"]["explored"] is True
    assert places["wonderwild-forest"]["explored"] is False
    assert home["progress"]["placesExplored"] == 1


def test_starting_a_place_adventure_marks_its_place_explored(a):
    client, child = a
    assert start(client, child).status_code in (200, 201)
    home = next(
        i
        for i in client.get(f"{base(child)}islands/").json()["islands"]
        if i["islandId"] == "learning-adventure-island"
    )
    places = {p["placeId"]: p for p in home["places"]}
    assert places["pirate-builder-bay"]["explored"] is True


def test_islands_are_child_scoped(treasure, api):
    families = treasure.families
    assert api(families.a).get(f"{base(families.b1)}islands/").status_code == 404
    assert api().get(f"{base(families.a1)}islands/").status_code == 401


# --- quests stay Island-owned ---------------------------------------------------------------------


def test_quests_stay_island_owned_and_are_still_offered_in_the_3d_area(a, treasure):
    client, child = a
    quest = Quest.objects.get(slug=treasure.quest.slug)
    # Ownership is the Island (`world`); there is no Place or 3D Area owner field.
    assert Quest._meta.get_field("world").related_model is World
    assert not {"location", "region"} & {f.name for f in Quest._meta.get_fields()}
    # Island-owned quests can span Places: some quests' adventures sit in several Places.
    spans = [
        q
        for q in Quest.objects.exclude(world=None)
        if len({a.location_id for a in q.adventures.all()}) > 1
    ]
    assert all(q.world_id for q in spans)
    # Known export gap: no Island's content pack lists the Treasure Rush quest yet.
    assert quest.world_id is None
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert [q["questId"] for q in body["quests"]] == [quest.slug]
    assert post(client, f"{base(child)}quests/{quest.slug}/accept/").status_code == 201
