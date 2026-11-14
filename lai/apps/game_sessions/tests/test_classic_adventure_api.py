"""Classic step-based adventures outside a 3D Area (AMP-03): start or resume, list, actions,
availability, and the world change a WORLD_CHANGE step owes. Real content export, two families."""

import uuid

import pytest

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, Location
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.progression.models import WorldChange

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SLUG = "the-dark-lighthouse-counting"  # Pathfinder; narrative, choice, world change, complete


@pytest.fixture
def content(families):
    import_content()
    return families


def child_url(child, rest: str) -> str:
    return f"/api/v1/children/{child.pk}/{rest}"


def start(client, child, slug=SLUG):
    return client.post(child_url(child, f"adventures/{slug}/session/"), {}, "application/json")


def answer(client, child, session_id, step_id, payload):
    return client.post(
        child_url(child, f"sessions/{session_id}/answers/"),
        {"stepId": step_id, "answer": payload, "requestId": str(uuid.uuid4())},
        "application/json",
    )


def test_start_then_resume_returns_the_one_active_session(content, api):
    client = api(content.a)
    first = start(client, content.a1)
    assert first.status_code == 201
    body = first.json()
    assert body["adventureSlug"] == SLUG
    assert body["status"] == "ACTIVE"
    assert body["currentStepId"] == "the-lamp-is-dark"
    assert body["locationSlug"] == "clockwork-harbor"
    again = start(client, content.a1)
    assert again.status_code == 200
    assert again.json()["id"] == body["id"]
    active = client.get(child_url(content.a1, f"adventures/{SLUG}/session/")).json()
    assert active["session"]["id"] == body["id"]


def test_no_active_session_reads_as_null(content, api):
    response = api(content.a).get(child_url(content.a1, f"adventures/{SLUG}/session/"))
    assert response.json() == {"session": None}


def test_unknown_adventure_is_not_found(content, api):
    assert start(api(content.a), content.a1, "no-such-adventure").status_code == 404


def test_an_adventure_taken_out_of_play_cannot_start(content, api):
    Adventure.objects.filter(slug=SLUG).update(active=False)
    response = start(api(content.a), content.a1)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "content_unavailable"
    Adventure.objects.filter(slug=SLUG).update(active=True)
    Location.objects.filter(slug="clockwork-harbor").update(active=False)
    assert start(api(content.a), content.a1).status_code == 409


def test_a_request_body_is_refused(content, api):
    response = api(content.a).post(
        child_url(content.a1, f"adventures/{SLUG}/session/"),
        {"currentStepId": "chapter-one-done"},
        "application/json",
    )
    assert response.status_code == 400


def test_another_familys_child_cannot_start_list_or_read(content, api):
    client = api(content.a)
    assert start(client, content.b1).status_code == 404
    assert client.get(child_url(content.b1, "sessions/")).status_code == 404
    assert client.get(child_url(content.b1, "adventure-actions/")).status_code == 404
    assert client.get(child_url(content.b1, "availability/")).status_code == 404
    assert not AdventureSession.objects.filter(child=content.b1).exists()


def test_playing_through_records_the_world_change_and_completes_on_the_server(content, api):
    client = api(content.a)
    session_id = start(client, content.a1).json()["id"]
    assert (
        answer(client, content.a1, session_id, "the-lamp-is-dark", {"kind": "narrative"}).json()[
            "nextStepId"
        ]
        == "count-the-slots"
    )
    wrong = answer(
        client, content.a1, session_id, "count-the-slots", {"kind": "choice", "optionId": "two"}
    ).json()
    assert wrong["correctness"] == "INCORRECT"
    right = answer(
        client, content.a1, session_id, "count-the-slots", {"kind": "choice", "optionId": "three"}
    ).json()
    assert right["nextStepId"] == "the-lighthouse-turns"
    assert not WorldChange.objects.filter(child=content.a1).exists()

    done = answer(
        client, content.a1, session_id, "the-lighthouse-turns", {"kind": "world-change"}
    ).json()
    assert done["session"]["status"] == "COMPLETED"
    change = WorldChange.objects.get(child=content.a1)
    assert (change.location_slug, change.change_key) == (
        "clockwork-harbor",
        "CLOCKWORK_LIGHTHOUSE_FIXED",
    )
    assert change.source_session_id == session_id
    assert not WorldChange.objects.filter(child=content.a2).exists()

    # Playing it again records nothing twice.
    second = start(client, content.a1).json()
    assert second["id"] != session_id
    answer(client, content.a1, second["id"], "the-lamp-is-dark", {"kind": "narrative"})
    answer(
        client,
        content.a1,
        second["id"],
        "count-the-slots",
        {"kind": "choice", "optionId": "three"},
    )
    answer(client, content.a1, second["id"], "the-lighthouse-turns", {"kind": "world-change"})
    assert WorldChange.objects.filter(child=content.a1).count() == 1

    listed = client.get(child_url(content.a1, "sessions/")).json()["sessions"]
    assert {s["id"] for s in listed} == {session_id, second["id"]}
    assert all(s["status"] == SessionStatus.COMPLETED for s in listed)

    actions = client.get(child_url(content.a1, "adventure-actions/")).json()["actions"]
    mine = [a for a in actions if a["sessionId"] == session_id]
    assert [a["correctness"] for a in sorted(mine, key=lambda a: a["createdAt"])] == [
        "NOT_APPLICABLE",
        "INCORRECT",
        "CORRECT",
        "NOT_APPLICABLE",
    ]
    # The short form of each structured answer, never the stored JSON or free text.
    assert [a["normalizedAnswer"] for a in sorted(mine, key=lambda a: a["createdAt"])] == [
        None,
        "two",
        "three",
        None,
    ]
    assert api(content.b).get(child_url(content.b1, "sessions/")).json() == {"sessions": []}


def test_availability_lists_flags_including_what_is_out_of_play(content, api):
    Adventure.objects.filter(slug=SLUG).update(active=False)
    body = api(content.a).get(child_url(content.a1, "availability/")).json()
    adventures = {a["slug"]: a for a in body["adventures"]}
    assert adventures[SLUG] == {"slug": SLUG, "placeSlug": "clockwork-harbor", "active": False}
    places = {p["slug"]: p["active"] for p in body["places"]}
    assert places["clockwork-harbor"] is True
