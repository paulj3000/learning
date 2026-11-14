"""Lookout Point and the replay activity (TR-17, TR-20) through the play API.

The bridge itself is drawn by the client; what Django decides, and what these tests pin, is
who may use what is beyond it: the Lookout spyglass is locked until the quest is complete, it can
be played again and again, and playing it never pays out a second permanent reward.
"""

import json

import pytest
from django.core.exceptions import ValidationError

from apps.catalog.models import Location
from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.regions.activity import encounter_activity
from apps.regions.models import (
    ChestPresentation,
    PlacementKind,
    TreasureChest,
    WorldObjectPlacement,
    WorldRegion,
)

from .test_pips_treasure import (
    FINAL,
    GROVE,
    LANDING,
    QUEST_COMPLETE_KEY,
    REGION,
    SPYGLASS,
    Play,
    items,
    play_to_the_finale,
    right,
    wrong,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def play(treasure, api):
    return Play(api(treasure.families.a), treasure.families.a1)


def finish_the_quest(play):
    play_to_the_finale(play)
    assert play.talk().json()["questUpdates"][0]["status"] == "COMPLETED"


def world_changes(child) -> int:
    return WorldChange.objects.filter(child=child).count()


# --- The unlock is Django's decision ----------------------------------------------------------


def test_the_spyglass_is_locked_until_the_quest_is_complete(play):
    play.accept()
    assert play.chest(SPYGLASS)["lockReason"] == "PROGRESS"
    refused = play.challenge(SPYGLASS)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "chest_locked"


def test_four_treasures_without_returning_to_pip_do_not_unlock_the_lookout(play):
    play_to_the_finale(play)  # all four chests, but Pip has not been told
    assert play.chest(SPYGLASS)["lockReason"] == "PROGRESS"
    assert play.challenge(SPYGLASS).status_code == 409
    assert not WorldChange.objects.filter(child=play.child, change_key=QUEST_COMPLETE_KEY).exists()


def test_completing_the_quest_unlocks_the_spyglass_and_the_unlock_persists(play):
    finish_the_quest(play)
    assert play.chest(SPYGLASS)["lockReason"] is None
    play.leave()
    play.come_back()
    region = play.region()
    assert any(c["changeKey"] == QUEST_COMPLETE_KEY for c in region["worldChanges"])
    assert next(c for c in region["chests"] if c["entityId"] == SPYGLASS)["lockReason"] is None


def test_another_child_in_the_family_is_not_unlocked(play, treasure, api):
    finish_the_quest(play)
    sibling = Play(api(treasure.families.a), treasure.families.a2)
    assert sibling.chest(SPYGLASS)["lockReason"] == "PROGRESS"
    assert sibling.challenge(SPYGLASS).status_code == 409


# --- The replay activity ----------------------------------------------------------------------


def test_the_replay_can_be_played_again_and_again_and_pays_out_nothing(play):
    finish_the_quest(play)
    inventory = items(play.child)
    changes = world_changes(play.child)
    granted = GrantedRule.objects.filter(child=play.child).count()
    evidence = SkillEvidence.objects.filter(child=play.child).count()

    for round_ in range(1, 4):
        body = play.solve(SPYGLASS)
        assert body["correct"] is True
        assert body["chestOpened"] is False
        assert body["newItems"] == [] and body["rewardMessage"] is None
        assert body["questUpdates"] == [] and body["completionRewards"] == []
        assert play.chest(SPYGLASS)["isOpen"] is False  # it never opens: ready for the next round
        assert SkillEvidence.objects.filter(child=play.child).count() == evidence + round_

    assert items(play.child) == inventory
    assert world_changes(play.child) == changes
    assert GrantedRule.objects.filter(child=play.child).count() == granted
    assert InventoryItem.objects.filter(child=play.child).count() == len(inventory)


def test_each_round_is_a_fresh_challenge_and_a_wrong_answer_can_retry(play):
    finish_the_quest(play)
    first = play.challenge(SPYGLASS).json()
    miss = play.answer(first["attemptId"], wrong(first["attemptId"])).json()
    assert miss["correct"] is False and miss["canRetry"] is True
    second = play.challenge(SPYGLASS).json()
    assert second["attemptId"] != first["attemptId"] and second["attemptNumber"] == 2
    assert play.answer(second["attemptId"], right(second["attemptId"])).json()["correct"]
    third = play.challenge(SPYGLASS).json()  # opened again, never "already open"
    assert third["attemptNumber"] == 3


def test_the_replay_answer_is_still_graded_on_the_server_and_a_replay_is_refused(play):
    finish_the_quest(play)
    issued = play.challenge(SPYGLASS).json()
    assert "answer" not in json.dumps(issued)
    assert play.answer(issued["attemptId"], right(issued["attemptId"])).json()["correct"]
    again = play.answer(issued["attemptId"], right(issued["attemptId"]))
    assert again.status_code == 409 and again.json()["error"]["code"] == "attempt_already_answered"


def test_the_replay_is_not_a_chest_the_quest_or_the_region_list_counts(play):
    finish_the_quest(play)
    region_list = play.client.get(f"{play.base}regions/").json()["regions"]
    [cove] = [r for r in region_list if r["regionId"] == REGION]
    # Pip's four chests, plus Pirate's Leap's riddle drum and treasure (LAI-JMP-03), not opened here.
    assert cove["chestsTotal"] == 6 and cove["chestsOpened"] == 4
    [entry] = [q for q in play.region()["quests"] if q["questId"] != "pirates-leap"]
    assert len(entry["stages"][0]["objectives"]) == 4  # the quest still asks for four chests


def test_the_spyglass_presentation_is_reported_so_the_client_does_not_draw_a_chest(play):
    assert play.chest(SPYGLASS)["presentation"] == "REPLAY"


# --- Content rules ----------------------------------------------------------------------------


def test_a_replay_activity_cannot_carry_a_reward_or_stand_unlocked(treasure):
    spyglass = TreasureChest.objects.get(entity_id=SPYGLASS)
    assert spyglass.presentation == ChestPresentation.REPLAY
    spyglass.full_clean()

    spyglass.reward_rule = TreasureChest.objects.get(entity_id=FINAL).reward_rule
    with pytest.raises(ValidationError) as error:
        spyglass.full_clean()
    assert "reward_rule" in error.value.message_dict

    spyglass.reward_rule = None
    spyglass.required_world_change_key = ""
    with pytest.raises(ValidationError) as error:
        spyglass.full_clean()
    assert "required_world_change_key" in error.value.message_dict


def test_even_a_replay_with_a_reward_rule_added_later_grants_nothing(play):
    finish_the_quest(play)
    spyglass = TreasureChest.objects.get(entity_id=SPYGLASS)
    TreasureChest.objects.filter(pk=spyglass.pk).update(
        reward_rule=TreasureChest.objects.get(entity_id=FINAL).reward_rule
    )  # bypasses clean(): the service must hold the line on its own
    inventory = items(play.child)
    body = play.solve(SPYGLASS)
    assert body["newItems"] == [] and items(play.child) == inventory


# --- Admin: counts only -----------------------------------------------------------------------


def test_the_admin_sees_how_many_children_found_the_key_but_not_which(play):
    play.accept()
    play.solve(LANDING)
    play.pickup()
    region = WorldRegion.objects.get(region_id=REGION)
    rows = {row.entity_id: row for row in encounter_activity(region)}
    assert rows["cove-brass-key"].children == 1 and rows["cove-brass-key"].kind == "pickup"
    assert rows[LANDING].children == 1
    assert rows[GROVE].children == 0
    assert rows[SPYGLASS].children is None  # a replay records nothing
    assert all(
        isinstance(value, str | int | type(None))
        for row in rows.values()
        for value in (row.kind, row.entity_id, row.label, row.world_change_key, row.children)
    )
    assert str(play.child.pk) not in repr(list(rows.values()))


def test_children_are_counted_once_however_often_they_pick_up(play):
    play.pickup()
    play.pickup()
    region = WorldRegion.objects.get(region_id=REGION)
    rows = {row.entity_id: row for row in encounter_activity(region)}
    assert rows["cove-brass-key"].children == 1


# --- Pickups are not the cove's alone (TR-15) -------------------------------------------------


def test_a_pickup_works_in_any_region_and_is_recorded_in_that_regions_place(play, treasure, api):
    forest = Location.objects.get(slug="wonderwild-forest")
    region = WorldRegion.objects.create(
        region_id="forest-area", location=forest, title="Forest", status=ContentStatus.PUBLISHED
    )
    WorldObjectPlacement.objects.create(
        region=region,
        entity_id="forest-feather",
        kind=PlacementKind.COLLECTIBLE,
        label="Blue feather",
        x=1,
        z=1,
        pickup_change_key="FOREST_FEATHER_FOUND",
    )
    client = api(treasure.families.a)
    base = f"/api/v1/children/{treasure.families.a1.pk}/"
    started = client.post(
        f"{base}regions/forest-area/session/", "{}", content_type="application/json"
    )
    session = started.json()["sessionId"]
    url = f"{base}sessions/{session}/pickups/forest-feather/"

    first = client.post(url, "{}", content_type="application/json")
    assert first.status_code == 201 and first.json()["pickedUp"] is True
    again = client.post(url, "{}", content_type="application/json")
    assert again.status_code == 200 and again.json()["pickedUp"] is False
    found = WorldChange.objects.filter(
        child=treasure.families.a1, change_key="FOREST_FEATHER_FOUND"
    )
    assert found.count() == 1 and found.get().location_slug == "wonderwild-forest"

    # The cove's session cannot pick up what lies in the forest.
    cove_url = f"{base}sessions/{play.session}/pickups/forest-feather/"
    assert client.post(cove_url, "{}", content_type="application/json").status_code == 404
