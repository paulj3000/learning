"""Storykeeper Castle room discovery (SC-R03-06): the child-scoped checklist
(docs/TESTING_STRATEGY.md, LAI-0403) and the rules that keep a secret secret."""

import json
from pathlib import Path

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.progression.models import WorldChange, WorldState
from apps.regions import castle_rooms
from apps.users.tests.helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

NOOK = "castle-tapestry-stair"
PUBLIC = [room for room in castle_rooms.ROOM_IDS if room not in castle_rooms.SECRET_ROOMS]


def url(child) -> str:
    return f"/api/v1/children/{child.pk}/castle/rooms/"


def post(client, child, body):
    return client.post(url(child), json.dumps(body), content_type="application/json")


def find_nook(child):
    """The child has made the discovery that opens the secret passage."""
    WorldState.objects.update_or_create(
        child=child,
        defaults={"discovered_objects": [NOOK], "updated_at": timezone.now()},
    )


# --- the checklist ---------------------------------------------------------------------------


def test_each_of_a_parents_children_can_read_and_record(families, api):
    client = api(families.a)
    for child in (families.a1, families.a2):
        assert client.get(url(child)).json() == {"rooms": []}
        response = post(client, child, {"roomId": "story-hall"})
        assert response.status_code == 201
        assert response.json() == {"roomId": "story-hall", "newlyDiscovered": True}
        assert client.get(url(child)).json() == {"rooms": ["story-hall"]}


def test_another_familys_child_and_an_unknown_child_get_the_identical_404(families, api):
    import uuid

    client = api(families.a)
    foreign = client.get(url(families.b1))
    unknown = client.get(f"/api/v1/children/{uuid.uuid4()}/castle/rooms/")
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["error"] == unknown.json()["error"]
    assert foreign.json()["error"]["code"] == "not_found"


def test_no_token_and_a_bad_token_are_401_and_an_unprovisioned_identity_403(families, api, cognito):
    assert api().get(url(families.a1)).status_code == 401
    expired = cognito.sign(access_claims(families.a.cognito_sub, exp=1))
    for token in ("garbage", expired):
        assert api(token=token).get(url(families.a1)).status_code == 401
    unprovisioned = api("sub-never-onboarded")
    assert unprovisioned.get(url(families.a1)).status_code == 403
    assert post(unprovisioned, families.a1, {"roomId": "story-hall"}).status_code == 403


def test_an_inactive_parent_is_denied(families, api):
    families.a.is_active = False
    families.a.save()
    assert api(families.a).get(url(families.a1)).status_code == 403


def test_a_write_to_a_foreign_child_changes_nothing_and_runs_no_insert(families, api):
    client = api(families.a)
    before = WorldChange.objects.count()
    with CaptureQueriesContext(connection) as queries:
        response = post(client, families.b1, {"roomId": "story-hall"})
    assert response.status_code == 404
    assert WorldChange.objects.count() == before
    assert not [
        q for q in queries if q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))
    ]


def test_a_child_or_parent_id_in_the_body_or_query_is_ignored(families, api):
    client = api(families.a)
    response = client.post(
        url(families.a1) + f"?child={families.b1.pk}&parent={families.b.pk}",
        json.dumps({"roomId": "story-hall"}),
        content_type="application/json",
    )
    assert response.status_code == 201
    assert WorldChange.objects.for_child(families.a1).count() == 1
    assert WorldChange.objects.for_child(families.b1).count() == 0
    # A child id in the body is not an accepted field at all.
    bad = post(client, families.a1, {"roomId": "great-library", "childId": str(families.b1.pk)})
    assert bad.status_code == 400


def test_a_sibling_never_sees_the_others_rooms(families, api):
    client = api(families.a)
    post(client, families.a1, {"roomId": "great-library"})
    assert client.get(url(families.a2)).json() == {"rooms": []}
    assert client.get(url(families.a1)).json() == {"rooms": ["great-library"]}


def test_an_admins_token_gets_no_cross_family_access(families, api, token_for):
    admin = api(token=token_for(families.b.cognito_sub, **{"cognito:groups": ["Admins"]}))
    assert admin.get(url(families.a1)).status_code == 404
    assert post(admin, families.a1, {"roomId": "story-hall"}).status_code == 404


def test_error_bodies_name_no_child_nickname_or_foreign_id(families, api):
    client = api(families.a)
    for response in (
        client.get(url(families.b1)),
        post(client, families.a1, {"roomId": "no-such-room"}),
        post(client, families.a1, {"roomId": "x", "extra": 1}),
    ):
        text = response.content.decode()
        for forbidden in (
            "Zinnia",
            "Zephyr",
            "Quince",
            "Quill-B2",
            "Secret-Interest",
            str(families.b1.pk),
        ):
            assert forbidden not in text


# --- the rules -------------------------------------------------------------------------------


def test_recording_is_idempotent_and_makes_one_append_only_row(families, api):
    client = api(families.a)
    first = post(client, families.a1, {"roomId": "east-corridor"})
    again = post(client, families.a1, {"roomId": "east-corridor"})
    assert (first.status_code, first.json()["newlyDiscovered"]) == (201, True)
    assert (again.status_code, again.json()["newlyDiscovered"]) == (200, False)
    [row] = WorldChange.objects.for_child(families.a1)
    assert row.location_slug == "storykeeper-castle"
    assert row.change_type == "ROOM_DISCOVERED"
    assert row.change_key == "castle-room:east-corridor"
    assert row.source_session_id == "exploration:castle-room"


def test_rooms_are_listed_in_the_castles_order_whatever_order_they_were_found(families, api):
    client = api(families.a)
    for room in ("great-library", "entry-hall", "trophy-room", "story-hall"):
        assert post(client, families.a1, {"roomId": room}).status_code == 201
    listed = client.get(url(families.a1)).json()["rooms"]
    assert listed == [r for r in castle_rooms.ROOM_IDS if r in set(listed)]
    assert listed == ["entry-hall", "story-hall", "great-library", "trophy-room"]


def test_an_unknown_room_is_404_and_closed_bodies_are_refused(families, api):
    client = api(families.a)
    assert post(client, families.a1, {"roomId": "no-such-room"}).status_code == 404
    assert post(client, families.a1, {}).status_code == 400
    assert post(client, families.a1, {"roomId": "has spaces"}).status_code == 400
    assert post(client, families.a1, {"roomId": "story-hall", "reward": "gold"}).status_code == 400
    assert WorldChange.objects.for_child(families.a1).count() == 0


def test_a_secret_room_is_refused_exactly_like_a_room_that_does_not_exist(families, api):
    client = api(families.a)
    secret = post(client, families.a1, {"roomId": "secret-chamber"})
    missing = post(client, families.a1, {"roomId": "no-such-room"})
    assert secret.status_code == missing.status_code == 404
    assert secret.json()["error"] == missing.json()["error"]
    assert WorldChange.objects.for_child(families.a1).count() == 0
    assert client.get(url(families.a1)).json() == {"rooms": []}


def test_a_secret_room_is_recorded_once_the_nook_is_found_and_not_before(families, api):
    client = api(families.a)
    find_nook(families.a1)
    assert post(client, families.a1, {"roomId": "secret-chamber"}).status_code == 201
    assert client.get(url(families.a1)).json() == {"rooms": ["secret-chamber"]}
    # A sibling who has not found it still cannot record or list it.
    assert post(client, families.a2, {"roomId": "secret-chamber"}).status_code == 404
    assert client.get(url(families.a2)).json() == {"rooms": []}


def test_a_secret_row_is_never_listed_if_the_discovery_is_not_on_the_world_state(families, api):
    client = api(families.a)
    find_nook(families.a1)
    post(client, families.a1, {"roomId": "secret-chamber"})
    WorldState.objects.filter(child=families.a1).update(discovered_objects=[])
    assert client.get(url(families.a1)).json() == {"rooms": []}


def test_the_ids_file_is_the_single_source_and_well_formed():
    data = json.loads((Path(castle_rooms.__file__).parent / "castle_rooms.json").read_text())
    assert tuple(data["rooms"]) == castle_rooms.ROOM_IDS
    assert len(set(castle_rooms.ROOM_IDS)) == len(castle_rooms.ROOM_IDS)
    assert set(castle_rooms.SECRET_ROOMS) <= set(castle_rooms.ROOM_IDS)
    assert castle_rooms.SECRET_ROOMS == {"secret-chamber": NOOK}
    # The key fits the column and never collides with another feature's change keys.
    for room in castle_rooms.ROOM_IDS:
        assert len(castle_rooms.change_key(room)) <= 100
        assert castle_rooms.change_key(room).startswith("castle-room:")
