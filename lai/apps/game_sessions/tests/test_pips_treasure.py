"""Pip's Missing Treasure (TR-14) through the play API: four encounters, the key, the ruins
puzzle and the finale, each decided by Django.

Uses the shared `treasure` fixture (the seeded, published cove) and a parent's API client.
"""

import json

import pytest
from django.core.exceptions import ValidationError

from apps.game_sessions.models import ChallengeAttempt
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import NpcRelationship, WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions.models import (
    ChestPresentation,
    PlacementKind,
    TreasureChest,
    WorldObjectPlacement,
)
from apps.regions.pips_treasure_seed import (
    KEY_ENTITY_ID,
    PIPS_QUEST_ID,
    PUZZLE_SOLVED_KEY,
    QUEST_COMPLETE_KEY,
    RUNE_STONE_IDS,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
LANDING, GROVE, BEACH, PEDESTAL, FINAL = (
    "cove-chest",
    "cove-grove-chest",
    "cove-beach-chest",
    "cove-ruins-pedestal",
    "cove-final-chest",
)
SPYGLASS = "cove-lookout-spyglass"
PIP = "cove-pip"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


class Play:
    """One child playing the cove through the API, the way the game client does."""

    def __init__(self, client, child):
        self.client, self.child = client, child
        self.base = f"/api/v1/children/{child.pk}/"
        self.session = post(client, f"{self.base}regions/{REGION}/session/").json()["sessionId"]

    def region(self) -> dict:
        return self.client.get(f"{self.base}regions/{REGION}/").json()

    def chest(self, entity_id) -> dict:
        return next(c for c in self.region()["chests"] if c["entityId"] == entity_id)

    def accept(self):
        return post(self.client, f"{self.base}quests/{PIPS_QUEST_ID}/accept/")

    def challenge(self, entity_id):
        url = f"{self.base}sessions/{self.session}/chests/{entity_id}/challenge/"
        return post(self.client, url)

    def answer(self, attempt_id, value):
        return post(self.client, f"{self.base}attempts/{attempt_id}/answer/", {"answer": value})

    def solve(self, entity_id, *, wrong_first=False) -> dict:
        issued = self.challenge(entity_id)
        assert issued.status_code in (200, 201), issued.json()
        attempt_id = issued.json()["attemptId"]
        if wrong_first:
            assert self.answer(attempt_id, wrong(attempt_id)).json()["correct"] is False
            attempt_id = self.challenge(entity_id).json()["attemptId"]
        response = self.answer(attempt_id, right(attempt_id))
        assert response.status_code == 200, response.json()
        return response.json()

    def pickup(self, entity_id=KEY_ENTITY_ID):
        return post(self.client, f"{self.base}sessions/{self.session}/pickups/{entity_id}/")

    def talk(self, entity_id=PIP):
        return post(self.client, f"{self.base}sessions/{self.session}/npcs/{entity_id}/talk/")

    def leave(self):
        post(self.client, f"{self.base}sessions/{self.session}/complete/")

    def come_back(self):
        self.session = post(self.client, f"{self.base}regions/{REGION}/session/").json()[
            "sessionId"
        ]


def right(attempt_id):
    return ChallengeAttempt.objects.get(pk=attempt_id).answer


def wrong(attempt_id):
    attempt = ChallengeAttempt.objects.get(pk=attempt_id)
    if attempt.choices:
        return next(c for c in attempt.choices if c != attempt.answer)
    return attempt.answer + 1


def leap(chest) -> bool:
    """Pirate's Leap's chests (LAI-JMP-03) share the cove; these tests are about Pip's four."""
    return chest["entityId"].startswith("cove-leap-")


def items(child) -> list[str]:
    return sorted(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


def quest(child) -> QuestProgress:
    return QuestProgress.objects.get(child=child, quest__slug=PIPS_QUEST_ID)


@pytest.fixture
def play(treasure, api):
    return Play(api(treasure.families.a), treasure.families.a1)


def play_to_the_finale(play):
    play.accept()
    play.solve(LANDING)
    play.solve(GROVE)
    play.pickup()
    play.solve(BEACH)
    play.solve(PEDESTAL)
    return play.solve(FINAL)


# --- Quest initialisation ---------------------------------------------------------------------


def test_the_cove_offers_pips_quest_and_accepting_starts_it(play):
    [offered] = [q for q in play.region()["quests"] if q["questId"] == PIPS_QUEST_ID]
    assert (offered["questId"], offered["status"]) == (PIPS_QUEST_ID, "AVAILABLE")
    body = play.accept().json()
    assert body["status"] == "ACTIVE" and body["currentStageId"] == "find-the-treasure"
    [find, back] = body["stages"]
    assert [o["id"] for o in find["objectives"]] == [
        "cove-landing-chest",
        "cove-grove-chest",
        "cove-beach-chest",
        "cove-final-chest",
    ]
    assert not any(o["complete"] for o in find["objectives"] + back["objectives"])


def test_a_chest_opened_before_accepting_counts_once_the_quest_is_accepted(play):
    play.solve(LANDING)
    body = play.accept().json()
    assert body["stages"][0]["objectives"][0]["complete"] is True


# --- Ordering and eligibility -----------------------------------------------------------------


def test_the_encounters_unlock_in_order(play):
    play.accept()
    locks = {c["entityId"]: c["lockReason"] for c in play.region()["chests"] if not leap(c)}
    assert locks == {
        LANDING: None,
        GROVE: "PROGRESS",
        BEACH: "PROGRESS",
        PEDESTAL: "PROGRESS",
        FINAL: "PROGRESS",
        SPYGLASS: "PROGRESS",
    }
    for entity_id in (GROVE, BEACH, PEDESTAL, FINAL, SPYGLASS):
        refused = play.challenge(entity_id)
        assert refused.status_code == 409 and refused.json()["error"]["code"] == "chest_locked"
    assert not ChallengeAttempt.objects.filter(child=play.child).exists()

    play.solve(LANDING)
    assert play.chest(GROVE)["lockReason"] is None
    assert play.chest(GROVE)["presentation"] == "HIDDEN"


def test_the_beach_chest_needs_the_key_once_the_grove_chest_is_open(play):
    play.accept()
    play.solve(LANDING)
    play.solve(GROVE)
    beach = play.chest(BEACH)
    assert beach["lockReason"] == "ITEM" and beach["requiredItemId"] == "old-brass-key"
    assert play.challenge(BEACH).json()["error"]["code"] == "chest_locked"


# --- Answers, chests and keepsakes ------------------------------------------------------------


def test_a_wrong_answer_opens_nothing_and_a_right_one_opens_the_chest_with_its_keepsake(play):
    play.accept()
    play.solve(LANDING)
    issued = play.challenge(GROVE).json()
    miss = play.answer(issued["attemptId"], wrong(issued["attemptId"])).json()
    assert miss["correct"] is False and miss["chestOpened"] is False
    assert play.chest(GROVE)["isOpen"] is False
    retry = play.challenge(GROVE).json()
    assert retry["attemptNumber"] == 2
    body = play.answer(retry["attemptId"], right(retry["attemptId"])).json()
    assert body["chestOpened"] and [i["itemId"] for i in body["newItems"]] == ["palm-grove-pearl"]
    assert play.chest(GROVE)["isOpen"] is True
    assert items(play.child) == ["golden-doubloon", "palm-grove-pearl"]


def test_each_chest_gives_its_own_keepsake(play):
    play_to_the_finale(play)
    assert items(play.child) == [
        "golden-doubloon",
        "old-brass-key",
        "palm-grove-pearl",
        "ruins-sunstone",
        "shipwreck-compass",
    ]


# --- The key ----------------------------------------------------------------------------------


def test_picking_up_the_key_is_recorded_once_and_unlocks_the_beach_chest(play):
    play.accept()
    play.solve(LANDING)
    play.solve(GROVE)
    first = play.pickup()
    assert first.status_code == 201
    body = first.json()
    assert body["pickedUp"] is True and body["collected"] is True
    assert [i["itemId"] for i in body["newItems"]] == ["old-brass-key"]
    again = play.pickup()
    assert again.status_code == 200
    assert again.json()["pickedUp"] is False and again.json()["newItems"] == []
    keys = InventoryItem.objects.filter(child=play.child, item__item_id="old-brass-key")
    assert keys.count() == 1
    found = WorldChange.objects.filter(child=play.child, change_key="TREASURE_COVE_KEY_FOUND")
    assert found.count() == 1
    key = next(o for o in play.region()["objects"] if o["entityId"] == KEY_ENTITY_ID)
    assert key["pickup"] is True and key["collected"] is True
    assert play.chest(BEACH)["lockReason"] is None
    assert play.solve(BEACH)["newItems"][0]["itemId"] == "shipwreck-compass"


def test_the_key_can_be_found_early_and_stays_found(play):
    play.pickup()
    play.leave()
    play.come_back()
    key = next(o for o in play.region()["objects"] if o["entityId"] == KEY_ENTITY_ID)
    assert key["collected"] is True


def test_only_a_pickup_can_be_picked_up(play):
    assert play.pickup("cove-rune-stone-1").status_code == 404  # a prop
    assert play.pickup("cove-bridge-signpost").status_code == 404
    assert play.pickup("no-such-thing").status_code == 404


def test_another_childs_session_cannot_pick_up_the_key(play, treasure, api):
    sibling_base = f"/api/v1/children/{treasure.families.a2.pk}/"
    response = post(play.client, f"{sibling_base}sessions/{play.session}/pickups/{KEY_ENTITY_ID}/")
    assert response.status_code == 404
    assert not InventoryItem.objects.filter(child=treasure.families.a2).exists()


# --- The ruins puzzle -------------------------------------------------------------------------


def test_the_puzzle_is_answered_by_rune_stones_and_graded_by_the_server(play):
    play.accept()
    for entity_id in (LANDING, GROVE):
        play.solve(entity_id)
    play.pickup()
    play.solve(BEACH)
    pedestal = play.chest(PEDESTAL)
    assert pedestal["presentation"] == "PUZZLE" and pedestal["answerEntityIds"] == RUNE_STONE_IDS
    issued = play.challenge(PEDESTAL).json()
    assert len(issued["challenge"]["choices"]) == 3
    assert "answer" not in json.dumps(issued)

    miss = play.answer(issued["attemptId"], wrong(issued["attemptId"])).json()
    assert miss["correct"] is False
    assert not WorldChange.objects.filter(child=play.child, change_key=PUZZLE_SOLVED_KEY).exists()
    assert play.chest(FINAL)["lockReason"] == "PROGRESS"

    retry = play.challenge(PEDESTAL).json()
    solved = play.answer(retry["attemptId"], right(retry["attemptId"])).json()
    assert solved["correct"] and solved["chestOpened"] and solved["newItems"] == []
    assert play.chest(PEDESTAL)["isOpen"] is True
    assert play.chest(FINAL)["lockReason"] is None


def test_a_number_not_on_any_stone_is_refused_not_graded(play):
    play.solve(LANDING)
    play.solve(GROVE)
    play.pickup()
    play.solve(BEACH)
    issued = play.challenge(PEDESTAL).json()
    choices = issued["challenge"]["choices"]
    off = next(n for n in range(0, 30) if n not in choices)
    refused = play.answer(issued["attemptId"], off)
    assert refused.status_code == 400
    assert ChallengeAttempt.objects.get(pk=issued["attemptId"]).status == "ISSUED"


# --- The finale -------------------------------------------------------------------------------


def test_four_treasures_send_the_child_back_to_pip(play):
    final = play_to_the_finale(play)
    assert [i["itemId"] for i in final["newItems"]] == ["ruins-sunstone"]
    [update] = final["questUpdates"]
    assert update["currentStageId"] == "return-to-pip" and update["status"] == "ACTIVE"
    assert quest(play.child).status == QuestStatus.ACTIVE


def test_talking_to_pip_too_early_changes_nothing(play):
    play.accept()
    play.solve(LANDING)
    body = play.talk().json()
    assert body == {"flagsSet": [], "questUpdates": [], "completionRewards": []}
    assert not NpcRelationship.objects.filter(child=play.child).exists()


def test_returning_to_pip_completes_the_quest_once_with_its_reward_and_signal(play):
    play_to_the_finale(play)
    body = play.talk().json()
    assert body["flagsSet"] == ["cove-treasure-returned"]
    [update] = body["questUpdates"]
    assert update["status"] == "COMPLETED" and update["justCompleted"]
    [reward] = body["completionRewards"]
    assert [i["itemId"] for i in reward["items"]] == ["treasure-cove-explorer"]
    assert reward["message"]
    progress = quest(play.child)
    assert progress.status == QuestStatus.COMPLETED and progress.completed_at
    assert WorldChange.objects.filter(child=play.child, change_key=QUEST_COMPLETE_KEY).count() == 1

    again = play.talk().json()
    assert again == {"flagsSet": [], "questUpdates": [], "completionRewards": []}
    assert (
        GrantedRule.objects.filter(
            child=play.child, rule__rule_id="reward-pips-missing-treasure-complete"
        ).count()
        == 1
    )
    assert items(play.child).count("treasure-cove-explorer") == 1


def test_only_an_npc_can_be_talked_to(play):
    assert play.talk(KEY_ENTITY_ID).status_code == 404
    assert play.talk("no-such-npc").status_code == 404


# --- Duplicates, leaving and returning ---------------------------------------------------------


def test_a_replayed_answer_and_a_reopened_chest_are_refused(play):
    play.accept()
    issued = play.challenge(LANDING).json()
    assert play.answer(issued["attemptId"], right(issued["attemptId"])).json()["correct"]
    replay = play.answer(issued["attemptId"], right(issued["attemptId"]))
    assert replay.status_code == 409
    assert play.challenge(LANDING).json()["error"]["code"] == "chest_already_open"
    assert items(play.child) == ["golden-doubloon"]


def test_leaving_and_returning_keeps_every_step(play):
    play.accept()
    play.solve(LANDING)
    play.solve(GROVE)
    play.pickup()
    play.leave()
    assert play.pickup().json()["error"]["code"] == "session_not_open"

    play.come_back()
    region = play.region()
    opened = {c["entityId"]: c["isOpen"] for c in region["chests"] if not leap(c)}
    assert opened == {
        LANDING: True,
        GROVE: True,
        BEACH: False,
        PEDESTAL: False,
        FINAL: False,
        SPYGLASS: False,
    }
    assert play.chest(BEACH)["lockReason"] is None  # the key is still in the backpack
    [entry] = [q for q in region["quests"] if q["questId"] == PIPS_QUEST_ID]
    done = [o["id"] for o in entry["stages"][0]["objectives"] if o["complete"]]
    assert done == ["cove-landing-chest", "cove-grove-chest"]
    play.solve(BEACH)
    play.solve(PEDESTAL)
    play.solve(FINAL)
    assert play.talk().json()["questUpdates"][0]["status"] == "COMPLETED"


def test_one_childs_adventure_is_not_anothers(play, treasure, api):
    play_to_the_finale(play)
    sibling = Play(api(treasure.families.a), treasure.families.a2)
    locks = {c["entityId"]: c["lockReason"] for c in sibling.region()["chests"]}
    assert locks[GROVE] == "PROGRESS"
    assert sibling.region()["quests"][0]["status"] == "AVAILABLE"


# --- Content rules (admin validation) ---------------------------------------------------------


def test_a_puzzle_needs_choice_challenges_matching_its_answer_objects(treasure):
    pedestal = TreasureChest.objects.get(entity_id=PEDESTAL)
    pedestal.full_clean()
    pedestal.answer_entity_ids = RUNE_STONE_IDS[:2]
    with pytest.raises(ValidationError) as error:
        pedestal.full_clean()
    assert "sprout_challenge" in error.value.message_dict
    pedestal.answer_entity_ids = [*RUNE_STONE_IDS[:2], "not-placed"]
    with pytest.raises(ValidationError) as error:
        pedestal.full_clean()
    assert "answer_entity_ids" in error.value.message_dict


def test_only_a_puzzle_has_answer_objects_and_no_chest_requires_itself(treasure):
    chest = TreasureChest.objects.get(entity_id=GROVE)
    assert chest.presentation == ChestPresentation.HIDDEN
    chest.answer_entity_ids = RUNE_STONE_IDS
    chest.required_world_change_key = chest.world_change_key
    with pytest.raises(ValidationError) as error:
        chest.full_clean()
    assert {"answer_entity_ids", "required_world_change_key"} <= set(error.value.message_dict)


def test_only_a_collectible_is_a_pickup(treasure):
    placement = WorldObjectPlacement.objects.get(entity_id="cove-rune-stone-1")
    assert placement.kind == PlacementKind.PROP
    placement.pickup_change_key = "SOMETHING"
    with pytest.raises(ValidationError) as error:
        placement.full_clean()
    assert "pickup_change_key" in error.value.message_dict
