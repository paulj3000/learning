"""Server-authoritative world changes and quest progress from step adventures (LAI-0605).

Through HTTP with a verified Cognito token, the real engines and PostgreSQL. The quest rules are
the golden-vector port (`tests/golden/test_quests_python.py`); these tests pin what the server
records, when, once, and who can see it.
"""

import copy
import uuid

import pytest
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.tests.helpers import base_collections, write_export
from apps.game_sessions.models import AdventureSession, SessionStatus
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import NpcRelationship, WorldChange
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres]


def step(step_id, step_type, presentation, transitions, objectives=()):
    return {
        "id": step_id,
        "type": step_type,
        "objectiveIds": list(objectives),
        "presentation": presentation,
        "transitions": transitions,
        "fallback": {"text": "x"},
    }


def quest(quest_id, stages, *, prerequisites=(), age_bands=("PATHFINDER",), completion=None):
    return {
        "id": quest_id,
        "title": quest_id.title(),
        "summary": f"The {quest_id} quest",
        "giverNpcId": "pip",
        "ageBands": list(age_bands),
        "prerequisites": list(prerequisites),
        "entryStageId": stages[0]["id"],
        "stages": stages,
        "completion": completion or {"journalNote": "Done"},
    }


def world_catalog():
    c = base_collections()
    c["adventures.json"]["learningObjectives"] = [
        {"code": "count-10", "domain": "numeracy", "title": "Counting to ten"}
    ]
    c["adventures.json"]["adventures"] = [
        {
            "slug": "bridge",
            "title": "Bridge",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "count",
            "steps": [
                step(
                    "count",
                    "NUMBER_INPUT",
                    {"kind": "number-input", "prompt": "How many?", "correctValue": 3},
                    [{"when": "always", "nextStepId": "fix"}],
                    ["count-10"],
                ),
                step(
                    "fix",
                    "WORLD_CHANGE",
                    {
                        "kind": "world-change",
                        "text": "Fixed",
                        "payload": {
                            "locationSlug": "bay",
                            "changeType": "REPAIR",
                            "changeKey": "BRIDGE_FIXED",
                        },
                    },
                    [{"when": "always", "nextStepId": "done"}],
                ),
                step("done", "COMPLETE", {"kind": "complete", "text": "Done"}, []),
            ],
        },
        {
            "slug": "finale",
            "title": "Finale",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "end",
            "steps": [step("end", "COMPLETE", {"kind": "complete", "text": "End"}, [])],
        },
    ]
    c["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["bridge", "finale"]
    c["quests.json"]["quests"] = [
        quest(
            "repair",
            [
                {
                    "id": "build",
                    "title": "Fix the bridge",
                    "objectives": [
                        {"id": "fixed", "label": "Fix it", "kind": "BUILD", "changeKey": "BRIDGE_FIXED"}
                    ],
                    "nextStageId": "solve",
                },
                {
                    "id": "solve",
                    "title": "Finish the adventure",
                    "objectives": [
                        {"id": "solved", "label": "Solve", "kind": "SOLVE", "adventureSlug": "bridge"}
                    ],
                },
            ],
            completion={
                "journalNote": "The bridge is fixed",
                "worldChanges": [
                    {"locationSlug": "bay", "changeType": "CELEBRATE", "changeKey": "FLAGS_UP"}
                ],
                "setsNpcMemoryFlags": [{"npcId": "pip", "flags": ["bridgeQuestCompleted"]}],
            },
        ),
        quest(
            "practice",
            [
                {
                    "id": "learn",
                    "title": "Practise counting",
                    "objectives": [
                        {
                            "id": "counted",
                            "label": "Count",
                            "kind": "LEARN",
                            "learningObjectiveCode": "count-10",
                            "atLeast": "INTRODUCED",
                        }
                    ],
                }
            ],
            prerequisites=[{"type": "QUEST_COMPLETED", "questId": "repair"}],
        ),
        quest(
            "chat",
            [
                {
                    "id": "talk",
                    "title": "Talk to Pip",
                    "objectives": [
                        {"id": "met", "label": "Meet", "kind": "TALK_TO", "npcId": "pip", "memoryFlag": "met"}
                    ],
                }
            ],
        ),
        quest(
            "little",
            [{"id": "s", "title": "S", "objectives": [{"id": "o", "label": "o", "kind": "BUILD", "changeKey": "X"}]}],
            age_bands=("SPROUT",),
        ),
    ]
    c["rewards.json"] = {
        "collectibleSets": [],
        "items": [
            {
                "id": "trophy",
                "displayName": "Trophy",
                "description": "A trophy",
                "category": "KEEPSAKE",
                "rarity": "COMMON",
            }
        ],
        "rewardRules": [
            {
                "id": "reward-repair",
                "trigger": {"type": "QUEST_COMPLETED", "questId": "repair"},
                "itemIds": ["trophy"],
                "message": "You finished the repair quest!",
            }
        ],
    }
    return c


@pytest.fixture
def catalog(db, tmp_path):
    collections = world_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def base(child):
    return f"/api/v1/children/{child.pk}/"


def accept(client, child, quest_id):
    return client.post(f"{base(child)}quests/{quest_id}/accept/", {}, content_type="application/json")


def start(client, child, adventure="bridge"):
    response = client.post(
        f"{base(child)}adventures/{adventure}/sessions/", {}, content_type="application/json"
    )
    assert response.status_code in (200, 201), response.content
    return response.json()["session"]["id"]


def answer(client, child, session_id, step_id, value, request_id=None):
    return client.post(
        f"{base(child)}sessions/{session_id}/answers/",
        {"stepId": step_id, "answer": value, "requestId": str(request_id or uuid.uuid4())},
        content_type="application/json",
    )


def quests(client, child):
    return {q["questId"]: q for q in client.get(f"{base(child)}quests/").json()["quests"]}


def changes(child):
    return sorted(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))


def play_bridge(client, child, request_id=None):
    session_id = start(client, child)
    answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
    return session_id, answer(client, child, session_id, "fix", {"kind": "world-change"}, request_id)


@pytest.mark.django_db
class TestQuestReads:
    def test_lists_the_child_s_quests_with_status(self, families, api, catalog):
        listed = quests(api(families.a), families.a1)

        assert set(listed) == {"repair", "practice", "chat"}  # `little` is for Sprouts
        assert listed["repair"]["status"] == "AVAILABLE"
        assert listed["practice"]["status"] == "LOCKED"
        assert listed["practice"]["lockedReason"] == "PREREQUISITES_NOT_MET"
        assert [s["id"] for s in listed["repair"]["stages"]] == ["build", "solve"]

    def test_one_quest_shows_its_progress_and_hidden_ones_are_not_found(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        accept(client, child, "repair")

        body = client.get(f"{base(child)}quests/repair/").json()

        assert (body["status"], body["currentStageId"]) == ("ACTIVE", "build")
        for hidden in ("little", "nope"):
            assert client.get(f"{base(child)}quests/{hidden}/").status_code == 404

    def test_a_retired_quest_is_gone_everywhere(self, families, api, catalog, tmp_path):
        newer = copy.deepcopy(catalog)
        newer["quests.json"]["quests"] = [q for q in newer["quests.json"]["quests"] if q["id"] != "chat"]
        import_content(write_export(tmp_path / "v2", newer))
        client, child = api(families.a), families.a1

        assert "chat" not in quests(client, child)
        assert client.get(f"{base(child)}quests/chat/").status_code == 404
        assert accept(client, child, "chat").status_code == 404

    def test_another_family_sees_nothing_and_siblings_are_separate(self, families, api, catalog):
        accept(api(families.a), families.a1, "repair")

        other = api(families.b)
        assert other.get(f"{base(families.a1)}quests/").status_code == 404
        assert other.get(f"{base(families.a1)}quests/repair/").status_code == 404
        assert accept(other, families.a1, "repair").status_code == 404
        assert quests(api(families.a), families.a2)["repair"]["status"] == "AVAILABLE"
        assert Client().get(f"{base(families.a1)}quests/").status_code == 401


@pytest.mark.django_db
class TestAcceptance:
    def test_accepting_is_idempotent(self, families, api, catalog):
        client, child = api(families.a), families.a1
        assert accept(client, child, "repair").status_code == 201
        assert accept(client, child, "repair").status_code == 200
        assert QuestProgress.objects.filter(child=child).count() == 1

    def test_prerequisites_are_enforced_by_the_server(self, families, api, catalog):
        response = accept(api(families.a), families.a1, "practice")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "quest_unavailable"
        assert not QuestProgress.objects.exists()

    def test_another_age_band_s_quest_cannot_be_accepted(self, families, api, catalog):
        assert accept(api(families.a), families.a1, "little").status_code == 409


@pytest.mark.django_db
class TestWorldChangesAndQuestsFromPlay:
    def test_a_world_change_step_records_the_island_change(self, families, api, catalog):
        client, child = api(families.a), families.a1
        session_id, response = play_bridge(client, child)

        assert response.status_code == 200
        change = WorldChange.objects.get(child=child, change_key="BRIDGE_FIXED")
        assert (change.location_slug, change.change_type) == ("bay", "REPAIR")
        assert change.source_session_id == session_id

    def test_play_advances_and_completes_an_accepted_quest_in_the_same_answer(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        accept(client, child, "repair")

        _, response = play_bridge(client, child)

        body = response.json()
        assert body["session"]["status"] == "COMPLETED"
        [update] = body["questUpdates"]
        assert (update["questId"], update["status"], update["justCompleted"]) == (
            "repair",
            "COMPLETED",
            True,
        )
        assert update["newlyCompletedObjectiveIds"] == ["fixed", "solved"]
        # The quest's completion: its world change, the NPC's memory, and its reward.
        assert changes(child) == ["BRIDGE_FIXED", "FLAGS_UP"]
        pip = NpcRelationship.objects.get(child=child, npc_id="pip")
        assert pip.memory_flags == {"bridgeQuestCompleted": True}
        assert pip.relationship_points == 0  # bookkeeping awards no friendship
        quest_grant = next(g for g in body["rewards"]["grants"] if g["source"] == "QUEST_COMPLETED")
        assert quest_grant["ruleId"] == "reward-repair" and quest_grant["newlyGranted"]
        assert "trophy" in [item["itemId"] for item in body["rewards"]["newItems"]]

    def test_an_unaccepted_quest_does_not_move(self, families, api, catalog):
        client, child = api(families.a), families.a1
        _, response = play_bridge(client, child)

        assert response.json()["questUpdates"] == []
        assert not QuestProgress.objects.exists()
        assert changes(child) == ["BRIDGE_FIXED"]

    def test_completing_one_quest_unlocks_the_next_and_mastery_can_satisfy_it(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        accept(client, child, "repair")
        play_bridge(client, child)  # also records count-10 evidence (mastery, LAI-0603)
        assert quests(client, child)["practice"]["status"] == "AVAILABLE"
        assert accept(client, child, "practice").status_code == 201

        finale = start(client, child, "finale")
        response = client.post(
            f"{base(child)}adventures/finale/sessions/{finale}/complete/", {}, content_type="application/json"
        )

        [update] = response.json()["questUpdates"]
        assert (update["questId"], update["status"]) == ("practice", "COMPLETED")

    def test_a_talk_objective_waits_for_a_real_conversation(self, families, api, catalog):
        client, child = api(families.a), families.a1
        accept(client, child, "chat")
        play_bridge(client, child)
        assert QuestProgress.objects.get(child=child, quest__slug="chat").status == QuestStatus.ACTIVE


@pytest.mark.django_db
class TestOnce:
    def test_a_replayed_answer_records_nothing_twice(self, families, api, catalog):
        client, child = api(families.a), families.a1
        accept(client, child, "repair")
        request_id = uuid.uuid4()
        session_id, first = play_bridge(client, child, request_id)

        again = answer(client, child, session_id, "fix", {"kind": "world-change"}, request_id).json()

        assert again["replayed"] is True and again["questUpdates"] == []
        assert not any(g["newlyGranted"] for g in again["rewards"]["grants"])
        assert {g["ruleId"] for g in again["rewards"]["grants"]} == {
            g["ruleId"] for g in first.json()["rewards"]["grants"]
        }
        assert changes(child) == ["BRIDGE_FIXED", "FLAGS_UP"]
        assert GrantedRule.objects.filter(child=child).count() == 1
        assert InventoryItem.objects.filter(child=child).count() == 1

    def test_world_changes_survive_new_sessions_and_a_second_play_through(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        play_bridge(client, child)
        play_bridge(client, child)

        assert WorldChange.objects.filter(child=child, change_key="BRIDGE_FIXED").count() == 1
        assert AdventureSession.objects.filter(status=SessionStatus.COMPLETED).count() == 2
        progress = client.get(f"{base(child)}progress/").json()
        assert [c["changeKey"] for c in progress["worldChanges"]] == ["BRIDGE_FIXED"]

    def test_a_failed_quest_effect_rolls_the_whole_answer_back(
        self, families, api, catalog, monkeypatch
    ):
        from apps.quests import services as quests_services

        def boom(*args, **kwargs):
            raise RuntimeError("database went away")

        client, child = api(families.a), families.a1
        accept(client, child, "repair")
        session_id = start(client, child)
        answer(client, child, session_id, "count", {"kind": "number-input", "value": 3})
        monkeypatch.setattr(quests_services, "set_npc_memory_flags_for_quest", boom)

        response = answer(client, child, session_id, "fix", {"kind": "world-change"})

        assert response.status_code == 500
        session = AdventureSession.objects.get(pk=session_id)
        assert (session.current_step_id, session.status) == ("fix", SessionStatus.ACTIVE)
        assert changes(child) == []
        assert QuestProgress.objects.get(child=child).status == QuestStatus.ACTIVE
        assert not GrantedRule.objects.exists()
