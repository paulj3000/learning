"""Server-authoritative NPC conversations (LAI-0605).

Through HTTP with a verified Cognito token and PostgreSQL. The dialogue rules are the
golden-vector port (`tests/golden/test_npc_python.py`); these tests pin what the server lets a
child reach, what it records, and what it gives.
"""

import copy
import threading

import pytest
from django.db import connection
from django.test import Client

from apps.catalog.importer import import_content
from apps.catalog.tests.helpers import base_collections, write_export
from apps.inventory.models import GrantedRule
from apps.progression.models import NpcRelationship
from apps.quests.models import QuestProgress, QuestStatus

pytestmark = [pytest.mark.postgres]


def node(node_id, conditions, choices, **extra):
    return {"id": node_id, "conditions": conditions, "text": f"Line {node_id}", "choices": choices, **extra}


PIP = {
    "id": "pip",
    "displayName": "Pip",
    "role": "Pirate",
    "homeLocationSlug": "bay",
    "interactionId": "talk-pip",
    "schedule": [],
    "questOffers": [],
    "dialogue": [
        node(
            "thanks",
            [{"type": "QUEST_COMPLETED", "questId": "chat"}],
            [{"id": "bye", "label": "Bye"}],
            awardsRelationshipPoints=3,
        ),
        node(
            "offer",
            [{"type": "RELATIONSHIP_AT_LEAST", "level": "ACQUAINTANCE"}],
            [
                {"id": "accept", "label": "Yes", "nextNodeId": "accepted"},
                {"id": "later", "label": "Later"},
                {"id": "dangling", "label": "Oops", "nextNodeId": "missing"},
            ],
            setsMemoryFlags=["heardAboutBridge"],
            awardsRelationshipPoints=1,
        ),
        node("accepted", [{"type": "ALWAYS"}], [], followUpOnly=True, setsMemoryFlags=["acceptedBridge"]),
        node("hello", [{"type": "ALWAYS"}], [{"id": "hi", "label": "Hi"}], awardsRelationshipPoints=2, setsMemoryFlags=["met"]),
    ],
}


def npc_catalog():
    c = base_collections()
    c["npcs.json"] = {"npcs": [PIP]}
    c["quests.json"]["quests"] = [
        {
            "id": "chat",
            "title": "Chat",
            "summary": "Talk to Pip",
            "giverNpcId": "pip",
            "ageBands": ["PATHFINDER"],
            "prerequisites": [],
            "entryStageId": "talk",
            "stages": [
                {
                    "id": "talk",
                    "title": "Talk",
                    "objectives": [
                        {"id": "met-pip", "label": "Meet Pip", "kind": "TALK_TO", "npcId": "pip", "memoryFlag": "met"}
                    ],
                }
            ],
            "completion": {"journalNote": "Done"},
        }
    ]
    c["rewards.json"] = {
        "collectibleSets": [],
        "items": [
            {"id": "knot", "displayName": "Knot", "description": "A knot", "category": "KEEPSAKE", "rarity": "COMMON"}
        ],
        "rewardRules": [
            {
                "id": "reward-pip-acquaintance",
                "trigger": {"type": "NPC_RELATIONSHIP", "npcId": "pip", "level": "ACQUAINTANCE"},
                "itemIds": ["knot"],
                "message": "Pip gave you a knot!",
            }
        ],
    }
    return c


@pytest.fixture
def catalog(db, tmp_path):
    collections = npc_catalog()
    import_content(write_export(tmp_path / "v1", collections))
    return collections


def url(child, suffix=""):
    return f"/api/v1/children/{child.pk}/npcs/{suffix}"


def talk(client, child, npc_id="pip"):
    return client.post(url(child, f"{npc_id}/talk/"), {}, content_type="application/json")


def choose(client, child, from_node, choice, npc_id="pip"):
    return client.post(
        url(child, f"{npc_id}/choices/"),
        {"fromNodeId": from_node, "choiceId": choice},
        content_type="application/json",
    )


def row(child):
    return NpcRelationship.objects.filter(child=child, npc_id="pip").first()


@pytest.mark.django_db
class TestConversation:
    def test_the_server_picks_the_entry_node_and_records_it(self, families, api, catalog):
        client, child = api(families.a), families.a1

        body = talk(client, child).json()

        assert body["node"] == {"id": "hello", "text": "Line hello", "choices": [{"id": "hi", "label": "Hi"}]}
        assert body["relationship"] == {
            "level": "ACQUAINTANCE",
            "met": True,
            "lastInteractedAt": row(child).last_interacted_at.isoformat(),
            "levelIncreased": True,
        }
        stored = row(child)
        assert (stored.relationship_points, stored.memory_flags, stored.seen_node_ids) == (
            2,
            {"met": True},
            ["hello"],
        )
        assert "conditions" not in str(body) and "setsMemoryFlags" not in str(body)

    def test_dialogue_changes_with_progress(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)  # hello: +2, now an acquaintance

        offer = talk(client, child).json()["node"]

        assert offer["id"] == "offer"
        assert [c["id"] for c in offer["choices"]] == ["accept", "later", "dangling"]

    def test_points_come_once_and_flags_stay_set(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)
        for _ in range(3):
            talk(client, child)  # the offer each time: +1 only the first time

        stored = row(child)
        assert stored.relationship_points == 3
        assert stored.seen_node_ids == ["hello", "offer"]
        assert stored.memory_flags == {"met": True, "heardAboutBridge": True}

    def test_a_choice_from_a_shown_node_leads_to_its_follow_up(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)
        talk(client, child)

        body = choose(client, child, "offer", "accept").json()

        assert body["node"]["id"] == "accepted"
        assert row(child).memory_flags["acceptedBridge"] is True

    def test_a_choice_that_ends_the_talk_records_nothing(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)
        talk(client, child)
        before = row(child).seen_node_ids

        for choice in ("later", "dangling"):
            assert choose(client, child, "offer", choice).json()["node"] is None
        assert row(child).seen_node_ids == before

    @pytest.mark.parametrize(
        ("from_node", "choice"),
        [("offer", "accept"), ("accepted", "x"), ("hello", "nope"), ("missing", "hi")],
    )
    def test_a_node_the_child_was_not_shown_or_an_unknown_choice_is_refused(
        self, families, api, catalog, from_node, choice
    ):
        client, child = api(families.a), families.a1
        talk(client, child)  # only `hello` has been shown

        response = choose(client, child, from_node, choice)

        assert response.status_code == 409
        assert response.json()["error"]["code"] == "dialogue_choice_unavailable"
        assert "acceptedBridge" not in row(child).memory_flags

    def test_a_forged_body_is_refused(self, families, api, catalog):
        client, child = api(families.a), families.a1
        response = client.post(
            url(child, "pip/choices/"),
            {"fromNodeId": "hello", "choiceId": "hi", "memoryFlags": {"acceptedBridge": True}},
            content_type="application/json",
        )
        assert response.status_code == 400
        assert talk(client, child).status_code == 200
        assert client.post(url(child, "pip/talk/"), {"nodeId": "accepted"}, content_type="application/json").status_code == 400

    def test_an_unknown_or_retired_npc_is_not_found(self, families, api, catalog, tmp_path):
        client, child = api(families.a), families.a1
        assert talk(client, child, "nobody").status_code == 404

        newer = copy.deepcopy(catalog)
        newer["npcs.json"]["npcs"] = []
        newer["quests.json"]["quests"][0]["giverNpcId"] = None
        import_content(write_export(tmp_path / "v2", newer))
        assert talk(client, child).status_code == 404
        assert client.get(url(child, "pip/")).status_code == 404


@pytest.mark.django_db
class TestEffects:
    def test_talking_moves_a_talk_quest_and_reaching_a_level_gives_its_reward(
        self, families, api, catalog
    ):
        client, child = api(families.a), families.a1
        client.post(f"/api/v1/children/{child.pk}/quests/chat/accept/", {}, content_type="application/json")

        body = talk(client, child).json()

        [update] = body["questUpdates"]
        assert (update["questId"], update["status"], update["justCompleted"]) == ("chat", "COMPLETED", True)
        [grant] = body["rewards"]["grants"]
        assert (grant["ruleId"], grant["source"], grant["newlyGranted"]) == (
            "reward-pip-acquaintance",
            "NPC_RELATIONSHIP",
            True,
        )
        # The finished quest changes what Pip says next.
        assert talk(client, child).json()["node"]["id"] == "thanks"
        assert GrantedRule.objects.filter(child=child).count() == 1

    def test_talking_again_grants_nothing_again(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)
        body = talk(client, child).json()
        assert body["rewards"] == {"grants": [], "newItems": []}
        assert GrantedRule.objects.filter(child=child).count() == 1

    def test_a_failed_reward_rolls_the_conversation_back(self, families, api, catalog, monkeypatch):
        from apps.progression import dialogue

        def boom(*args, **kwargs):
            raise RuntimeError("database went away")

        monkeypatch.setattr(dialogue.inventory, "grant_for_trigger", boom)
        client, child = api(families.a), families.a1

        assert talk(client, child).status_code == 500
        assert row(child) is None


@pytest.mark.django_db
class TestReads:
    def test_lists_npcs_with_this_child_s_relationship(self, families, api, catalog):
        client, child = api(families.a), families.a1
        talk(client, child)

        [entry] = client.get(url(child)).json()["npcs"]
        assert (entry["npcId"], entry["displayName"], entry["homeLocationSlug"]) == ("pip", "Pip", "bay")
        assert (entry["relationship"]["level"], entry["relationship"]["met"]) == ("ACQUAINTANCE", True)
        sibling = client.get(url(families.a2, "pip/")).json()
        assert (sibling["relationship"]["level"], sibling["relationship"]["met"]) == ("STRANGER", False)

    def test_another_family_cannot_read_or_talk(self, families, api, catalog):
        talk(api(families.a), families.a1)
        other = api(families.b)
        assert other.get(url(families.a1)).status_code == 404
        assert other.get(url(families.a1, "pip/")).status_code == 404
        assert talk(other, families.a1).status_code == 404
        assert choose(other, families.a1, "hello", "hi").status_code == 404
        assert Client().post(url(families.a1, "pip/talk/")).status_code == 401
        assert row(families.a1).relationship_points == 2


@pytest.mark.django_db(transaction=True)
def test_simultaneous_first_talks_award_points_once(families, api, catalog, token_for):
    token = token_for(families.a.cognito_sub)
    barrier = threading.Barrier(3)
    statuses = []

    def run():
        client = Client()
        client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        try:
            barrier.wait()
            statuses.append(talk(client, families.a1).status_code)
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert statuses == [200, 200, 200]
    stored = row(families.a1)
    assert "hello" in stored.seen_node_ids and stored.seen_node_ids.count("hello") == 1
    # `hello` gives 2 points once; later talks see an acquaintance and get the offer (+1 once).
    assert stored.relationship_points in (2, 3)
    assert GrantedRule.objects.filter(child=families.a1).count() == 1
    assert QuestProgress.objects.filter(status=QuestStatus.COMPLETED).count() == 0
