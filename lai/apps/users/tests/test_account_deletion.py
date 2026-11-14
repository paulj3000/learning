"""Parent account deletion, `DELETE /api/v1/me/` (AMP-03), and the companion choice route.

Synthetic families (`families`, lai/conftest.py) and locally signed tokens; nothing contacts AWS.
"""

import time

import pytest

from apps.game_sessions.models import CoopSession
from apps.progression.models import WorldChange
from apps.users import deletion, photos
from apps.users.models import ChildPhoto, ChildProfile, ParentAccount
from apps.users.photo_storage import reset_photo_storage_cache

from .test_child_photos import EXIF_JPEG

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ME = "/api/v1/me/"


def now() -> int:
    return int(time.time())


def code(response) -> str:
    return response.json()["error"]["code"]


@pytest.fixture
def signed_in(api, token_for):
    def make(parent, **claims):
        claims.setdefault("auth_time", now() - 30)
        claims.setdefault("iat", now() - 30)
        return api(token=token_for(parent.cognito_sub, **claims))

    return make


@pytest.fixture(autouse=True)
def fresh_photo_store():
    reset_photo_storage_cache()
    yield
    reset_photo_storage_cache()


def _world_change(child, key="BRIDGE_REPAIRED"):
    from django.utils import timezone

    return WorldChange.objects.create(
        child=child,
        location_slug="pirate-builder-bay",
        change_type="REPAIR",
        change_key=key,
        created_at=timezone.now(),
    )


def test_a_recent_sign_in_deletes_the_account_and_every_childs_data(families, signed_in):
    _world_change(families.a1)
    _world_change(families.b1)
    photos.replace_photo(families.a, families.a2.pk, EXIF_JPEG, "image/jpeg")

    response = signed_in(families.a).delete(ME)

    assert response.status_code == 204
    assert not ParentAccount.objects.filter(pk=families.a.pk).exists()
    assert not ChildProfile.objects.filter(pk__in=[families.a1.pk, families.a2.pk]).exists()
    assert not WorldChange.objects.filter(child_id=families.a1.pk).exists()
    assert not ChildPhoto.objects.filter(child_id=families.a2.pk).exists()
    # The other family is untouched.
    assert ParentAccount.objects.filter(pk=families.b.pk).exists()
    assert set(ChildProfile.objects.filter(parent=families.b).values_list("pk", flat=True)) == {
        families.b1.pk,
        families.b2.pk,
    }
    assert WorldChange.objects.filter(child_id=families.b1.pk).count() == 1


def test_a_deleted_account_cannot_be_used_and_signing_in_again_starts_empty(families, signed_in):
    assert signed_in(families.a).delete(ME).status_code == 204
    again = signed_in(families.a)
    assert code(again.get("/api/v1/children/")) == "account_not_provisioned"
    assert again.post(ME).status_code == 201
    assert again.get("/api/v1/children/").json() == {"children": []}


def test_a_stale_sign_in_cannot_delete_the_account(families, signed_in):
    response = signed_in(families.a, auth_time=now() - 3600, iat=now() - 3600).delete(ME)
    assert code(response) == "recent_auth_required"
    assert ParentAccount.objects.filter(pk=families.a.pk).exists()
    assert ChildProfile.objects.filter(parent=families.a).count() == 2


def test_an_unauthenticated_request_deletes_nothing(families, api):
    assert api().delete(ME).status_code == 401
    assert ParentAccount.objects.count() == 2


def test_a_staff_account_is_refused(families, signed_in):
    ParentAccount.objects.filter(pk=families.a.pk).update(is_staff=True)
    response = signed_in(families.a).delete(ME)
    assert response.status_code == 409
    assert code(response) == "staff_account_not_deletable"
    assert ChildProfile.objects.filter(parent=families.a).count() == 2


def test_a_photo_storage_failure_keeps_the_account_and_a_retry_finishes(
    families, signed_in, monkeypatch
):
    calls = {"n": 0}
    real = photos.delete_all_child_photos

    def flaky(child):
        calls["n"] += 1
        return False if calls["n"] == 2 else real(child)

    monkeypatch.setattr(photos, "delete_all_child_photos", flaky)
    first = signed_in(families.a).delete(ME)
    assert first.status_code == 503
    assert code(first) == "account_deletion_incomplete"
    assert ParentAccount.objects.filter(pk=families.a.pk).exists()
    assert ChildProfile.objects.filter(parent=families.a).count() == 1

    assert signed_in(families.a).delete(ME).status_code == 204
    assert not ParentAccount.objects.filter(pk=families.a.pk).exists()


def test_hosted_coop_sessions_do_not_block_deletion(families, signed_in, content_catalog):
    from django.utils import timezone

    CoopSession.objects.create(
        host_parent=families.a,
        adventure=content_catalog.bridge,
        template_version=1,
        status="ACTIVE",
        started_at=timezone.now(),
        last_activity_at=timezone.now(),
    )
    assert signed_in(families.a).delete(ME).status_code == 204
    assert not CoopSession.objects.exists()


def test_the_service_refuses_staff_rows_directly(families):
    families.a.is_staff = True
    with pytest.raises(deletion.StaffAccountNotDeletable):
        deletion.delete_parent_account(families.a)


# --- companion choice -------------------------------------------------------------------------


def companion(child) -> str:
    return f"/api/v1/children/{child.pk}/companion/"


def test_no_companion_until_the_child_chooses(families, api):
    assert api(families.a).get(companion(families.a1)).json() == {"companion": None}


def test_choosing_chatty_is_stored_once_and_repeat_is_idempotent(families, api):
    client = api(families.a)
    first = client.put(
        companion(families.a1), {"companionType": "CHATTY_PARROT"}, content_type="application/json"
    )
    assert first.status_code == 201
    body = first.json()["companion"]
    assert body["companionType"] == "CHATTY_PARROT"
    assert body["displayName"] == "Chatty"
    again = client.put(
        companion(families.a1), {"companionType": "CHATTY_PARROT"}, content_type="application/json"
    )
    assert again.status_code == 200
    assert again.json()["companion"]["chosenAt"] == body["chosenAt"]
    assert client.get(companion(families.a1)).json()["companion"]["displayName"] == "Chatty"
    assert client.get(companion(families.a2)).json() == {"companion": None}


@pytest.mark.parametrize(
    "payload",
    [{"companionType": "DRAGON"}, {"companionType": "CHATTY_PARROT", "displayName": "Bob"}, {}],
)
def test_only_an_authored_companion_is_accepted(families, api, payload):
    response = api(families.a).put(companion(families.a1), payload, content_type="application/json")
    assert response.status_code == 400
    assert api(families.a).get(companion(families.a1)).json() == {"companion": None}


def test_another_familys_child_companion_is_not_found(families, api):
    client = api(families.a)
    assert client.get(companion(families.b1)).status_code == 404
    response = client.put(
        companion(families.b1), {"companionType": "CHATTY_PARROT"}, content_type="application/json"
    )
    assert response.status_code == 404
    families.b1.refresh_from_db()
    assert families.b1.companion_type == ""
