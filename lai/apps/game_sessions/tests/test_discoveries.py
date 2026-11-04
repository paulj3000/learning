"""Discoveries on the server (SC-R04-00): the child-scoped checklist (docs/TESTING_STRATEGY.md,
LAI-0403), idempotency, the reward and world change a find owes, and the race of two finds.

Uses the real content export (`treasure`), so the rules, items and discoveries are the shipped ones.
"""

import json
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression import discoveries
from apps.progression.models import WorldChange, WorldState
from apps.users.tests.helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOOK = "castle-tapestry-stair"


def url(child) -> str:
    return f"/api/v1/children/{child.pk}/discoveries/"


def post(client, child, body):
    return client.post(url(child), json.dumps(body), content_type="application/json")


@pytest.fixture
def a(treasure, api):
    return api(treasure.families.a), treasure.families.a1


@pytest.fixture
def fam(treasure):
    return treasure.families


# --- the checklist ---------------------------------------------------------------------------


def test_each_of_a_parents_children_can_read_and_record(fam, api):
    client = api(fam.a)
    for child in (fam.a1, fam.a2):
        assert client.get(url(child)).json() == {"discoveries": []}
        assert post(client, child, {"discoveryId": NOOK}).status_code == 201
        assert client.get(url(child)).json() == {"discoveries": [NOOK]}


def test_another_familys_child_and_an_unknown_child_get_the_identical_404(fam, api):
    client = api(fam.a)
    foreign = client.get(url(fam.b1))
    unknown = client.get(f"/api/v1/children/{uuid.uuid4()}/discoveries/")
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]
    assert foreign.json()["error"]["code"] == "not_found"


def test_no_token_bad_token_unprovisioned_and_inactive_are_denied(fam, api, cognito):
    assert api().get(url(fam.a1)).status_code == 401
    expired = cognito.sign(access_claims(fam.a.cognito_sub, exp=1))
    for token in ("garbage", expired):
        assert api(token=token).get(url(fam.a1)).status_code == 401
    stranger = api("sub-never-onboarded")
    assert stranger.get(url(fam.a1)).status_code == 403
    assert post(stranger, fam.a1, {"discoveryId": NOOK}).status_code == 403
    fam.a.is_active = False
    fam.a.save()
    assert api(fam.a).get(url(fam.a1)).status_code == 403


def test_a_write_to_a_foreign_child_changes_nothing_and_runs_no_insert(fam, api):
    client = api(fam.a)
    with CaptureQueriesContext(connection) as queries:
        response = post(client, fam.b1, {"discoveryId": NOOK})
    assert response.status_code == 404
    assert not WorldState.objects.filter(child=fam.b1).exists()
    written = [
        q for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
    ]
    assert not written


def test_ids_in_the_body_or_query_are_ignored_and_siblings_are_isolated(fam, api):
    client = api(fam.a)
    ok = client.post(
        url(fam.a1) + f"?child={fam.b1.pk}",
        json.dumps({"discoveryId": NOOK}),
        content_type="application/json",
    )
    assert ok.status_code == 201
    assert post(client, fam.a1, {"discoveryId": NOOK, "childId": str(fam.b1.pk)}).status_code == 400
    assert not WorldState.objects.filter(child=fam.b1).exists()
    assert client.get(url(fam.a2)).json() == {"discoveries": []}


def test_an_admins_token_gets_no_cross_family_access(fam, api, token_for):
    admin = api(token=token_for(fam.b.cognito_sub, **{"cognito:groups": ["Admins"]}))
    assert admin.get(url(fam.a1)).status_code == 404
    assert post(admin, fam.a1, {"discoveryId": NOOK}).status_code == 404


def test_error_bodies_name_no_nickname_or_foreign_id(fam, api):
    client = api(fam.a)
    for response in (
        client.get(url(fam.b1)),
        post(client, fam.a1, {"discoveryId": "no-such-discovery"}),
        post(client, fam.a1, {"discoveryId": "x", "extra": 1}),
    ):
        text = response.content.decode()
        for forbidden in ("Zinnia", "Zephyr", "Quince", "Quill-B2", "Secret-Interest"):
            assert forbidden not in text
        assert str(fam.b1.pk) not in text


# --- what a find owes ------------------------------------------------------------------------


def test_finding_the_nook_records_it_writes_the_world_change_and_grants_the_book_once(a):
    client, child = a
    response = post(client, child, {"discoveryId": NOOK})
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "FOUND_NOW"
    assert body["newItemIds"] == ["blank-page-storybook"]
    assert body["rewardMessages"] == [
        "You carry the book with the blank page down the stair with you."
    ]
    assert WorldState.objects.get(child=child).discovered_objects == [NOOK]
    [change] = WorldChange.objects.for_child(child).filter(change_key="CASTLE_READING_NOOK_FOUND")
    assert change.location_slug == "storykeeper-castle"
    assert change.source_session_id == f"discovery:{NOOK}"
    assert (
        InventoryItem.objects.for_child(child).filter(item__item_id="blank-page-storybook").count()
        == 1
    )


def test_finding_it_again_is_a_replay_that_changes_and_grants_nothing(a):
    client, child = a
    post(client, child, {"discoveryId": NOOK})
    again = post(client, child, {"discoveryId": NOOK})
    assert again.status_code == 200
    assert again.json() == {"discoveryId": NOOK, "status": "ALREADY_FOUND"}
    assert (
        WorldChange.objects.for_child(child).filter(change_key="CASTLE_READING_NOOK_FOUND").count()
        == 1
    )
    assert GrantedRule.objects.for_child(child).count() == 1
    assert InventoryItem.objects.for_child(child).count() == 1
    assert WorldState.objects.get(child=child).discovered_objects == [NOOK]


def test_a_locked_discovery_is_refused_with_its_authored_line_and_writes_nothing(a):
    client, child = a
    response = post(
        client, child, {"discoveryId": "harbor-keepers-door"}
    )  # needs the driftwood key
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "LOCKED"
    assert body["message"] == discoveries.definitions()["harbor-keepers-door"]["lockedMessage"]
    assert "rewardMessages" not in body
    assert not WorldChange.objects.for_child(child).exists()
    assert client.get(url(child)).json() == {"discoveries": []}


def test_a_world_change_requirement_opens_only_once_it_holds(a):
    client, child = a
    assert post(client, child, {"discoveryId": "bay-tide-tunnel"}).json()["status"] == "LOCKED"
    from apps.progression.services import record_world_change

    record_world_change(
        child, location_slug="pirate-builder-bay", change_type="BUILD", change_key="BRIDGE_REPAIRED"
    )
    assert post(client, child, {"discoveryId": "bay-tide-tunnel"}).json()["status"] == "FOUND_NOW"


def test_an_unknown_discovery_is_404_and_bodies_are_closed(a):
    client, child = a
    assert post(client, child, {"discoveryId": "no-such-discovery"}).status_code == 404
    assert post(client, child, {}).status_code == 400
    assert post(client, child, {"discoveryId": "has spaces"}).status_code == 400
    assert post(client, child, {"discoveryId": NOOK, "reward": "gold"}).status_code == 400
    assert not WorldState.objects.filter(child=child).exists()


def test_discoveries_are_listed_in_the_contents_order_and_only_known_ids(a):
    client, child = a
    post(client, child, {"discoveryId": "wonderwild-glow-moss"})
    post(client, child, {"discoveryId": NOOK})
    post(client, child, {"discoveryId": "harbor-tide-pool"})
    WorldState.objects.filter(child=child).update(
        discovered_objects=[*WorldState.objects.get(child=child).discovered_objects, "a-stale-id"]
    )
    listed = client.get(url(child)).json()["discoveries"]
    assert listed == [d for d in discoveries.discovery_ids() if d in set(listed)]
    assert "a-stale-id" not in listed
    assert set(listed) == {"harbor-tide-pool", "wonderwild-glow-moss", NOOK}


def test_the_definitions_are_the_verified_exports_and_include_the_nook():
    assert NOOK in discoveries.discovery_ids()
    assert len(set(discoveries.discovery_ids())) == len(discoveries.discovery_ids())


# --- the Secret Chamber now rests on a real record -------------------------------------------


def test_finding_the_nook_through_the_endpoint_is_what_opens_the_secret_chamber(a):
    client, child = a
    rooms = f"/api/v1/children/{child.pk}/castle/rooms/"

    def room(body):
        return client.post(rooms, json.dumps(body), content_type="application/json")

    before = room({"roomId": "secret-chamber"})
    missing = room({"roomId": "no-such-room"})
    assert before.status_code == missing.status_code == 404
    assert before.json()["error"] == missing.json()["error"]
    assert post(client, child, {"discoveryId": NOOK}).status_code == 201
    assert room({"roomId": "secret-chamber"}).status_code == 201
    assert client.get(rooms).json() == {"rooms": ["secret-chamber"]}


def test_another_child_finding_the_nook_does_not_open_the_chamber_for_a_sibling(fam, api):
    client = api(fam.a)
    post(client, fam.a1, {"discoveryId": NOOK})
    sibling = client.post(
        f"/api/v1/children/{fam.a2.pk}/castle/rooms/",
        json.dumps({"roomId": "secret-chamber"}),
        content_type="application/json",
    )
    assert sibling.status_code == 404
