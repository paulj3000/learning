"""Server-authoritative mastery from step-adventure answers (LAI-0603).

Through HTTP with a verified Cognito token, the real Python engine and PostgreSQL. The counters
are the golden-vector port (`apps.education.mastery`); these tests pin when evidence is recorded
and that it is recorded exactly once.
"""

import threading
import uuid
from types import SimpleNamespace

import pytest
from django.db import connection
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.tests.helpers import base_collections, write_export
from apps.education.models import SkillEvidence, SkillProgress
from apps.game_sessions.models import AdventureAction, AdventureSession, SessionStatus

pytestmark = [pytest.mark.postgres]

LADDER = ["one", "two", "three", "four", "five"]


def mastery_catalog():
    """`sums`: `add` (NUMBER_INPUT, add-10, hinted), `pick` (CHOICE, count-10 and add-10),
    `tell` (NARRATIVE tagged count-10: ungraded), `odd` (CHOICE tagged with an objective the
    catalog does not hold, plus a duplicate), then COMPLETE. `quick`: one CHOICE on add-10 that
    ends at the reserved `complete` id."""
    collections = base_collections()
    collections["adventures.json"]["learningObjectives"] = [
        {"code": "add-10", "domain": "numeracy", "title": "Adding within ten"},
        {"code": "count-10", "domain": "numeracy", "title": "Counting to ten"},
    ]
    choice = {
        "kind": "choice",
        "prompt": "Pick",
        "correctOptionId": "b",
        "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
    }
    collections["adventures.json"]["adventures"] = [
        {
            "slug": "sums",
            "title": "Sums",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "add",
            "steps": [
                {
                    "id": "add",
                    "type": "NUMBER_INPUT",
                    "objectiveIds": ["add-10"],
                    "presentation": {"kind": "number-input", "prompt": "2+2?", "correctValue": 4},
                    "transitions": [{"when": "correct", "nextStepId": "pick"}],
                    "hintPolicy": {"ladder": LADDER},
                    "fallback": {"text": "Four"},
                },
                {
                    "id": "pick",
                    "type": "CHOICE",
                    "objectiveIds": ["count-10", "add-10"],
                    "presentation": choice,
                    "transitions": [{"when": "always", "nextStepId": "tell"}],
                    "fallback": {"text": "B"},
                },
                {
                    "id": "tell",
                    "type": "NARRATIVE",
                    "objectiveIds": ["count-10"],
                    "presentation": {"kind": "narrative", "speaker": "Pip", "text": "Well done"},
                    "transitions": [{"when": "always", "nextStepId": "odd"}],
                    "fallback": {"text": "Hi"},
                },
                {
                    "id": "odd",
                    "type": "CHOICE",
                    "objectiveIds": ["not-in-the-catalog", "count-10", "count-10"],
                    "presentation": choice,
                    "transitions": [{"when": "always", "nextStepId": "done"}],
                    "fallback": {"text": "B"},
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
            "slug": "quick",
            "title": "Quick",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "pick",
            "steps": [
                {
                    "id": "pick",
                    "type": "CHOICE",
                    "objectiveIds": ["add-10"],
                    "presentation": choice,
                    "transitions": [{"when": "always", "nextStepId": "complete"}],
                    "fallback": {"text": "B"},
                },
            ],
        },
    ]
    collections["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["sums", "quick"]
    collections["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = "sums"
    return collections


@pytest.fixture
def catalog(db, tmp_path):
    import_content(write_export(tmp_path / "v1", mastery_catalog()))


def start(client, child, adventure="sums"):
    response = client.post(
        f"/api/v1/children/{child.pk}/adventures/{adventure}/sessions/",
        {},
        content_type="application/json",
    )
    assert response.status_code in (200, 201), response.content
    return response.json()["session"]["id"]


def answer(client, child, session_id, step_id, value, request_id=None):
    return client.post(
        f"/api/v1/children/{child.pk}/sessions/{session_id}/answers/",
        {"stepId": step_id, "answer": value, "requestId": str(request_id or uuid.uuid4())},
        content_type="application/json",
    )


def number(n):
    return {"kind": "number-input", "value": n}


def pick(option="b"):
    return {"kind": "choice", "optionId": option}


def progress_of(child, code):
    return SkillProgress.objects.filter(child=child, learning_objective_code=code).first()


def mastery(client, child, objective=None):
    suffix = f"{objective}/" if objective else ""
    return client.get(f"/api/v1/children/{child.pk}/mastery/{suffix}")


def play(families, api):
    return SimpleNamespace(client=api(families.a), child=families.a1)


@pytest.mark.django_db
class TestEvidenceFromAnswers:
    def test_an_independent_correct_answer_is_one_piece_of_evidence(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)

        response = answer(p.client, p.child, session_id, "add", number(4))

        assert response.status_code == 200
        [evidence] = SkillEvidence.objects.filter(child=p.child)
        assert (evidence.learning_objective_code, evidence.result, evidence.support_level) == (
            "add-10",
            "CORRECT",
            0,
        )
        assert evidence.evidence_type == "NUMBER_INPUT"
        assert evidence.adventure_action.step_id == "add"
        row = progress_of(p.child, "add-10")
        assert (row.exposure_count, row.independent_success_count, row.supported_success_count) == (
            1,
            1,
            0,
        )
        assert row.consecutive_independent_correct == 1
        assert (row.recent_level, row.error_pattern) == ("DEVELOPING", "NONE")

    def test_a_wrong_answer_that_retries_is_not_evidence_yet(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)

        body = answer(p.client, p.child, session_id, "add", number(9)).json()

        assert body["action"] == "RETRY"
        assert not SkillEvidence.objects.exists() and not SkillProgress.objects.exists()

    def test_the_step_s_final_outcome_counts_once_with_the_hints_it_took(
        self, families, api, catalog
    ):
        p = play(families, api)
        session_id = start(p.client, p.child)
        for _ in range(2):
            answer(p.client, p.child, session_id, "add", number(9))

        answer(p.client, p.child, session_id, "add", number(4))

        [evidence] = SkillEvidence.objects.filter(child=p.child)
        assert (evidence.result, evidence.support_level) == ("CORRECT", 2)
        row = progress_of(p.child, "add-10")
        assert (row.exposure_count, row.independent_success_count, row.supported_success_count) == (
            1,
            0,
            1,
        )
        assert row.consecutive_independent_correct == 0
        assert row.recent_level == "INTRODUCED"
        assert AdventureAction.objects.filter(step_id="add").count() == 3

    def test_guided_completion_is_a_supported_success_not_an_independent_one(
        self, families, api, catalog
    ):
        p = play(families, api)
        session_id = start(p.client, p.child)
        for _ in range(5):  # the engine's ladder tops out at 5: guided completion
            body = answer(p.client, p.child, session_id, "add", number(9)).json()

        assert body["action"] == "ADVANCE" and body["supportLevel"] == 5
        row = progress_of(p.child, "add-10")
        assert (row.independent_success_count, row.supported_success_count) == (0, 1)

    def test_an_incorrect_outcome_that_advances_is_exposure_only(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)
        answer(p.client, p.child, session_id, "add", number(4))

        answer(p.client, p.child, session_id, "pick", pick("a"))  # unhinted: advances

        count = progress_of(p.child, "count-10")
        assert (count.exposure_count, count.independent_success_count) == (1, 0)
        assert count.recent_level == "INTRODUCED"
        assert SkillEvidence.objects.get(learning_objective_code="count-10").result == "INCORRECT"

    def test_each_objective_of_a_step_moves_on_its_own_row(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)
        answer(p.client, p.child, session_id, "add", number(4))

        answer(p.client, p.child, session_id, "pick", pick())

        assert progress_of(p.child, "add-10").exposure_count == 2
        assert progress_of(p.child, "add-10").consecutive_independent_correct == 2
        assert progress_of(p.child, "count-10").exposure_count == 1
        assert SkillEvidence.objects.filter(adventure_action__step_id="pick").count() == 2

    def test_ungraded_steps_unknown_objectives_and_duplicates_add_nothing_wrong(
        self, families, api, catalog
    ):
        p = play(families, api)
        session_id = start(p.client, p.child)
        answer(p.client, p.child, session_id, "add", number(4))
        answer(p.client, p.child, session_id, "pick", pick())
        before = progress_of(p.child, "count-10").exposure_count

        answer(p.client, p.child, session_id, "tell", {"kind": "narrative"})
        assert progress_of(p.child, "count-10").exposure_count == before  # narrative: ungraded

        answer(p.client, p.child, session_id, "odd", pick())
        assert progress_of(p.child, "count-10").exposure_count == before + 1  # once, not twice
        assert not SkillProgress.objects.filter(learning_objective_code="not-in-the-catalog")
        assert not SkillEvidence.objects.filter(learning_objective_code="not-in-the-catalog")

    def test_mastery_accumulates_across_sessions_and_reaches_mastered(
        self, families, api, catalog
    ):
        p = play(families, api)
        for _ in range(5):
            session_id = start(p.client, p.child, "quick")
            answer(p.client, p.child, session_id, "pick", pick())

        row = progress_of(p.child, "add-10")
        assert (row.exposure_count, row.independent_success_count) == (5, 5)
        assert row.consecutive_independent_correct == 5
        assert row.recent_level == "MASTERED"
        assert AdventureSession.objects.filter(status=SessionStatus.COMPLETED).count() == 5


@pytest.mark.django_db
class TestOnce:
    def test_a_replayed_request_adds_no_evidence(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)
        request_id = uuid.uuid4()

        first = answer(p.client, p.child, session_id, "add", number(4), request_id).json()
        again = answer(p.client, p.child, session_id, "add", number(4), request_id).json()

        assert (first["replayed"], again["replayed"]) == (False, True)
        assert SkillEvidence.objects.count() == 1
        assert progress_of(p.child, "add-10").exposure_count == 1

    def test_an_answer_after_the_step_moved_on_adds_nothing(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)
        answer(p.client, p.child, session_id, "add", number(4))

        late = answer(p.client, p.child, session_id, "add", number(4))

        assert late.status_code == 409 and late.json()["error"]["code"] == "step_not_current"
        assert progress_of(p.child, "add-10").exposure_count == 1

    def test_a_completed_session_takes_no_new_evidence(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child, "quick")
        answer(p.client, p.child, session_id, "pick", pick())

        late = answer(p.client, p.child, session_id, "pick", pick())

        assert late.json()["error"]["code"] == "session_not_active"
        assert progress_of(p.child, "add-10").exposure_count == 1

    def test_completion_and_repeated_completion_add_no_mastery(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child, "quick")
        answer(p.client, p.child, session_id, "pick", pick())
        evidence, exposures = SkillEvidence.objects.count(), progress_of(p.child, "add-10").exposure_count

        for _ in range(2):
            response = p.client.post(
                f"/api/v1/children/{p.child.pk}/adventures/quick/sessions/{session_id}/complete/",
                {},
                content_type="application/json",
            )
            assert response.status_code == 200

        assert SkillEvidence.objects.count() == evidence
        assert progress_of(p.child, "add-10").exposure_count == exposures

    def test_rejected_answers_never_produce_evidence(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)

        assert answer(p.client, p.child, session_id, "add", {"kind": "choice"}).status_code == 400
        assert answer(p.client, p.child, session_id, "pick", pick()).status_code == 409
        assert answer(p.client, p.child, uuid.uuid4(), "add", number(4)).status_code == 404

        assert not SkillEvidence.objects.exists() and not SkillProgress.objects.exists()

    def test_a_failed_mastery_write_rolls_the_whole_answer_back(
        self, families, api, catalog, monkeypatch
    ):
        from apps.education import services as education

        def boom(*args, **kwargs):
            raise RuntimeError("database went away")

        monkeypatch.setattr(education, "_apply", boom)
        p = play(families, api)
        session_id = start(p.client, p.child)

        response = answer(p.client, p.child, session_id, "add", number(4))

        assert response.status_code == 500
        session = AdventureSession.objects.get(pk=session_id)
        assert session.current_step_id == "add"  # the session did not move either
        assert not AdventureAction.objects.exists() and not SkillEvidence.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_answers_count_once(families, api, catalog, token_for):
    """Same request id twice, plus a different one, at once: one answer counts."""
    session_id = start(api(families.a), families.a1)
    token = token_for(families.a.cognito_sub)
    shared = uuid.uuid4()
    barrier = threading.Barrier(3)
    statuses = []

    def run(request_id):
        client = Client()
        client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        try:
            barrier.wait()
            statuses.append(
                answer(client, families.a1, session_id, "add", number(4), request_id).status_code
            )
        finally:
            connection.close()

    threads = [threading.Thread(target=run, args=(rid,)) for rid in (shared, shared, uuid.uuid4())]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(statuses) == [200, 200, 409]  # two of one request (one replayed), one stale
    assert SkillEvidence.objects.count() == 1
    assert SkillProgress.objects.get(learning_objective_code="add-10").exposure_count == 1


@pytest.mark.django_db
class TestMasteryReads:
    def test_lists_persisted_mastery_with_titles_and_counts(self, families, api, catalog):
        p = play(families, api)
        session_id = start(p.client, p.child)
        answer(p.client, p.child, session_id, "add", number(4))
        answer(p.client, p.child, session_id, "pick", pick("a"))

        body = mastery(p.client, p.child).json()

        by_code = {entry["objectiveId"]: entry for entry in body["objectives"]}
        assert set(by_code) == {"add-10", "count-10"}
        add = by_code["add-10"]
        assert add["title"] == "Adding within ten" and add["hasEvidence"] is True
        assert (add["status"], add["rawStatus"], add["errorPattern"]) == (
            "DEVELOPING",
            "DEVELOPING",
            "NONE",
        )
        assert (add["exposureCount"], add["independentSuccessCount"]) == (2, 1)
        row = progress_of(p.child, "add-10")
        assert add["lastPracticedAt"] == row.last_practiced_at.isoformat()

    def test_no_evidence_is_not_a_low_score(self, families, api, catalog):
        p = play(families, api)

        assert mastery(p.client, p.child).json() == {"objectives": []}
        entry = mastery(p.client, p.child, "count-10").json()
        assert entry["hasEvidence"] is False and entry["status"] is None
        assert entry["exposureCount"] == 0
        assert mastery(p.client, p.child, "no-such-objective").status_code == 404

    def test_review_decay_shows_at_read_time_and_never_rewrites_the_row(
        self, families, api, catalog
    ):
        from datetime import timedelta

        from django.utils import timezone

        p = play(families, api)
        for _ in range(5):
            answer(p.client, p.child, start(p.client, p.child, "quick"), "pick", pick())
        SkillProgress.objects.filter(learning_objective_code="add-10").update(
            last_practiced_at=timezone.now() - timedelta(days=30)
        )

        entry = mastery(p.client, p.child, "add-10").json()

        assert (entry["status"], entry["rawStatus"]) == ("PROFICIENT", "MASTERED")
        assert progress_of(p.child, "add-10").recent_level == "MASTERED"

    def test_progress_includes_the_status_summary_only(self, families, api, catalog):
        p = play(families, api)
        answer(p.client, p.child, start(p.client, p.child, "quick"), "pick", pick())

        body = p.client.get(f"/api/v1/children/{p.child.pk}/progress/").json()

        assert body["mastery"] == [{"objectiveId": "add-10", "status": "DEVELOPING"}]

    def test_another_family_and_a_sibling_see_nothing(self, families, api, catalog):
        p = play(families, api)
        answer(p.client, p.child, start(p.client, p.child, "quick"), "pick", pick())

        other = api(families.b)
        assert mastery(other, families.a1).status_code == 404
        assert mastery(other, families.a1, "add-10").status_code == 404
        assert mastery(api(families.a), families.a2).json() == {"objectives": []}
        assert mastery(Client(), families.a1).status_code == 401

    @pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
    def test_mastery_cannot_be_written_through_the_api(self, families, api, catalog, method):
        p = play(families, api)
        for url in (
            f"/api/v1/children/{p.child.pk}/mastery/",
            f"/api/v1/children/{p.child.pk}/mastery/add-10/",
        ):
            response = getattr(p.client, method)(
                url, {"exposureCount": 99, "status": "MASTERED"}, content_type="application/json"
            )
            assert response.status_code == 405
        assert not SkillProgress.objects.exists()
