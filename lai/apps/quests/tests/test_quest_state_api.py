"""Quest state and the backpack outside region play (AMP-03). Real content export, two families.

A quest is accepted through `quests/{id}/accept/`; its projected state is then saved with
`PUT quests/{id}/`, a validated write. What completion owes (world changes, NPC memory flags,
`QUEST_COMPLETED` rewards) comes from the catalog quest, once.
"""

import pytest

from apps.catalog.importer import import_content
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import NpcRelationship, WorldChange
from apps.quests.models import QuestProgress

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def content(families):
    import_content()
    return families


def url(child, rest: str) -> str:
    return f"/api/v1/children/{child.pk}/{rest}"


def accept(client, child, quest):
    return client.post(url(child, f"quests/{quest}/accept/"), {}, "application/json")


def put(client, child, quest, **state):
    return client.put(url(child, f"quests/{quest}/"), state, "application/json")


BRIDGE_DONE = {
    "status": "COMPLETED",
    "currentStageId": "bridge-stands-again",
    "completedStageIds": ["hear-pip-out", "bridge-stands-again"],
    "completedObjectiveIds": ["bridge-talk-to-pip", "bridge-world-change"],
}


def test_saving_a_completed_quest_applies_its_authored_completion_once(content, api):
    client = api(content.a)
    assert accept(client, content.a1, "repair-the-bridge").status_code == 201
    first = put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    assert first.status_code == 200
    assert first.json()["quest"]["status"] == "COMPLETED"
    assert WorldChange.objects.filter(
        child=content.a1, change_key="HARBOR_BRIDGE_LANTERNS_LIT"
    ).exists()
    pip = NpcRelationship.objects.get(child=content.a1, npc_id="pirate-pip")
    assert pip.memory_flags == {"bridgeQuestCompleted": True}

    again = put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    assert again.status_code == 200
    assert WorldChange.objects.filter(child=content.a1).count() == 1
    listed = client.get(url(content.a1, "quests/")).json()["quests"]
    assert [(q["questId"], q["status"]) for q in listed] == [("repair-the-bridge", "COMPLETED")]


def test_quest_completion_rewards_are_granted_once(content, api):
    client = api(content.a)
    accept(client, content.a1, "the-quiet-places")
    done = {
        "status": "COMPLETED",
        "currentStageId": "the-last-two",
        "completedStageIds": ["the-first-quiet-place", "look-a-little-further", "the-last-two"],
        "completedObjectiveIds": [],
    }
    body = put(client, content.a1, "the-quiet-places", **done).json()
    assert body["newItemIds"] == ["singing-shell"]
    assert body["rewardMessages"]
    assert put(client, content.a1, "the-quiet-places", **done).json()["newItemIds"] == []
    assert InventoryItem.objects.filter(child=content.a1).count() == 1
    rewards = client.get(url(content.a1, "rewards/")).json()
    assert rewards == {"ownedItemIds": ["singing-shell"], "grantedRuleIds": ["reward-quiet-places"]}
    assert client.get(url(content.a2, "rewards/")).json() == {
        "ownedItemIds": [],
        "grantedRuleIds": [],
    }


@pytest.mark.parametrize(
    "state",
    [
        # completed without reaching the last stage
        {**BRIDGE_DONE, "currentStageId": "hear-pip-out", "completedStageIds": ["hear-pip-out"]},
        # a stage the quest does not have
        {**BRIDGE_DONE, "status": "ACTIVE", "currentStageId": "made-up"},
        # an objective the quest does not have
        {**BRIDGE_DONE, "completedObjectiveIds": ["free-reward"]},
    ],
)
def test_impossible_states_are_refused(content, api, state):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    assert put(client, content.a1, "repair-the-bridge", **state).status_code == 409
    assert QuestProgress.objects.get(child=content.a1).status == "ACTIVE"
    assert not WorldChange.objects.exists()


def test_completed_lists_never_shrink_and_a_finished_quest_never_changes(content, api):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    reopened = {**BRIDGE_DONE, "status": "ACTIVE"}
    assert put(client, content.a1, "repair-the-bridge", **reopened).status_code == 409


def test_a_quest_not_started_cannot_be_saved(content, api):
    assert put(api(content.a), content.a1, "repair-the-bridge", **BRIDGE_DONE).status_code == 404


def test_client_supplied_rewards_or_fields_are_refused(content, api):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    response = put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE, rewardItemIds=["x"])
    assert response.status_code == 400


def test_another_familys_quests_and_backpack_are_not_found(content, api):
    client = api(content.a)
    accept(api(content.b), content.b1, "repair-the-bridge")
    assert put(client, content.b1, "repair-the-bridge", **BRIDGE_DONE).status_code == 404
    assert client.get(url(content.b1, "quests/")).status_code == 404
    assert client.delete(url(content.b1, "quests/")).status_code == 404
    assert client.get(url(content.b1, "rewards/")).status_code == 404
    assert client.delete(url(content.b1, "rewards/")).status_code == 404
    assert QuestProgress.objects.get(child=content.b1).status == "ACTIVE"


def test_a_parent_clears_quests_and_the_backpack_for_one_child(content, api):
    client = api(content.a)
    accept(client, content.a1, "the-quiet-places")
    put(
        client,
        content.a1,
        "the-quiet-places",
        status="COMPLETED",
        currentStageId="the-last-two",
        completedStageIds=["the-first-quiet-place", "look-a-little-further", "the-last-two"],
        completedObjectiveIds=[],
    )
    accept(client, content.a2, "the-quiet-places")
    assert client.delete(url(content.a1, "quests/")).status_code == 204
    assert client.delete(url(content.a1, "rewards/")).status_code == 204
    assert not QuestProgress.objects.filter(child=content.a1).exists()
    assert not InventoryItem.objects.filter(child=content.a1).exists()
    assert not GrantedRule.objects.filter(child=content.a1).exists()
    assert QuestProgress.objects.filter(child=content.a2).exists()
