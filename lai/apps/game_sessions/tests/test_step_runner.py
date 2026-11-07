"""LAI-0816: the Django-backed step adventure runner. Discover, start or resume, read the current
step, grade in Python, record evidence, apply consequences once, complete, reward once."""

import copy
import json
import uuid

import pytest

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, AdventureStep
from apps.catalog.tests.helpers import base_collections, publish_edit, write_export
from apps.education.models import SkillEvidence
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def runner_collections():
    data = base_collections()
    data["adventures.json"]["adventures"] = [
        {
            "slug": "mend-bridge",
            "title": "Mend the Bridge",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "count",
            "skillLevel": 2,
            "steps": [
                {
                    "id": "count",
                    "type": "NUMBER_INPUT",
                    "objectiveIds": ["count-10"],
                    "presentation": {
                        "kind": "number-input",
                        "prompt": "How many planks?",
                        "correctValue": 3,
                    },
                    "transitions": [
                        {"when": "correct", "nextStepId": "mark"},
                        {"when": "incorrect", "nextStepId": "mark"},
                    ],
                    "fallback": {"text": "Count"},
                },
                {
                    "id": "mark",
                    "type": "WORLD_CHANGE",
                    "objectiveIds": [],
                    "presentation": {
                        "kind": "world-change",
                        "text": "The bridge is mended.",
                        "payload": {
                            "locationSlug": "bay",
                            "changeType": "BRIDGE",
                            "changeKey": "BRIDGE_MENDED",
                        },
                    },
                    "transitions": [{"when": "always", "nextStepId": "done"}],
                    "fallback": {"text": "Mended"},
                },
                {
                    "id": "done",
                    "type": "COMPLETE",
                    "objectiveIds": [],
                    "presentation": {"kind": "complete", "text": "Well done"},
                    "transitions": [],
                    "fallback": {"text": "Done"},
                },
            ],
        },
        {
            "slug": "sprout-song",
            "title": "Sprout Song",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["SPROUT"],
            "entryStepId": "done",
            "steps": [
                {
                    "id": "done",
                    "type": "COMPLETE",
                    "objectiveIds": [],
                    "presentation": {"kind": "complete", "text": "La la"},
                    "transitions": [],
                    "fallback": {"text": "La"},
                }
            ],
        },
    ]
    # Evidence is written only for objectives the catalog declares (LAI-0603).
    data["adventures.json"]["learningObjectives"] = [
        {"code": "count-10", "domain": "numeracy", "title": "Counting to ten"}
    ]
    data["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = "mend-bridge"
    data["rewards.json"] = {
        "collectibleSets": [],
        "items": [
            {
                "id": "plank-badge",
                "displayName": "Plank Badge",
                "description": "For mending the bridge.",
                "category": "KEEPSAKE",
                "rarity": "COMMON",
            }
        ],
        "rewardRules": [
            {
                "id": "mend-reward",
                "message": "You mended the bridge!",
                "itemIds": ["plank-badge"],
                "trigger": {"type": "ADVENTURE_COMPLETED", "templateSlug": "mend-bridge"},
            }
        ],
    }
    return data


@pytest.fixture
def world(tmp_path):
    import_content(write_export(tmp_path / "v1", runner_collections()))


@pytest.fixture
def play(world, families, api):
    return api(families.a), families.a1


def base(child) -> str:
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def start(client, child, slug="mend-bridge"):
    return post(client, f"{base(child)}content/adventures/{slug}/start/")


def answer(client, child, session_id, step_id, body, request_id=None):
    return post(
        client,
        f"{base(child)}sessions/{session_id}/answers/",
        {"stepId": step_id, "answer": body, "requestId": str(request_id or uuid.uuid4())},
    )


def play_through(client, child, session_id, count_value=3):
    answer(client, child, session_id, "count", {"kind": "number-input", "value": count_value})
    return answer(client, child, session_id, "mark", {"kind": "world-change"})


class TestStartAndResume:
    def test_a_published_adventure_starts_at_its_entry_step_with_no_answers(self, play):
        client, child = play
        response = start(client, child)
        assert response.status_code == 201
        body = response.json()
        assert body["created"] is True
        assert body["step"]["id"] == "count" and body["step"]["presentation"]["prompt"]
        assert "correctValue" not in json.dumps(body)
        assert body["session"]["status"] == "ACTIVE" and body["doneStepIds"] == []
        assert body["adventureRevision"]["number"] == 1 and body["stepRevision"]["id"]

    def test_starting_again_resumes_the_same_session(self, play):
        client, child = play
        first = start(client, child).json()
        second = start(client, child)
        assert second.status_code == 200 and second.json()["created"] is False
        assert second.json()["session"]["id"] == first["session"]["id"]
        assert AdventureSession.objects.count() == 1

    def test_the_session_pins_its_content(self, play):
        client, child = play
        session = AdventureSession.objects.get(pk=start(client, child).json()["session"]["id"])
        assert session.pinned_revisions.count() == 1 + 3  # the adventure and its three steps

    def test_resume_after_a_disconnection_returns_the_current_step(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        resumed = client.get(f"{base(child)}sessions/{session_id}/step/").json()
        assert resumed["step"]["id"] == "mark" and resumed["doneStepIds"] == ["count"]
        assert resumed["step"]["presentation"]["kind"] == "world-change"

    def test_a_finished_session_shows_only_its_closing_step(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        play_through(client, child, session_id)
        done = client.get(f"{base(child)}sessions/{session_id}/step/").json()
        assert done["session"]["status"] == "COMPLETED"
        assert done["step"]["presentation"] == {"kind": "complete", "text": "Well done"}

    def test_other_bands_unpublished_and_inactive_adventures_are_not_found(self, play):
        client, child = play
        assert start(client, child, "sprout-song").status_code == 404  # Sprouts only
        assert start(client, child, "no-such").status_code == 404
        Adventure.objects.filter(slug="mend-bridge").update(published_revision=None)
        assert start(client, child).status_code == 404
        Adventure.objects.filter(slug="mend-bridge").update(active=False)
        assert start(client, child).status_code == 404


class TestGradingAndConsequences:
    def test_a_graded_answer_records_skill_evidence_for_each_objective(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        response = answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        assert response.json()["correctness"] == "CORRECT"
        [evidence] = SkillEvidence.objects.all()
        assert (evidence.learning_objective_code, evidence.result) == ("count-10", "CORRECT")
        assert (evidence.evidence_type, evidence.difficulty) == ("NUMBER_INPUT", 2)
        assert str(evidence.adventure_session_id) == session_id and evidence.child_id == child.pk

    def test_a_wrong_answer_is_graded_by_python_and_recorded_as_such(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        wrong = answer(client, child, session_id, "count", {"kind": "number-input", "value": 9})
        assert wrong.json()["correctness"] == "INCORRECT"
        assert SkillEvidence.objects.get().result == "INCORRECT"

    def test_ungraded_steps_record_no_evidence(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        play_through(client, child, session_id)
        assert SkillEvidence.objects.count() == 1  # only the count step was graded

    def test_a_world_change_step_records_its_consequence_once(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        response = answer(client, child, session_id, "mark", {"kind": "world-change"}).json()
        assert response["worldChangeKeys"] == ["BRIDGE_MENDED"]
        change = WorldChange.objects.get()
        assert (change.location_slug, change.change_key) == ("bay", "BRIDGE_MENDED")
        assert change.source_session_id == session_id

    def test_completing_grants_the_configured_reward(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        done = play_through(client, child, session_id).json()
        assert done["session"]["status"] == "COMPLETED"
        reward = done["completion"]["rewards"][0]
        assert reward == {
            "ruleId": "mend-reward",
            "message": "You mended the bridge!",
            "granted": True,
            "newItemIds": ["plank-badge"],
        }
        assert InventoryItem.objects.filter(child=child, item__item_id="plank-badge").count() == 1

    def test_a_replayed_request_records_and_grants_nothing_twice(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        request_id = uuid.uuid4()
        body = {"kind": "number-input", "value": 3}
        answer(client, child, session_id, "count", body, request_id)
        replay = answer(client, child, session_id, "count", body, request_id)
        assert replay.json()["replayed"] is True
        assert SkillEvidence.objects.count() == 1

        final = uuid.uuid4()
        answer(client, child, session_id, "mark", {"kind": "world-change"}, final)
        replay = answer(client, child, session_id, "mark", {"kind": "world-change"}, final)
        assert replay.json()["replayed"] is True and replay.json()["completion"] is None
        assert GrantedRule.objects.count() == 1 and WorldChange.objects.count() == 1

    def test_playing_the_adventure_again_pays_nothing_more(self, play):
        client, child = play
        first = start(client, child).json()["session"]["id"]
        play_through(client, child, first)
        second = start(client, child)
        assert second.status_code == 201  # the first is over, so a new session starts
        again = play_through(client, child, second.json()["session"]["id"]).json()
        assert again["completion"]["rewards"][0]["granted"] is False
        assert again["completion"]["rewards"][0]["newItemIds"] == []
        assert InventoryItem.objects.count() == 1 and GrantedRule.objects.count() == 1

    def test_finishing_the_adventure_moves_an_active_quest_forward(self, play):
        from django.utils import timezone

        from apps.catalog.models import Quest
        from apps.quests.models import QuestProgress

        client, child = play
        quest = Quest.objects.get(slug="repair")
        QuestProgress.objects.create(
            child=child,
            quest=quest,
            status="ACTIVE",
            current_stage_id="s1",
            started_at=timezone.now(),
            last_updated_at=timezone.now(),
        )
        session_id = start(client, child).json()["session"]["id"]
        done = play_through(client, child, session_id).json()
        assert done["completion"]["questsCompleted"] == ["repair"]
        assert QuestProgress.objects.get(child=child).status == "COMPLETED"


class TestPublicationDuringAVisit:
    def test_a_publish_mid_session_changes_neither_the_step_shown_nor_the_grading(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        step = AdventureStep.objects.get(adventure__slug="mend-bridge", step_id="count")
        body = copy.deepcopy(authoring.current_body(step))
        body["presentation"]["prompt"] = "A different question?"
        body["presentation"]["correctValue"] = 7
        publish_edit(step, body)

        shown = client.get(f"{base(child)}sessions/{session_id}/step/").json()
        assert shown["step"]["presentation"]["prompt"] == "How many planks?"
        assert (
            answer(client, child, session_id, "count", {"kind": "number-input", "value": 3}).json()[
                "correctness"
            ]
            == "CORRECT"
        )

        later = start(client, child)  # the first session moved on; but a new visit sees the edit
        later_id = later.json()["session"]["id"]
        assert later.json()["session"]["id"] == session_id  # still the same active session
        play_through(client, child, session_id)
        fresh = start(client, child).json()
        assert fresh["step"]["presentation"]["prompt"] == "A different question?"
        assert fresh["session"]["id"] != later_id

    def test_retiring_the_adventure_mid_session_lets_the_visit_finish(self, play):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        Adventure.objects.filter(slug="mend-bridge").update(active=False)
        assert play_through(client, child, session_id).json()["session"]["status"] == "COMPLETED"
        assert AdventureSession.objects.get(pk=session_id).status == SessionStatus.COMPLETED


class TestAuthorization:
    def test_another_family_cannot_read_or_play_the_session(self, play, families, api):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        stranger = api(families.b)
        url = f"{base(child)}sessions/{session_id}/step/"
        assert stranger.get(url).status_code == 404
        assert (
            answer(
                stranger, child, session_id, "count", {"kind": "number-input", "value": 3}
            ).status_code
            == 404
        )
        assert start(stranger, child).status_code == 404
        # ...and nothing they tried changed the session.
        assert SkillEvidence.objects.count() == 0

    def test_a_sibling_of_the_same_parent_cannot_read_the_session_either(self, play, families):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        sibling = families.a2
        assert client.get(f"{base(sibling)}sessions/{session_id}/step/").status_code == 404

    def test_an_unauthenticated_caller_gets_nothing(self, play, families, api):
        client, child = play
        session_id = start(client, child).json()["session"]["id"]
        anonymous = api()
        assert anonymous.get(f"{base(child)}sessions/{session_id}/step/").status_code in (401, 403)
        assert start(anonymous, child).status_code in (401, 403)
