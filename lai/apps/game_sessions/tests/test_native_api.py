"""Native discovery, home, progress and inventory reads (LAI-ANDROID-API-001).

Built on the real content export and the Treasure Cove seed (`treasure` fixture): the families'
children are Pathfinders.
"""

import json
import uuid

import pytest
from django.utils import timezone

from apps.catalog.models import Adventure, ContentRelease, Location, World
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.game_sessions.models import AdventureSession, ChallengeAttempt, SessionStatus
from apps.regions.models import WorldRegion
from apps.users.models import ChildProfile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


@pytest.fixture
def a(treasure, api):
    return api(treasure.families.a), treasure.families.a1


def open_chest(client, child):
    session_id = post(client, f"{base(child)}regions/{REGION}/session/").json()["sessionId"]
    issued = post(client, f"{base(child)}sessions/{session_id}/chests/cove-chest/challenge/").json()
    answer = ChallengeAttempt.objects.get(pk=issued["attemptId"]).answer
    url = f"{base(child)}attempts/{issued['attemptId']}/answer/"
    response = post(client, url, {"answer": answer})
    assert response.json()["chestOpened"] is True
    return session_id


# --- regions ----------------------------------------------------------------------------------


def test_regions_lists_published_regions_with_their_hierarchy(a):
    client, child = a
    [region] = client.get(f"{base(child)}regions/").json()["regions"]
    assert region["regionId"] == REGION and region["title"] == "Treasure Cove"
    assert region["location"]["slug"] == "pirate-builder-bay"
    assert region["world"]["slug"] == "learning-adventure-island"
    assert region["available"] is True and region["status"] == "NOT_STARTED"
    assert region["chestsTotal"] == 1 and region["chestsOpened"] == 0
    assert region["resume"] is None and region["thumbnailAssetId"] is None


@pytest.mark.parametrize("status", [ContentStatus.DRAFT, ContentStatus.RETIRED])
def test_unpublished_regions_are_never_listed_or_reachable(a, status):
    client, child = a
    WorldRegion.objects.filter(region_id=REGION).update(status=status)
    assert client.get(f"{base(child)}regions/").json() == {"regions": []}
    assert client.get(f"{base(child)}regions/{REGION}/adventures/").status_code == 404


def test_inactive_location_or_world_hides_the_region(a):
    client, child = a
    Location.objects.filter(slug="pirate-builder-bay").update(active=False)
    assert client.get(f"{base(child)}regions/").json() == {"regions": []}
    Location.objects.filter(slug="pirate-builder-bay").update(active=True)
    World.objects.filter(slug="learning-adventure-island").update(active=False)
    assert client.get(f"{base(child)}regions/").json() == {"regions": []}


def test_a_world_that_does_not_support_the_age_band_hides_the_region(a):
    client, child = a
    World.objects.filter(slug="learning-adventure-island").update(supported_age_bands=["EXPLORER"])
    assert client.get(f"{base(child)}regions/").json() == {"regions": []}


def test_a_region_with_no_challenge_for_the_band_is_listed_as_locked(a, treasure):
    client, child = a
    ChallengeSpec.objects.filter(slug="treasure-cove-pathfinder").update(status=ContentStatus.DRAFT)
    [region] = client.get(f"{base(child)}regions/").json()["regions"]
    assert region["available"] is False and region["lockedReason"] == "NO_CHALLENGE_FOR_AGE_BAND"


def test_region_status_follows_the_childs_own_sessions(a, treasure):
    client, child = a
    session_id = post(client, f"{base(child)}regions/{REGION}/session/").json()["sessionId"]
    [region] = client.get(f"{base(child)}regions/").json()["regions"]
    assert region["status"] == "IN_PROGRESS" and region["resume"]["sessionId"] == session_id
    # A sibling's view is unaffected.
    [sibling] = client.get(f"{base(treasure.families.a2)}regions/").json()["regions"]
    assert sibling["status"] == "NOT_STARTED"
    post(client, f"{base(child)}sessions/{session_id}/complete/")
    [region] = client.get(f"{base(child)}regions/").json()["regions"]
    assert region["status"] == "VISITED" and region["resume"] is None


# --- adventures ---------------------------------------------------------------------------------


def test_region_adventures_are_the_locations_adventures_for_the_age_band(a):
    client, child = a
    body = client.get(f"{base(child)}regions/{REGION}/adventures/").json()
    assert body["region"]["regionId"] == REGION
    slugs = [entry["adventureId"] for entry in body["adventures"]]
    assert "repair-the-moonlight-bridge" in slugs  # Pathfinder
    assert "three-planks-for-the-bridge" not in slugs  # Sprout only
    assert "the-tide-gate-calculation" not in slugs  # Explorer only
    entry = body["adventures"][slugs.index("repair-the-moonlight-bridge")]
    assert entry["status"] == "AVAILABLE" and entry["resume"] is None
    [quest] = body["quests"]
    assert quest["questId"] == "treasure-rush-cove" and quest["status"] == "AVAILABLE"
    assert quest["available"] is True and quest["prerequisites"] == []


def test_inactive_adventures_are_not_listed(a):
    client, child = a
    Adventure.objects.filter(slug="repair-the-moonlight-bridge").update(active=False)
    body = client.get(f"{base(child)}regions/{REGION}/adventures/").json()
    assert "repair-the-moonlight-bridge" not in [e["adventureId"] for e in body["adventures"]]


def test_adventure_status_reflects_completed_sessions(a):
    client, child = a
    adventure = Adventure.objects.get(slug="repair-the-moonlight-bridge")
    at = timezone.now()
    AdventureSession.objects.create(
        child=child,
        adventure=adventure,
        template_version=adventure.version,
        content_release=ContentRelease.objects.first(),
        status=SessionStatus.COMPLETED,
        current_step_id="complete",
        started_at=at,
        last_activity_at=at,
        completed_at=at,
    )
    body = client.get(f"{base(child)}regions/{REGION}/adventures/").json()
    entry = next(e for e in body["adventures"] if e["adventureId"] == adventure.slug)
    assert entry["status"] == "COMPLETED"


def test_a_quest_whose_prerequisites_fail_is_locked(a, treasure):
    client, child = a
    quest = treasure.quest
    quest.source = {**quest.source, "prerequisites": [{"type": "WORLD_CHANGE", "changeKey": "X"}]}
    quest.save()
    [entry] = client.get(f"{base(child)}regions/{REGION}/adventures/").json()["quests"]
    assert entry["status"] == "LOCKED" and entry["lockedReason"] == "PREREQUISITES_NOT_MET"
    assert entry["prerequisites"] == [{"type": "WORLD_CHANGE", "changeKey": "X"}]


# --- home ---------------------------------------------------------------------------------------


def test_home_for_a_new_child(a):
    client, child = a
    body = client.get(f"{base(child)}home/").json()
    assert body["child"]["id"] == str(child.pk)
    assert body["lastRegion"] is None and body["resume"] == []
    assert [r["regionId"] for r in body["nextRegions"]] == [REGION]
    assert body["progress"] == {
        "completedSessions": 0,
        "worldChanges": 0,
        "items": 0,
        "questsCompleted": 0,
        "questsActive": 0,
    }
    assert body["restrictions"] == {
        "active": True,
        "sessionMinutes": 10,
        "aiEnabled": True,
        "readingMode": "READ_ALONG",
    }


def test_home_after_opening_the_chest(a):
    client, child = a
    session_id = open_chest(client, child)
    body = client.get(f"{base(child)}home/").json()
    assert body["lastRegion"]["regionId"] == REGION
    assert body["resume"][0]["resume"]["sessionId"] == session_id
    assert body["nextRegions"] == []  # the only chest is open
    assert body["progress"]["worldChanges"] == 1 and body["progress"]["items"] == 1
    assert body["recentItems"][0]["item"]["itemId"] == "golden-doubloon"
    assert body["recentWorldChanges"][0]["changeKey"] == "TREASURE_RUSH_COVE_CHEST_OPENED"
    post(client, f"{base(child)}sessions/{session_id}/complete/")
    body = client.get(f"{base(child)}home/").json()
    assert body["resume"] == [] and body["progress"]["completedSessions"] == 1
    assert body["recentActivities"][0]["regionId"] == REGION


# --- inventory and progress -----------------------------------------------------------------------


def test_inventory_lists_the_childs_items_only(a, treasure):
    client, child = a
    assert client.get(f"{base(child)}inventory/").json() == {"items": [], "truncated": False}
    open_chest(client, child)
    body = client.get(f"{base(child)}inventory/").json()
    assert [entry["item"]["itemId"] for entry in body["items"]] == ["golden-doubloon"]
    sibling = client.get(f"{base(treasure.families.a2)}inventory/").json()
    assert sibling["items"] == []


def test_progress_and_inventory_agree(a):
    client, child = a
    open_chest(client, child)
    progress = client.get(f"{base(child)}progress/").json()
    inventory = client.get(f"{base(child)}inventory/").json()
    assert progress["inventory"] == inventory["items"]


# --- isolation checklist for every new child route -------------------------------------------


ROUTES = ["home/", "regions/", f"regions/{REGION}/adventures/", "inventory/"]


@pytest.mark.parametrize("route", ROUTES)
def test_new_routes_are_child_scoped(treasure, api, cognito, route):
    families = treasure.families
    client = api(families.a)
    for own in (families.a1, families.a2):
        assert client.get(f"{base(own)}{route}").status_code == 200
    foreign = client.get(f"{base(families.b1)}{route}")
    unknown = client.get(f"/api/v1/children/{uuid.uuid4()}/{route}")
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]
    assert "Quince" not in foreign.content.decode()
    assert api().get(f"{base(families.a1)}{route}").status_code == 401
    assert api("sub-never-onboarded").get(f"{base(families.a1)}{route}").status_code == 403
    spoof = client.get(f"{base(families.a1)}{route}?child={families.b1.pk}&parent={families.b.pk}")
    assert spoof.status_code == 200 and "Quince" not in spoof.content.decode()


def test_an_inactive_child_can_still_be_viewed_by_its_parent(a):
    client, child = a
    ChildProfile.objects.filter(pk=child.pk).update(active=False)
    body = client.get(f"{base(child)}home/").json()
    assert body["restrictions"]["active"] is False
