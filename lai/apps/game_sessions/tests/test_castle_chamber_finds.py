"""The Secret Chamber's two quiet finds on the server (SC-R08-02, ADR-051).

They follow the tapestry nook's pattern: the server knows the ids from the verified content export,
accepts them only once the nook is found (a locked find writes nothing), persists them per child,
and a replay changes nothing. Finding one grants nothing: no item, no reward, no quest.
"""

import json

import pytest

from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import discoveries
from apps.progression.models import WorldChange, WorldState

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOOK = "castle-tapestry-stair"
FINDS = {
    "castle-chamber-star": "CASTLE_CHAMBER_STAR_FOUND",
    "castle-chamber-mouse-door": "CASTLE_CHAMBER_MOUSE_DOOR_FOUND",
}


def url(child) -> str:
    return f"/api/v1/children/{child.pk}/discoveries/"


def post(client, child, body):
    return client.post(url(child), json.dumps(body), content_type="application/json")


@pytest.fixture
def a(treasure, api):
    return api(treasure.families.a), treasure.families.a1


def test_the_server_knows_both_ids_and_still_rejects_an_unknown_one(a):
    for discovery_id in FINDS:
        assert discovery_id in discoveries.discovery_ids()
    client, child = a
    assert post(client, child, {"discoveryId": "castle-chamber-nonsense"}).status_code == 404


@pytest.mark.parametrize("discovery_id", list(FINDS))
def test_a_find_is_locked_until_the_nook_is_found_and_writes_nothing(a, discovery_id):
    client, child = a
    response = post(client, child, {"discoveryId": discovery_id})
    assert response.status_code == 200
    assert response.json()["status"] == "LOCKED"
    assert not WorldChange.objects.for_child(child).exists()
    assert client.get(url(child)).json() == {"discoveries": []}


@pytest.mark.parametrize("discovery_id,key", list(FINDS.items()))
def test_a_find_after_the_nook_is_persisted_and_grants_only_its_record(a, discovery_id, key):
    client, child = a
    assert post(client, child, {"discoveryId": NOOK}).status_code == 201
    items_before = InventoryItem.objects.for_child(child).count()
    rules_before = GrantedRule.objects.for_child(child).count()

    response = post(client, child, {"discoveryId": discovery_id})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "FOUND_NOW"
    assert not body.get("newItemIds")
    assert not body.get("rewardMessages")

    assert discovery_id in WorldState.objects.get(child=child).discovered_objects
    [change] = WorldChange.objects.for_child(child).filter(change_key=key)
    assert change.location_slug == "storykeeper-castle"
    assert change.source_session_id == f"discovery:{discovery_id}"
    # Nothing beyond the record: no item, no reward rule fired.
    assert InventoryItem.objects.for_child(child).count() == items_before
    assert GrantedRule.objects.for_child(child).count() == rules_before
    assert discovery_id in client.get(url(child)).json()["discoveries"]


@pytest.mark.parametrize("discovery_id,key", list(FINDS.items()))
def test_finding_it_again_is_a_replay_that_changes_nothing(a, discovery_id, key):
    client, child = a
    post(client, child, {"discoveryId": NOOK})
    post(client, child, {"discoveryId": discovery_id})
    again = post(client, child, {"discoveryId": discovery_id})
    assert again.status_code == 200
    assert again.json() == {"discoveryId": discovery_id, "status": "ALREADY_FOUND"}
    assert WorldChange.objects.for_child(child).filter(change_key=key).count() == 1
    assert WorldState.objects.get(child=child).discovered_objects.count(discovery_id) == 1


def test_a_find_by_one_child_does_not_reach_a_sibling(treasure, api):
    families = treasure.families
    client = api(families.a)
    post(client, families.a1, {"discoveryId": NOOK})
    post(client, families.a1, {"discoveryId": "castle-chamber-star"})
    assert client.get(url(families.a2)).json() == {"discoveries": []}
    assert (
        post(client, families.a2, {"discoveryId": "castle-chamber-star"}).json()["status"]
        == "LOCKED"
    )
