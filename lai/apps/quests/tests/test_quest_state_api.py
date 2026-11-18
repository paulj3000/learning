"""Quest state and the backpack outside region play (AMP-03). Real content export, two families.

A quest is accepted through `quests/{id}/accept/`; its projected state is then saved with
`PUT quests/{id}/`, a validated write. What completion owes (world changes, NPC memory flags,
`QUEST_COMPLETED` rewards) comes from the catalog quest, once.
"""

import pytest

from django.utils import timezone

from apps.catalog.models import Adventure
from apps.game_sessions import services as sessions
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import NpcRelationship, WorldChange, WorldState
from apps.progression.npcs import set_memory_flags
from apps.progression.services import record_world_change
from apps.progression.tests.shared import imported_content  # noqa: F401
from apps.quests.models import QuestProgress

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def content(imported_content, families):
    return families


def url(child, rest: str) -> str:
    return f"/api/v1/children/{child.pk}/{rest}"


def accept(client, child, quest):
    return client.post(url(child, f"quests/{quest}/accept/"), {}, "application/json")


def put(client, child, quest, **state):
    return client.put(url(child, f"quests/{quest}/"), state, "application/json")


QUIET_DISCOVERIES = [
    "harbor-tide-pool",
    "bay-tide-tunnel",
    "wonderwild-glow-moss",
    "wonderwild-glowworm-cave",
    "castle-tapestry-stair",
]


def prove_bridge(child):
    """What really playing the bridge quest leaves on the server."""
    set_memory_flags(child, "pirate-pip", ["heardAboutBridge"])
    session, _ = sessions.start_or_resume_session(
        child, Adventure.objects.get(slug="repair-the-moonlight-bridge")
    )
    sessions.complete_session(child, session.pk)
    record_world_change(
        child,
        location_slug="pirate-builder-bay",
        change_type="REPAIR",
        change_key="BRIDGE_REPAIRED",
    )


def prove_quiet_places(child):
    WorldState.objects.create(
        child=child, discovered_objects=QUIET_DISCOVERIES, updated_at=timezone.now()
    )


BRIDGE_DONE = {
    "status": "COMPLETED",
    "currentStageId": "bridge-stands-again",
    "completedStageIds": ["hear-pip-out", "bridge-stands-again"],
    "completedObjectiveIds": ["bridge-talk-to-pip", "bridge-world-change"],
}


def test_saving_a_completed_quest_applies_its_authored_completion_once(content, api):
    client = api(content.a)
    assert accept(client, content.a1, "repair-the-bridge").status_code == 201
    prove_bridge(content.a1)
    first = put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    assert first.status_code == 200
    assert first.json()["quest"]["status"] == "COMPLETED"
    assert WorldChange.objects.filter(
        child=content.a1, change_key="HARBOR_BRIDGE_LANTERNS_LIT"
    ).exists()
    pip = NpcRelationship.objects.get(child=content.a1, npc_id="pirate-pip")
    # The completion adds its authored flag; `heardAboutBridge` is the proof `prove_bridge` left.
    assert pip.memory_flags == {"heardAboutBridge": True, "bridgeQuestCompleted": True}

    again = put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    assert again.status_code == 200
    assert WorldChange.objects.filter(child=content.a1).count() == 2  # proof + the lanterns
    listed = client.get(url(content.a1, "quests/")).json()["quests"]
    assert [(q["questId"], q["status"]) for q in listed] == [("repair-the-bridge", "COMPLETED")]


def test_quest_completion_rewards_are_granted_once(content, api):
    client = api(content.a)
    accept(client, content.a1, "the-quiet-places")
    prove_quiet_places(content.a1)
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
    prove_bridge(content.a1)
    before = WorldChange.objects.count()
    assert put(client, content.a1, "repair-the-bridge", **state).status_code == 409
    assert QuestProgress.objects.get(child=content.a1).status == "ACTIVE"
    assert WorldChange.objects.count() == before


def test_completed_lists_never_shrink_and_a_finished_quest_never_changes(content, api):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    prove_bridge(content.a1)
    put(client, content.a1, "repair-the-bridge", **BRIDGE_DONE)
    reopened = {**BRIDGE_DONE, "status": "ACTIVE"}
    assert put(client, content.a1, "repair-the-bridge", **reopened).status_code == 409


def test_a_quest_not_started_cannot_be_saved(content, api):
    assert put(api(content.a), content.a1, "repair-the-bridge", **BRIDGE_DONE).status_code == 404


def test_client_supplied_rewards_or_fields_are_refused(content, api):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    prove_bridge(content.a1)
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
    prove_quiet_places(content.a1)
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


# --- a claim is not proof (world-change integrity) ---------------------------------------------


def test_a_forged_completion_with_nothing_behind_it_is_refused_and_grants_nothing(content, api):
    client = api(content.a)
    accept(client, content.a1, "the-quiet-places")
    done = {
        "status": "COMPLETED",
        "currentStageId": "the-last-two",
        "completedStageIds": ["the-first-quiet-place", "look-a-little-further", "the-last-two"],
        "completedObjectiveIds": ["quiet-places-tide-pool"],
    }
    assert put(client, content.a1, "the-quiet-places", **done).status_code == 409
    assert QuestProgress.objects.get(child=content.a1).status == "ACTIVE"
    assert not InventoryItem.objects.filter(child=content.a1).exists()
    assert not GrantedRule.objects.filter(child=content.a1).exists()


def test_claiming_an_objective_the_server_cannot_see_is_refused(content, api):
    client = api(content.a)
    accept(client, content.a1, "repair-the-bridge")
    claim = {
        "status": "ACTIVE",
        "currentStageId": "hear-pip-out",
        "completedStageIds": [],
        "completedObjectiveIds": ["bridge-talk-to-pip"],
    }
    assert put(client, content.a1, "repair-the-bridge", **claim).status_code == 409
    set_memory_flags(content.a1, "pirate-pip", ["heardAboutBridge"])
    assert put(client, content.a1, "repair-the-bridge", **claim).status_code == 200


def test_forged_great_storybook_completion_gives_no_page_and_no_seal(content, api):
    client = api(content.a)
    slug = "restore-the-great-storybook-pathfinders"
    accept(client, content.a1, slug)
    forged = {
        "status": "COMPLETED",
        "currentStageId": "restore-the-pages",
        "completedStageIds": ["meet-quill", "restore-the-pages"],
        "completedObjectiveIds": [],
    }
    from apps.catalog.models import Quest

    stages = Quest.objects.get(slug=slug).source["stages"]
    forged["currentStageId"] = stages[-1]["id"]
    forged["completedStageIds"] = [s["id"] for s in stages]
    assert put(client, content.a1, slug, **forged).status_code == 409
    assert not WorldChange.objects.filter(child=content.a1).exists()
    assert not InventoryItem.objects.filter(child=content.a1).exists()
