import threading
import uuid

import pytest
from django.db import connection

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure
from apps.catalog.tests.helpers import base_collections, write_export
from apps.game_sessions import services
from apps.game_sessions.models import AdventureAction, AdventureSession, SessionStatus
from apps.users.tests.helpers import access_claims

pytestmark = [pytest.mark.postgres]

LADDER = ["Look again", "Count the planks", "It is three"]


def answer_catalog():
    """`bridge`: a hinted count step, a narrative step, a COMPLETE step. `planks`: one choice
    step that ends on the reserved `complete` id."""
    collections = base_collections()
    collections["adventures.json"]["adventures"] = [
        {
            "slug": "bridge",
            "title": "Bridge",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "count",
            "steps": [
                {
                    "id": "count",
                    "type": "NUMBER_INPUT",
                    "objectiveIds": ["count-10"],
                    "presentation": {
                        "kind": "number-input",
                        "prompt": "How many?",
                        "correctValue": 3,
                    },
                    "transitions": [
                        {"when": "correct", "nextStepId": "tell"},
                        {"when": "incorrect", "nextStepId": "tell"},
                    ],
                    "hintPolicy": {"ladder": LADDER},
                    "fallback": {"text": "Count"},
                },
                {
                    "id": "tell",
                    "type": "NARRATIVE",
                    "objectiveIds": [],
                    "presentation": {"kind": "narrative", "speaker": "Pip", "text": "Well done"},
                    "transitions": [{"when": "always", "nextStepId": "done"}],
                    "fallback": {"text": "Hi"},
                },
                {
                    "id": "done",
                    "type": "COMPLETE",
                    "objectiveIds": [],
                    "presentation": {"kind": "complete", "text": "Done"},
                    "transitions": [],
                    "fallback": {"text": "Done"},
                },
            ],
        },
        {
            "slug": "planks",
            "title": "Planks",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "pick",
            "steps": [
                {
                    "id": "pick",
                    "type": "CHOICE",
                    "objectiveIds": [],
                    "presentation": {
                        "kind": "choice",
                        "prompt": "Pick",
                        "correctOptionId": "b",
                        "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
                    },
                    "transitions": [{"when": "always", "nextStepId": "complete"}],
                    "fallback": {"text": "Pick"},
                },
            ],
        },
    ]
    collections["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["bridge", "planks"]
    collections["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = (
        "bridge"
    )
    return collections


@pytest.fixture
def catalog(db, tmp_path):
    collections = answer_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def url(child, session, kind="answers"):
    return f"/api/v1/children/{child.pk}/sessions/{session.pk}/{kind}/"


def post(client, child, session, body, kind="answers"):
    return client.post(url(child, session, kind), body, content_type="application/json")


def answer(step, value, request_id=None):
    return {"stepId": step, "answer": value, "requestId": str(request_id or uuid.uuid4())}


def count(n):
    return {"kind": "number-input", "value": n}


def start(child, slug="bridge"):
    return services.start_or_resume_session(child, Adventure.objects.get(slug=slug))[0]


@pytest.mark.django_db
class TestGrading:
    def test_a_correct_answer_advances_with_the_lambda_response_shape(self, families, api, catalog):
        session = start(families.a1)
        response = post(api(families.a), families.a1, session, answer("count", count(3)))

        assert response.status_code == 200
        body = response.json()
        assert {k: body[k] for k in ("correctness", "supportLevel", "action", "nextStepId")} == {
            "correctness": "CORRECT",
            "supportLevel": 0,
            "action": "ADVANCE",
            "nextStepId": "tell",
        }
        assert (body["attemptNumber"], body["replayed"]) == (1, False)
        assert body["session"]["currentStepId"] == "tell" and body["session"]["status"] == "ACTIVE"

    def test_a_wrong_answer_on_a_hinted_step_retries_and_the_server_escalates_the_hint(
        self, families, api, catalog
    ):
        session = start(families.a1)
        body = post(api(families.a), families.a1, session, answer("count", count(9))).json()

        assert (body["correctness"], body["action"], body["supportLevel"]) == (
            "INCORRECT",
            "RETRY",
            1,
        )
        assert body["nextStepId"] is None
        assert body["session"]["currentStepId"] == "count" and body["session"]["hintLevel"] == 1

    def test_client_supplied_correctness_hint_level_and_next_step_are_ignored(
        self, families, api, catalog
    ):
        session = start(families.a1)
        forged = {
            **answer("count", count(9)),
            "hintLevel": 4,
            "correctness": "CORRECT",
            "nextStepId": "done",
            "completed": True,
        }

        body = post(api(families.a), families.a1, session, forged).json()

        assert (body["correctness"], body["action"], body["supportLevel"]) == (
            "INCORRECT",
            "RETRY",
            1,
        )
        session.refresh_from_db()
        assert session.status == SessionStatus.ACTIVE and session.current_step_id == "count"

    def test_guided_completion_after_four_server_hints_carries_the_child_forward(
        self, families, api, catalog
    ):
        session = start(families.a1)
        client = api(families.a)
        for level in range(4):
            hint = post(
                client, families.a1, session, {"stepId": "count", "fromLevel": level}, "hints"
            )
            assert hint.json()["hintLevel"] == level + 1
        assert hint.json()["hintText"] == LADDER[-1]

        body = post(client, families.a1, session, answer("count", count(9))).json()

        assert (body["correctness"], body["supportLevel"], body["action"]) == (
            "CORRECT",
            5,
            "ADVANCE",
        )
        assert body["nextStepId"] == "tell"

    def test_a_retried_hint_request_does_not_escalate_twice(self, families, api, catalog):
        session = start(families.a1)
        client = api(families.a)
        first = post(client, families.a1, session, {"stepId": "count", "fromLevel": 0}, "hints")
        again = post(client, families.a1, session, {"stepId": "count", "fromLevel": 0}, "hints")
        assert first.json()["hintLevel"] == again.json()["hintLevel"] == 1
        assert first.json()["hintText"] == LADDER[0]

    def test_reaching_a_complete_step_completes_the_session_in_the_same_request(
        self, families, api, catalog
    ):
        session = start(families.a1)
        client = api(families.a)
        post(client, families.a1, session, answer("count", count(3)))

        body = post(client, families.a1, session, answer("tell", {"kind": "narrative"})).json()

        assert (body["correctness"], body["nextStepId"]) == ("NOT_APPLICABLE", "done")
        assert body["session"]["status"] == "COMPLETED" and body["session"]["completedAt"]

    def test_the_reserved_complete_id_completes_the_session(self, families, api, catalog):
        session = start(families.a1, "planks")
        body = post(
            api(families.a),
            families.a1,
            session,
            answer("pick", {"kind": "choice", "optionId": "a"}),
        ).json()
        assert body["nextStepId"] == "complete" and body["session"]["status"] == "COMPLETED"


@pytest.mark.django_db
class TestRejectedSubmissions:
    def test_an_answer_for_a_step_that_is_not_current_is_refused_and_writes_nothing(
        self, families, api, catalog
    ):
        session = start(families.a1)
        response = post(
            api(families.a), families.a1, session, answer("tell", {"kind": "narrative"})
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "step_not_current"
        assert AdventureAction.objects.count() == 0

    def test_a_completed_session_takes_no_more_answers(self, families, api, catalog):
        session = start(families.a1, "planks")
        client = api(families.a)
        post(client, families.a1, session, answer("pick", {"kind": "choice", "optionId": "b"}))
        response = post(
            client, families.a1, session, answer("pick", {"kind": "choice", "optionId": "b"})
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "session_not_active"

    @pytest.mark.parametrize(
        "bad",
        [
            {"kind": "number-input", "value": "3"},
            {"kind": "number-input", "value": True},
            {"kind": "choice", "optionId": "a"},  # the wrong kind for a number step
            {"kind": "complete"},
            "3",
            {"kind": "ordering", "order": ["a" * 300]},  # longer than any stored answer
        ],
    )
    def test_an_answer_that_cannot_be_graded_is_a_400(self, families, api, catalog, bad):
        session = start(families.a1)
        response = post(api(families.a), families.a1, session, answer("count", bad))
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "answer_invalid"
        assert AdventureAction.objects.count() == 0

    @pytest.mark.parametrize("missing", ["stepId", "answer", "requestId"])
    def test_every_field_is_required(self, families, api, catalog, missing):
        session = start(families.a1)
        body = answer("count", count(3))
        del body[missing]
        response = post(api(families.a), families.a1, session, body)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.django_db
class TestRetriesAndReplays:
    def test_the_same_request_id_replays_the_stored_outcome_without_a_second_effect(
        self, families, api, catalog
    ):
        session = start(families.a1)
        client = api(families.a)
        request_id = uuid.uuid4()
        first = post(client, families.a1, session, answer("count", count(9), request_id)).json()
        again = post(client, families.a1, session, answer("count", count(9), request_id)).json()

        assert again["replayed"] is True
        assert {
            k: again[k] for k in ("correctness", "supportLevel", "action", "attemptNumber")
        } == {k: first[k] for k in ("correctness", "supportLevel", "action", "attemptNumber")}
        assert AdventureAction.objects.count() == 1
        assert again["session"]["hintLevel"] == 1

    def test_a_replay_after_the_session_moved_on_still_returns_the_original_outcome(
        self, families, api, catalog
    ):
        session = start(families.a1)
        client = api(families.a)
        request_id = uuid.uuid4()
        post(client, families.a1, session, answer("count", count(3), request_id))
        again = post(client, families.a1, session, answer("count", count(3), request_id)).json()
        assert (again["replayed"], again["nextStepId"]) == (True, "tell")
        assert again["session"]["currentStepId"] == "tell"

    def test_a_new_request_after_success_is_refused_because_the_step_moved(
        self, families, api, catalog
    ):
        session = start(families.a1)
        client = api(families.a)
        post(client, families.a1, session, answer("count", count(3)))
        response = post(client, families.a1, session, answer("count", count(3)))
        assert response.json()["error"]["code"] == "step_not_current"
        assert AdventureAction.objects.count() == 1

    def test_a_request_id_reused_for_another_answer_is_a_conflict(self, families, api, catalog):
        session = start(families.a1)
        client = api(families.a)
        request_id = uuid.uuid4()
        post(client, families.a1, session, answer("count", count(9), request_id))
        response = post(client, families.a1, session, answer("count", count(3), request_id))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "request_conflict"


@pytest.mark.django_db
class TestAuthorization:
    def test_an_unauthenticated_request_is_401_and_writes_nothing(self, families, api, catalog):
        session = start(families.a1)
        response = post(api(), families.a1, session, answer("count", count(3)))
        assert response.status_code == 401
        assert AdventureAction.objects.count() == 0

    def test_an_unprovisioned_identity_is_403(self, families, api, catalog):
        session = start(families.a1)
        response = post(api("sub-nobody"), families.a1, session, answer("count", count(3)))
        assert response.status_code == 403

    @pytest.mark.parametrize("kind", ["answers", "hints"])
    def test_another_familys_child_and_a_siblings_session_are_both_not_found(
        self, families, api, catalog, kind
    ):
        session = start(families.a1)
        body = (
            answer("count", count(3)) if kind == "answers" else {"stepId": "count", "fromLevel": 0}
        )
        other_family = post(api(families.b), families.a1, session, body, kind)
        siblings_session = post(api(families.a), families.a2, session, body, kind)
        unknown = post(
            api(families.a), families.a1, type("S", (), {"pk": uuid.uuid4()}), body, kind
        )

        assert (
            other_family.status_code == siblings_session.status_code == unknown.status_code == 404
        )
        assert other_family.json()["error"] == unknown.json()["error"]
        session.refresh_from_db()
        assert session.current_step_id == "count" and session.hint_levels == {}

    def test_an_admin_group_token_gets_no_access_to_another_family(
        self, families, api, cognito, catalog
    ):
        session = start(families.b1)
        token = cognito.sign(
            access_claims(families.a.cognito_sub, **{"cognito:groups": ["Admins"]})
        )
        response = post(api(token=token), families.b1, session, answer("count", count(3)))
        assert response.status_code == 404
        assert AdventureAction.objects.count() == 0


@pytest.mark.django_db
class TestContentVersions:
    def test_a_session_started_on_an_older_adventure_version_is_not_graded(
        self, families, api, catalog, tmp_path
    ):
        session = start(families.a1)
        newer = answer_catalog()
        newer["adventures.json"]["adventures"][0]["version"] = 2
        import_content(write_export(tmp_path / "v2", newer))

        response = post(api(families.a), families.a1, session, answer("count", count(3)))

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "content_version_changed"
        session.refresh_from_db()
        assert session.current_step_id == "count" and session.status == SessionStatus.ACTIVE

    def test_a_step_dropped_without_a_version_bump_is_not_graded(
        self, families, api, catalog, tmp_path
    ):
        session = start(families.a1)
        changed = answer_catalog()
        steps = changed["adventures.json"]["adventures"][0]["steps"]
        steps[0]["id"] = "count-again"
        changed["adventures.json"]["adventures"][0]["entryStepId"] = "count-again"
        import_content(write_export(tmp_path / "v2", changed))

        response = post(api(families.a), families.a1, session, answer("count", count(3)))
        assert response.json()["error"]["code"] == "content_version_changed"

    def test_an_unchanged_adventure_keeps_grading_across_a_new_release(
        self, families, api, catalog, tmp_path
    ):
        session = start(families.a1)
        changed = answer_catalog()
        changed["locations.json"]["locations"][0]["title"] = "A New Name"
        import_content(write_export(tmp_path / "v2", changed))

        response = post(api(families.a), families.a1, session, answer("count", count(3)))
        assert response.status_code == 200


@pytest.mark.django_db
def test_a_failure_while_completing_rolls_back_the_attempt_too(families, api, catalog, monkeypatch):
    session = start(families.a1, "planks")

    def broken_complete(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(services, "_complete", broken_complete)
    with pytest.raises(RuntimeError):
        services.submit_answer(
            families.a1,
            session.pk,
            step_id="pick",
            answer={"kind": "choice", "optionId": "b"},
            request_id=uuid.uuid4(),
        )

    session.refresh_from_db()
    assert session.current_step_id == "pick" and session.status == SessionStatus.ACTIVE
    assert AdventureAction.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_concurrent_submissions_are_serialised_and_a_duplicate_request_applies_once(
    families, catalog
):
    session = start(families.a1)
    outcomes, errors = [], []
    barrier = threading.Barrier(3)
    shared_id = uuid.uuid4()

    def submit(request_id):
        try:
            barrier.wait()
            outcomes.append(
                services.submit_answer(
                    families.a1, session.pk, step_id="count", answer=count(9), request_id=request_id
                )
            )
        except Exception as error:  # surfaced through `errors`
            errors.append(error)
        finally:
            connection.close()

    threads = [
        threading.Thread(target=submit, args=(rid,)) for rid in (uuid.uuid4(), shared_id, shared_id)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert sorted(o.replayed for o in outcomes) == [False, False, True]
    actions = AdventureAction.objects.filter(session=session).order_by("attempt_number")
    assert [a.attempt_number for a in actions] == [1, 2]
    assert [a.hint_level for a in actions] == [1, 2]  # each retry escalated from the last
    assert AdventureSession.objects.get(pk=session.pk).hint_levels == {"count": 2}
