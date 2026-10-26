"""Child profile API (LAI-ANDROID-API-001): list, create, read, update; delete stays blocked.

Follows the child-scoped endpoint checklist (docs/TESTING_STRATEGY.md) with the shared
`families` and `api` fixtures.
"""

import json
import logging
import uuid

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.users.models import ChildProfile, ParentAccount

from .helpers import access_claims

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

CHILDREN = "/api/v1/children/"
NEW = {
    "nickname": "Bramble",
    "ageBand": "SPROUT",
    "avatarKey": "OWL",
    "interests": ["Space", "Ocean"],
    "readingMode": "VOICE_FIRST",
    "sessionMinutes": 6,
}
PROFILE_KEYS = {
    "id",
    "nickname",
    "ageBand",
    "avatarKey",
    "hasPhoto",
    "interests",
    "readingMode",
    "sessionMinutes",
    "active",
    "aiEnabled",
    "createdAt",
    "updatedAt",
}


def detail(child) -> str:
    return f"{CHILDREN}{child.pk}/"


def post(client, url, body):
    return client.post(url, json.dumps(body), content_type="application/json")


def patch(client, url, body):
    return client.patch(url, json.dumps(body), content_type="application/json")


def code(response) -> str:
    return response.json()["error"]["code"]


# --- list and read ------------------------------------------------------------------------------


def test_a_parent_lists_only_their_own_children_in_creation_order(families, api):
    body = api(families.a).get(CHILDREN).json()
    assert [c["id"] for c in body["children"]] == [str(families.a1.pk), str(families.a2.pk)]
    assert set(body["children"][0]) == PROFILE_KEYS
    assert "Quince" not in json.dumps(body) and "Quill" not in json.dumps(body)
    other = api(families.b).get(CHILDREN).json()
    assert [c["id"] for c in other["children"]] == [str(families.b1.pk), str(families.b2.pk)]


def test_a_new_parent_has_an_empty_list(families, api):
    ParentAccount.objects.get_or_create_for_cognito("sub-new-parent")
    assert api("sub-new-parent").get(CHILDREN).json() == {"children": []}


def test_reading_own_child_returns_the_profile_without_the_photo_path(families, api):
    ChildProfile.objects.filter(pk=families.a1.pk).update(avatar_photo_key="private/photo.jpg")
    body = api(families.a).get(detail(families.a1)).json()
    assert body["id"] == str(families.a1.pk) and body["nickname"] == "Zinnia-A1"
    assert body["hasPhoto"] is True and "private/photo.jpg" not in json.dumps(body)
    assert body["ageBand"] == "PATHFINDER" and body["sessionMinutes"] == 10


@pytest.mark.parametrize("method", ["get", "patch"])
def test_a_foreign_child_and_an_unknown_id_are_the_same_404(families, api, method):
    client = api(families.a)

    def call(url):
        if method == "get":
            return client.get(url)
        return patch(client, url, {"nickname": "X"})

    foreign = call(detail(families.b1))
    unknown = call(f"{CHILDREN}{uuid.uuid4()}/")
    assert foreign.status_code == unknown.status_code == 404
    strip = lambda r: {k: v for k, v in r.json().items() if k != "request_id"}  # noqa: E731
    assert strip(foreign) == strip(unknown) == {
        "error": {"code": "not_found", "message": "Not found."}
    }
    assert "Quince" not in foreign.content.decode()


# --- authentication ---------------------------------------------------------------------------


def test_children_routes_need_a_provisioned_active_parent(families, api, cognito):
    for url in (CHILDREN, detail(families.a1)):
        assert api().get(url).status_code == 401
        expired = cognito.sign(access_claims(families.a.cognito_sub, exp=1))
        assert code(api(token=expired).get(url)) == "authentication_failed"
        assert code(api("sub-never-onboarded").get(url)) == "account_not_provisioned"
    ParentAccount.objects.filter(pk=families.a.pk).update(is_active=False)
    assert api(families.a).get(CHILDREN).status_code == 403
    assert api(families.a).get(detail(families.a1)).status_code == 403


def test_an_admins_group_claim_gives_no_cross_family_access(families, api, cognito):
    token = cognito.sign(access_claims(families.a.cognito_sub, **{"cognito:groups": ["Admins"]}))
    client = api(token=token)
    assert len(client.get(CHILDREN).json()["children"]) == 2
    assert client.get(detail(families.b1)).status_code == 404


# --- create -----------------------------------------------------------------------------------


def test_creating_a_child_assigns_it_to_the_signed_in_parent(families, api):
    response = post(api(families.a), CHILDREN, NEW)
    assert response.status_code == 201, response.json()
    body = response.json()
    assert set(body) == PROFILE_KEYS and body["active"] is True and body["aiEnabled"] is True
    child = ChildProfile.objects.get(pk=body["id"])
    assert child.parent_id == families.a.pk and child.interests == ["Space", "Ocean"]


def test_owner_and_ids_cannot_be_supplied(families, api):
    for extra in (
        {"parent": str(families.b.pk)},
        {"parentId": str(families.b.pk)},
        {"id": str(uuid.uuid4())},
        {"avatarPhotoKey": "x"},
    ):
        response = post(api(families.a), CHILDREN, {**NEW, **extra})
        assert response.status_code == 400 and code(response) == "validation_error"
    assert ChildProfile.objects.filter(parent=families.b).count() == 2
    assert ChildProfile.objects.count() == 4


def test_the_three_profile_cap_is_enforced(families, api):
    client = api(families.a)
    assert post(client, CHILDREN, NEW).status_code == 201
    response = post(client, CHILDREN, {**NEW, "nickname": "Fourth"})
    assert response.status_code == 409 and code(response) == "child_profile_limit_reached"
    assert ChildProfile.objects.filter(parent=families.a).count() == 3


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"nickname": "   "}, "nickname"),
        ({"nickname": "x" * 31}, "nickname"),
        ({"ageBand": "TEEN"}, "ageBand"),
        ({"avatarKey": "UNICORN"}, "avatarKey"),
        ({"readingMode": "LOUD"}, "readingMode"),
        ({"interests": ["Space"] * 2}, "interests"),
        ({"interests": ["Not-an-interest"]}, "interests"),
        ({"interests": ["Animals", "Space", "Ocean", "Art", "Music", "Nature"]}, "interests"),
        ({"sessionMinutes": 12}, "sessionMinutes"),  # outside the Sprout range 5-8
    ],
)
def test_create_validation_uses_the_existing_rules(families, api, change, field):
    response = post(api(families.a), CHILDREN, {**NEW, **change})
    assert response.status_code == 400, response.json()
    assert field in response.json()["error"]["details"]
    assert ChildProfile.objects.filter(parent=families.a).count() == 2


def test_a_required_field_is_required(families, api):
    body = {k: v for k, v in NEW.items() if k != "ageBand"}
    response = post(api(families.a), CHILDREN, body)
    assert response.status_code == 400 and "ageBand" in response.json()["error"]["details"]


# --- update -----------------------------------------------------------------------------------


def test_a_parent_updates_their_own_child(families, api):
    response = patch(
        api(families.a),
        detail(families.a1),
        {"nickname": "Zinnia", "aiEnabled": False, "sessionMinutes": 12},
    )
    assert response.status_code == 200, response.json()
    families.a1.refresh_from_db()
    assert families.a1.nickname == "Zinnia" and families.a1.ai_enabled is False
    assert families.a1.session_minutes == 12


def test_changing_the_age_band_revalidates_the_session_length(families, api):
    response = patch(api(families.a), detail(families.a1), {"ageBand": "SPROUT"})
    assert response.status_code == 400
    assert "sessionMinutes" in response.json()["error"]["details"]
    ok = patch(api(families.a), detail(families.a1), {"ageBand": "SPROUT", "sessionMinutes": 7})
    assert ok.status_code == 200 and ok.json()["ageBand"] == "SPROUT"


def test_an_update_cannot_move_a_child_or_touch_server_fields(families, api):
    for body in ({"parent": str(families.b.pk)}, {"id": str(uuid.uuid4())}, {"createdAt": "x"}):
        assert patch(api(families.a), detail(families.a1), body).status_code == 400
    assert patch(api(families.a), detail(families.a1), {}).status_code == 400
    families.a1.refresh_from_db()
    assert families.a1.parent_id == families.a.pk


def test_a_foreign_update_writes_nothing(families, api):
    with CaptureQueriesContext(connection) as queries:
        response = patch(api(families.a), detail(families.b1), {"nickname": "Hacked"})
    assert response.status_code == 404
    writes = [q["sql"] for q in queries if q["sql"].split()[0] in {"INSERT", "UPDATE", "DELETE"}]
    assert writes == []
    families.b1.refresh_from_db()
    assert families.b1.nickname == "Quince-B1"


def test_a_child_owned_by_the_same_parent_is_reachable_but_not_another_family(families, api):
    client = api(families.b)
    assert patch(client, detail(families.b2), {"active": False}).status_code == 200
    assert patch(client, detail(families.a2), {"active": False}).status_code == 404
    families.a2.refresh_from_db()
    assert families.a2.active is True


# --- delete stays blocked -----------------------------------------------------------------------


def test_deleting_a_child_is_blocked_until_the_deletion_service_exists(families, api):
    for child in (families.a1, families.b1):
        response = api(families.a).delete(detail(child))
        assert response.status_code == 403 and code(response) == "sensitive_action_unavailable"
    assert ChildProfile.objects.count() == 4


# --- privacy ----------------------------------------------------------------------------------


def test_logs_carry_no_nickname_interest_or_identity(families, api, caplog):
    with caplog.at_level(logging.DEBUG):
        post(api(families.a), CHILDREN, {**NEW, "nickname": "Sentinel-Nick"})
        patch(api(families.a), detail(families.b1), {"nickname": "Sentinel-Other"})
        api(families.a).get(CHILDREN)
    text = " ".join(r.getMessage() for r in caplog.records)
    for secret in ("Sentinel-Nick", "Sentinel-Other", "Zinnia", "Secret-Interest", "Space"):
        assert secret not in text
    assert families.a.cognito_sub not in text and str(families.b1.pk) not in text

