"""Household co-op on Django (AMP-05): the port of the Amplify `CoopSession` writes and the
`claimCoopSlot` Lambda. Child-scoped with the LAI-0403 fixtures; races use real transactions.
"""

import threading

import pytest
from django.db import connection

from apps.game_sessions import coop
from apps.game_sessions.models import CoopParticipant, CoopSession

pytestmark = pytest.mark.postgres


def base(child):
    return f"/api/v1/children/{child.pk}/coop-sessions/"


def start(api, families, partner=None, slug="fix-bridge"):
    partner = partner or families.a2
    return api(families.a).post(
        base(families.a1),
        {"adventureSlug": slug, "partnerChildId": str(partner.pk)},
        content_type="application/json",
    )


@pytest.fixture
def session(content_catalog, families, api):
    response = start(api, families)
    assert response.status_code == 201, response.content
    return response.json()


def post(api, parent, child, coop_id, action, body=None):
    return api(parent).post(
        f"{base(child)}{coop_id}/{action}/", body or {}, content_type="application/json"
    )


# --- start ------------------------------------------------------------------------------------


def test_a_parent_starts_a_session_for_two_of_their_children(session, families):
    assert session["templateSlug"] == "fix-bridge"
    assert session["templateVersion"] == 1
    assert session["status"] == "ACTIVE"
    assert session["sharedState"] == {"slots": {}, "presence": []}
    assert sorted(session["participantChildProfileIds"]) == sorted(
        [str(families.a1.pk), str(families.a2.pk)]
    )
    assert session["completedAt"] is None
    # The parent's identity never crosses the wire.
    assert "hostParentProfileId" not in session
    stored = CoopSession.objects.get(pk=session["id"])
    assert stored.host_parent == families.a


@pytest.mark.parametrize("partner", ["self", "foreign", "unknown"])
def test_the_partner_must_be_another_child_of_the_same_parent(
    content_catalog, families, api, partner
):
    import uuid
    from types import SimpleNamespace

    target = {
        "self": families.a1,
        "foreign": families.b1,
        "unknown": SimpleNamespace(pk=uuid.uuid4()),
    }[partner]
    response = start(api, families, partner=target)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "partner_invalid"
    assert CoopSession.objects.count() == 0


def test_the_adventure_must_exist_and_suit_both_children(content_catalog, families, api):
    response = start(api, families, slug="no-such-adventure")
    assert response.json()["error"]["code"] == "adventure_invalid"
    families.a2.age_band = "SPROUT"
    families.a2.save(update_fields=["age_band"])
    response = start(api, families)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "adventure_invalid"


def test_the_start_body_is_closed(content_catalog, families, api):
    response = api(families.a).post(
        base(families.a1),
        {"adventureSlug": "fix-bridge", "partnerChildId": str(families.a2.pk), "hostParent": "x"},
        content_type="application/json",
    )
    assert response.status_code == 400


# --- read and scoping -------------------------------------------------------------------------


def test_both_children_read_the_session_and_nobody_else_can(session, families, api):
    coop_id = session["id"]
    for child in (families.a1, families.a2):
        response = api(families.a).get(f"{base(child)}{coop_id}/")
        assert response.status_code == 200
        assert response.json()["id"] == coop_id
    # Another family, through their own child or ours: the same 404 as an unknown id.
    assert api(families.b).get(f"{base(families.b1)}{coop_id}/").status_code == 404
    assert api(families.b).get(f"{base(families.a1)}{coop_id}/").status_code == 404
    assert api().get(f"{base(families.a1)}{coop_id}/").status_code == 401


def test_a_sibling_outside_the_session_cannot_see_it(content_catalog, families, api):
    from apps.users import services

    third = services.create_child_profile(
        families.a,
        nickname="Third-A3",
        age_band="PATHFINDER",
        avatar_key="FOX",
        reading_mode="READ_ALONG",
        interests=[],
    )
    coop_id = start(api, families).json()["id"]
    assert api(families.a).get(f"{base(third)}{coop_id}/").status_code == 404
    assert post(api, families.a, third, coop_id, "slots", {"slotKey": "count"}).status_code == 404


# --- claims -----------------------------------------------------------------------------------


def test_the_first_claim_wins_and_the_second_is_not_an_error(session, families, api):
    coop_id = session["id"]
    first = post(api, families.a, families.a1, coop_id, "slots", {"slotKey": "count"})
    assert first.status_code == 200
    assert first.json()["outcome"] == "claimed"
    assert first.json()["session"]["sharedState"]["slots"] == {"count": str(families.a1.pk)}

    second = post(api, families.a, families.a2, coop_id, "slots", {"slotKey": "count"})
    assert second.status_code == 200
    assert second.json()["outcome"] == "held_by_partner"
    assert second.json()["session"]["sharedState"]["slots"] == {"count": str(families.a1.pk)}


def test_claiming_again_is_idempotent(session, families, api):
    coop_id = session["id"]
    post(api, families.a, families.a1, coop_id, "slots", {"slotKey": "count"})
    before = CoopSession.objects.get(pk=coop_id).last_activity_at
    again = post(api, families.a, families.a1, coop_id, "slots", {"slotKey": "count"})
    assert again.json()["outcome"] == "already_held"
    assert CoopSession.objects.get(pk=coop_id).last_activity_at == before


def test_only_coop_eligible_steps_of_this_adventure_are_slots(session, families, api):
    coop_id = session["id"]
    for slot in ("done", "unknown-step", "stack"):  # COMPLETE, missing, another adventure's
        response = post(api, families.a, families.a1, coop_id, "slots", {"slotKey": slot})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "slot_invalid"


def test_another_family_cannot_claim(session, families, api):
    response = post(api, families.b, families.b1, session["id"], "slots", {"slotKey": "count"})
    assert response.status_code == 404
    assert coop.shared_state(CoopSession.objects.get(pk=session["id"]))["slots"] == {}


@pytest.mark.django_db(transaction=True)
def test_two_simultaneous_claims_have_exactly_one_winner(content_catalog, families):
    session = coop.start(
        families.a, families.a1, adventure_slug="fix-bridge", partner_child_id=families.a2.pk
    )
    barrier = threading.Barrier(2)
    results = []

    def run(child):
        try:
            barrier.wait()
            results.append(coop.claim_slot(families.a, child, session.pk, "count").outcome)
        except Exception as error:  # noqa: BLE001 - the race outcome is the assertion
            results.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(c,)) for c in (families.a1, families.a2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert sorted(results) == ["claimed", "held_by_partner"], results
    slots = coop.shared_state(CoopSession.objects.get(pk=session.pk))["slots"]
    assert list(slots) == ["count"]


# --- presence and completion ------------------------------------------------------------------


def test_presence_joins_and_leaves_without_touching_slots(session, families, api):
    coop_id = session["id"]
    post(api, families.a, families.a1, coop_id, "slots", {"slotKey": "count"})
    joined = post(api, families.a, families.a2, coop_id, "presence", {"present": True})
    assert joined.json()["sharedState"] == {
        "slots": {"count": str(families.a1.pk)},
        "presence": [str(families.a2.pk)],
    }
    post(api, families.a, families.a1, coop_id, "presence", {"present": True})
    left = post(api, families.a, families.a2, coop_id, "presence", {"present": False})
    assert left.json()["sharedState"]["presence"] == [str(families.a1.pk)]
    bad = post(api, families.a, families.a1, coop_id, "presence", {"present": "yes please"})
    assert bad.status_code == 400


def test_completion_is_idempotent_and_closes_claims(session, families, api):
    coop_id = session["id"]
    done = post(api, families.a, families.a1, coop_id, "complete")
    assert done.status_code == 200
    assert done.json()["status"] == "COMPLETED"
    completed_at = done.json()["completedAt"]
    assert completed_at
    again = post(api, families.a, families.a2, coop_id, "complete")
    assert again.json()["completedAt"] == completed_at
    claim = post(api, families.a, families.a1, coop_id, "slots", {"slotKey": "count"})
    assert claim.status_code == 409
    assert claim.json()["error"]["code"] == "coop_session_not_active"


def test_an_abandoned_session_cannot_be_completed(session, families, api):
    CoopSession.objects.filter(pk=session["id"]).update(status="ABANDONED")
    response = post(api, families.a, families.a1, session["id"], "complete")
    assert response.status_code == 409


def test_amplify_style_string_state_is_read_defensively(session, families, api):
    CoopSession.objects.filter(pk=session["id"]).update(
        shared_state='{"slots": {"count": "someone", "bad": 3}, "presence": ["x", 4]}'
    )
    body = api(families.a).get(f"{base(families.a1)}{session['id']}/").json()
    assert body["sharedState"] == {"slots": {"count": "someone"}, "presence": ["x"]}
    CoopSession.objects.filter(pk=session["id"]).update(shared_state="not json")
    body = api(families.a).get(f"{base(families.a1)}{session['id']}/").json()
    assert body["sharedState"] == {"slots": {}, "presence": []}


def test_participants_are_rows_not_a_client_list(session, families):
    assert CoopParticipant.objects.filter(coop_session_id=session["id"]).count() == 2
