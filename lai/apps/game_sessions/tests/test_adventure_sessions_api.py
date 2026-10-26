"""Step-adventure session lifecycle routes (LAI-0608), end to end through the real engine.

Every test goes through HTTP with a verified Cognito token (the `api` fixture), the real Python
engine and PostgreSQL. Nothing about an outcome is mocked.
"""

import copy
import threading
import uuid

import pytest
from django.db import connection
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, AdventureStep
from apps.catalog.tests.helpers import write_export
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.game_sessions.tests.test_answers_api import answer_catalog

pytestmark = [pytest.mark.postgres]


def lifecycle_catalog():
    """`bridge` and `planks` from the LAI-0601 tests, plus:
    `finale`: starts on a COMPLETE step, so only finalising can end it;
    `matcher`: a `matching` step, a kind with no reviewed public field list;
    `tiny-steps`: for SPROUT only."""
    collections = answer_catalog()
    adventures = collections["adventures.json"]["adventures"]
    adventures.append(
        {
            "slug": "finale",
            "title": "Finale",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "end",
            "steps": [
                {
                    "id": "end",
                    "type": "COMPLETE",
                    "objectiveIds": [],
                    "presentation": {"kind": "complete", "text": "The end"},
                    "transitions": [],
                    "fallback": {"text": "The end"},
                }
            ],
        }
    )
    adventures.append(
        {
            "slug": "matcher",
            "title": "Matcher",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "match",
            "steps": [
                {
                    "id": "match",
                    "type": "MATCHING",
                    "objectiveIds": [],
                    "presentation": {
                        "kind": "matching",
                        "prompt": "Match",
                        "pairs": [{"leftId": "a", "rightId": "1"}],
                    },
                    "transitions": [{"when": "always", "nextStepId": "complete"}],
                    "fallback": {"text": "Match"},
                }
            ],
        }
    )
    adventures.append(
        {
            "slug": "tiny-steps",
            "title": "Tiny Steps",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["SPROUT"],
            "entryStepId": "end",
            "steps": copy.deepcopy(adventures[2]["steps"]),
        }
    )
    pack = collections["islands.json"]["islands"][0]["pack"]
    pack["adventureSlugs"] = [a["slug"] for a in adventures]
    return collections


@pytest.fixture
def catalog(db, tmp_path):
    collections = lifecycle_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def base(child, adventure="bridge"):
    return f"/api/v1/children/{child.pk}/adventures/{adventure}/"


def start(client, child, adventure="bridge", body=None):
    return client.post(
        f"{base(child, adventure)}sessions/", body or {}, content_type="application/json"
    )


def read(client, child, session_id, adventure="bridge"):
    return client.get(f"{base(child, adventure)}sessions/{session_id}/")


def complete(client, child, session_id, adventure="bridge"):
    return client.post(
        f"{base(child, adventure)}sessions/{session_id}/complete/", {}, content_type="application/json"
    )


def answer(client, child, session_id, step_id, value):
    return client.post(
        f"/api/v1/children/{child.pk}/sessions/{session_id}/answers/",
        {"stepId": step_id, "answer": value, "requestId": str(uuid.uuid4())},
        content_type="application/json",
    )


def availability(client, child, adventure="bridge"):
    return client.get(f"{base(child, adventure)}availability/")


@pytest.mark.django_db
class TestStart:
    def test_a_published_adventure_starts_at_its_entry_step(self, families, api, catalog):
        response = start(api(families.a), families.a1)

        assert response.status_code == 201
        body = response.json()
        assert body["session"]["childId"] == str(families.a1.pk)
        assert body["session"]["adventureSlug"] == "bridge"
        assert body["session"]["templateVersion"] == 1
        assert body["session"]["status"] == "ACTIVE"
        assert body["session"]["currentStepId"] == "count"
        assert body["step"]["stepId"] == "count" and body["step"]["type"] == "NUMBER_INPUT"
        assert body["allowedActions"] == ["ANSWER", "HINT"]
        assert body["canComplete"] is False and body["contentCurrent"] is True
        assert body["progress"] == {"completedStepIds": []}

    def test_the_step_never_carries_answers_hints_fallbacks_or_the_path(
        self, families, api, catalog
    ):
        step = start(api(families.a), families.a1).json()["step"]

        assert step["presentation"] == {"kind": "number-input", "prompt": "How many?"}
        assert step["hintText"] is None
        assert set(step) == {"stepId", "type", "objectiveIds", "presentation", "hintText"}
        text = str(step)
        for secret in ("correctValue", "transitions", "ladder", "fallback", "It is three"):
            assert secret not in text

    def test_a_choice_step_shows_options_without_the_correct_one(self, families, api, catalog):
        step = start(api(families.a), families.a1, "planks").json()["step"]

        assert step["presentation"] == {
            "kind": "choice",
            "prompt": "Pick",
            "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
        }

    def test_starting_again_resumes_the_active_session(self, families, api, catalog):
        client = api(families.a)
        first = start(client, families.a1).json()["session"]["id"]
        responses = [start(client, families.a1) for _ in range(3)]

        assert {r.status_code for r in responses} == {200}
        assert {r.json()["session"]["id"] for r in responses} == {first}
        assert AdventureSession.objects.filter(child=families.a1).count() == 1

    def test_a_finished_adventure_can_be_played_again_without_touching_the_old_session(
        self, families, api, catalog
    ):
        client = api(families.a)
        old = start(client, families.a1, "finale").json()["session"]["id"]
        complete(client, families.a1, old, "finale")

        again = start(client, families.a1, "finale")

        assert again.status_code == 201 and again.json()["session"]["id"] != old
        assert AdventureSession.objects.get(pk=old).status == SessionStatus.COMPLETED

    def test_a_body_is_refused(self, families, api, catalog):
        response = start(api(families.a), families.a1, body={"currentStepId": "done"})
        assert response.status_code == 400
        assert not AdventureSession.objects.exists()

    @pytest.mark.parametrize("adventure", ["no-such-adventure", "treasure-rush-cove"])
    def test_an_unknown_adventure_or_a_region_id_is_not_found(
        self, families, api, catalog, adventure
    ):
        assert start(api(families.a), families.a1, adventure).status_code == 404
        assert availability(api(families.a), families.a1, adventure).status_code == 404

    def test_an_inactive_adventure_is_not_found(self, families, api, catalog):
        Adventure.objects.filter(slug="bridge").update(active=False)
        assert start(api(families.a), families.a1).status_code == 404
        assert availability(api(families.a), families.a1).status_code == 404

    def test_an_adventure_dropped_from_the_latest_release_is_not_found(
        self, families, api, catalog, tmp_path
    ):
        collections = copy.deepcopy(catalog)
        collections["adventures.json"]["adventures"] = [
            a for a in collections["adventures.json"]["adventures"] if a["slug"] != "planks"
        ]
        pack = collections["islands.json"]["islands"][0]["pack"]
        pack["adventureSlugs"] = [s for s in pack["adventureSlugs"] if s != "planks"]
        import_content(write_export(tmp_path / "v2", collections))

        assert start(api(families.a), families.a1, "planks").status_code == 404
        assert start(api(families.a), families.a1, "bridge").status_code == 201

    def test_an_adventure_for_another_age_band_is_not_found(self, families, api, catalog):
        assert start(api(families.a), families.a1, "tiny-steps").status_code == 404

    def test_an_unsupported_step_kind_makes_the_adventure_unavailable(
        self, families, api, catalog
    ):
        body = availability(api(families.a), families.a1, "matcher").json()
        response = start(api(families.a), families.a1, "matcher")

        assert body["available"] is False and body["reasons"] == ["UNSUPPORTED_STEP_KIND"]
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "adventure_unavailable"
        assert not AdventureSession.objects.exists()

    def test_missing_entry_content_makes_the_adventure_unavailable(self, families, api, catalog):
        AdventureStep.objects.filter(adventure__slug="bridge", step_id="count").delete()

        assert availability(api(families.a), families.a1).json()["reasons"] == [
            "CONTENT_INCOMPLETE"
        ]
        assert start(api(families.a), families.a1).status_code == 409

    def test_a_turned_off_child_cannot_start(self, families, api, catalog):
        families.a1.active = False
        families.a1.save(update_fields=["active"])

        response = start(api(families.a), families.a1)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "child_inactive"
        assert "CHILD_INACTIVE" in availability(api(families.a), families.a1).json()["reasons"]


@pytest.mark.django_db
class TestAvailability:
    def test_reports_status_and_the_session_to_resume(self, families, api, catalog):
        client = api(families.a)
        assert availability(client, families.a1).json() == {
            "adventureId": "bridge",
            "available": True,
            "reasons": [],
            "status": "AVAILABLE",
            "resumeSessionId": None,
        }
        session_id = start(client, families.a1).json()["session"]["id"]

        body = availability(client, families.a1).json()

        assert (body["status"], body["resumeSessionId"]) == ("IN_PROGRESS", session_id)

    def test_is_read_only(self, families, api, catalog):
        availability(api(families.a), families.a1)
        assert not AdventureSession.objects.exists()


@pytest.mark.django_db
class TestLifecycle:
    def test_start_read_answer_continue_and_finish_through_the_engine(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        started = start(client, child).json()
        session_id = started["session"]["id"]
        assert read(client, child, session_id).json() == started

        assert answer(client, child, session_id, "count", {"kind": "number-input", "value": 3}).json()[
            "nextStepId"
        ] == "tell"
        after = read(client, child, session_id).json()
        assert after["session"]["currentStepId"] == "tell"
        assert after["step"]["presentation"] == {
            "kind": "narrative",
            "speaker": "Pip",
            "text": "Well done",
        }
        assert after["progress"]["completedStepIds"] == ["count"]

        # The narrative step leads to a COMPLETE step: the answer route completes the session.
        assert answer(client, child, session_id, "tell", {"kind": "narrative"}).status_code == 200
        finished = read(client, child, session_id).json()
        assert finished["session"]["status"] == "COMPLETED"
        assert finished["session"]["completedAt"] is not None
        assert finished["step"] is None and finished["allowedActions"] == []
        assert finished["progress"]["completedStepIds"] == ["count", "tell"]

        # A late completion request (the client's own "finish" call) changes nothing.
        late = complete(client, child, session_id)
        assert late.status_code == 200
        assert late.json()["session"]["completedAt"] == finished["session"]["completedAt"]

    def test_a_completed_session_stays_readable_and_takes_no_more_answers(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        session_id = start(client, child, "planks").json()["session"]["id"]
        answer(client, child, session_id, "pick", {"kind": "choice", "optionId": "b"})

        response = answer(client, child, session_id, "pick", {"kind": "choice", "optionId": "b"})

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "session_not_active"
        assert read(client, child, session_id, "planks").json()["session"]["status"] == "COMPLETED"

    def test_a_hint_shows_only_the_rung_the_child_has_reached(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child).json()["session"]["id"]
        client.post(
            f"/api/v1/children/{child.pk}/sessions/{session_id}/hints/",
            {"stepId": "count", "fromLevel": 0},
            content_type="application/json",
        )

        step = read(client, child, session_id).json()["step"]

        assert step["hintText"] == "Look again"
        assert "Count the planks" not in str(step)

    def test_reading_never_creates_or_changes_a_session(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child).json()["session"]["id"]
        before = AdventureSession.objects.get(pk=session_id).last_activity_at

        for _ in range(2):
            read(client, child, session_id)

        assert AdventureSession.objects.count() == 1
        assert AdventureSession.objects.get(pk=session_id).last_activity_at == before
        assert read(client, child, uuid.uuid4()).status_code == 404


@pytest.mark.django_db
class TestCompletion:
    def test_finishing_before_the_end_is_refused(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id = start(client, child).json()["session"]["id"]

        response = complete(client, child, session_id)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "session_not_complete"
        assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.ACTIVE

    def test_a_session_at_its_complete_step_is_finalised_once(self, families, api, catalog):
        client, child = api(families.a), families.a1
        started = start(client, child, "finale").json()
        assert started["canComplete"] is True and started["allowedActions"] == ["COMPLETE"]
        session_id = started["session"]["id"]

        first = complete(client, child, session_id, "finale")
        second = complete(client, child, session_id, "finale")

        assert first.status_code == second.status_code == 200
        assert first.json()["session"]["status"] == "COMPLETED"
        assert first.json()["session"]["completedAt"] == second.json()["session"]["completedAt"]
        assert first.json()["canComplete"] is False

    def test_completing_through_another_adventure_s_route_is_not_found(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        session_id = start(client, child, "finale").json()["session"]["id"]
        assert complete(client, child, session_id, "bridge").status_code == 404
        assert read(client, child, session_id, "bridge").status_code == 404


@pytest.mark.django_db
class TestContentVersion:
    def test_a_session_never_switches_to_newer_content(self, families, api, catalog, tmp_path):
        client, child = api(families.a), families.a1
        session_id = start(client, child).json()["session"]["id"]
        newer = copy.deepcopy(catalog)
        newer["adventures.json"]["adventures"][0]["version"] = 2
        import_content(write_export(tmp_path / "v2", newer))

        body = read(client, child, session_id).json()
        restart = start(client, child)

        assert body["session"]["templateVersion"] == 1
        assert body["contentCurrent"] is False
        assert body["step"] is None and body["allowedActions"] == []
        assert restart.status_code == 409
        assert restart.json()["error"]["code"] == "content_version_changed"
        assert "ACTIVE_SESSION_CONTENT_CHANGED" in availability(client, child).json()["reasons"]
        assert answer(client, child, session_id, "count", {"kind": "number-input", "value": 3}).json()[
            "error"
        ]["code"] == "content_version_changed"


@pytest.mark.django_db
class TestIsolation:
    def test_another_family_cannot_start_read_or_complete(self, families, api, catalog):
        session_id = start(api(families.a), families.a1, "finale").json()["session"]["id"]
        other = api(families.b)

        assert start(other, families.a1).status_code == 404
        assert availability(other, families.a1).status_code == 404
        assert read(other, families.a1, session_id, "finale").status_code == 404
        assert complete(other, families.a1, session_id, "finale").status_code == 404
        # Their own child's id does not unlock someone else's session either.
        assert read(other, families.b1, session_id, "finale").status_code == 404
        assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.ACTIVE

    def test_a_sibling_s_session_is_not_reachable_through_the_other_child(
        self, families, api, catalog
    ):
        client = api(families.a)
        session_id = start(client, families.a1, "finale").json()["session"]["id"]
        assert read(client, families.a2, session_id, "finale").status_code == 404
        assert complete(client, families.a2, session_id, "finale").status_code == 404

    def test_an_unknown_child_id_is_not_found(self, families, api, catalog):
        url = f"/api/v1/children/{uuid.uuid4()}/adventures/bridge/sessions/"
        assert api(families.a).post(url, {}, content_type="application/json").status_code == 404
        assert api(families.a).get("/api/v1/children/not-a-uuid/adventures/bridge/availability/").status_code == 404


@pytest.mark.django_db
class TestAuthentication:
    def test_no_token_is_401(self, families, catalog):
        response = start(Client(), families.a1)
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "not_authenticated"

    def test_a_bad_token_is_401(self, families, api, catalog):
        response = start(api(token="not-a-jwt"), families.a1)
        assert response.status_code == 401
        assert not AdventureSession.objects.exists()

    def test_an_unprovisioned_parent_is_403(self, families, api, catalog):
        response = start(api("sub-never-provisioned"), families.a1)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "account_not_provisioned"


@pytest.mark.django_db
def test_a_region_session_is_not_a_step_session(families, api, treasure):
    """Treasure Rush's region sessions keep their own lifecycle routes (TR-5)."""
    from apps.game_sessions.play import start_or_resume_region_session

    session, _ = start_or_resume_region_session(families.a1, treasure.region)
    client = api(families.a)
    adventure = Adventure.objects.values_list("slug", flat=True).first()
    assert adventure is not None  # the catalog has a step adventure to aim at
    assert read(client, families.a1, session.pk, adventure).status_code == 404
    assert complete(client, families.a1, session.pk, adventure).status_code == 404
    assert AdventureSession.objects.get(pk=session.pk).status == session.status


@pytest.mark.django_db(transaction=True)
def test_simultaneous_starts_create_one_session(families, api, catalog, token_for):
    barrier = threading.Barrier(4)
    token = token_for(families.a.cognito_sub)
    results = []

    def run():
        client = Client()
        client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        try:
            barrier.wait()
            response = start(client, families.a1)
            results.append((response.status_code, response.json()["session"]["id"]))
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert len(results) == 4
    assert sorted(status for status, _ in results).count(201) == 1
    assert len({session_id for _, session_id in results}) == 1
    assert AdventureSession.objects.filter(child=families.a1).count() == 1
