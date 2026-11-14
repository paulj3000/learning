"""Treasure Cove: Pirate's Leap (LAI-JMP-03) through the seed and the play API.

The course itself is client-side (platforms, checkpoints, recovery); what Django decides is the
quest, the chest and riddle challenges, the collectibles and the rewards, each once per child.
"""

import json

import pytest

from apps.game_sessions.tests.test_pips_treasure import REGION, Play, items, right, wrong
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.inventory.models import InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import pirates_leap_seed as leap
from apps.regions.models import WorldRegion
from apps.regions.platforming import layout_problems
from apps.regions.treasure_rush_seed import seed_treasure_rush

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


@pytest.fixture
def play(treasure, api):
    # The shared fixture publishes the cove's own specs by name; publish the course's too, as
    # `manage.py publish_treasure_rush` does for every chest of the region.
    ChallengeSpec.objects.filter(slug__startswith="pirates-leap-").update(status=ContentStatus.PUBLISHED)
    return Play(api(treasure.families.a), treasure.families.a1)


def owned(child, item_id) -> int:
    return InventoryItem.objects.filter(child=child, item__item_id=item_id).count()


def accept_leap(play):
    return post(play.client, f"{play.base}quests/{leap.LEAP_QUEST_ID}/accept/")


def leap_quest(child) -> QuestProgress:
    return QuestProgress.objects.get(child=child, quest__slug=leap.LEAP_QUEST_ID)


# --- seed and content ---------------------------------------------------------------------------


def test_the_seed_writes_a_valid_course_into_its_own_scene_block(treasure):
    region = treasure.region
    scene = region.scene
    assert scene["piratesLeapVersion"] == leap.LEAP_VERSION
    assert layout_problems(scene["platforming"], bounds=scene["bounds"]) == []
    ids = {p["id"] for p in scene["platforming"]["platforms"]}
    assert {"leap-moving-dock", "leap-lift", "leap-ledge", "leap-nest", "leap-bounce-drum"} <= ids
    # The cove's own layout is untouched (another workstream owns its scenery).
    assert "platforming" not in scene["layout"]
    assert leap.leap_rows(region)["chests"] == [leap.LEAP_CHEST_ID, leap.LEAP_RIDDLE_ID]


def test_the_seed_is_idempotent_and_never_replaces_a_course_version(treasure):
    region = treasure.region
    version = region.version
    seed_treasure_rush()
    region.refresh_from_db()
    assert region.version == version
    # An older course version is upgraded once.
    region.scene = {**region.scene, "piratesLeapVersion": 0}
    region.save()
    assert leap.upgrade_pirates_leap(region) is True
    assert leap.upgrade_pirates_leap(region) is False


def test_the_course_snapshot_the_frontend_tests_load_is_current():
    stored = json.loads(leap.COURSE_SNAPSHOT_PATH.read_text())
    assert stored == json.loads(json.dumps(leap.leap_platforming())), (
        "Run `python -m apps.regions.pirates_leap_seed` from lai/ to rewrite the snapshot."
    )


def test_the_course_never_needs_a_jump_to_finish():
    course = leap.leap_platforming()
    by_id = {p["id"]: p for p in course["platforms"]}
    # The lift is stepped onto (top within a 0.25 m step) and carries the child to the ledge top.
    lift = by_id["leap-lift"]
    assert lift["position"]["y"] + lift["size"]["height"] <= 0.25
    assert lift["position"]["y"] + lift["size"]["height"] + lift["motion"]["path"][0]["y"] == pytest.approx(
        leap.LEDGE_TOP
    )
    assert lift["activation"]["trigger"] == "PLATE"  # a plate on the ground, no jump
    # The nest is one small step up from the ledge, and the chest stands on it.
    nest = by_id["leap-nest"]
    assert nest["position"]["y"] == leap.LEDGE_TOP and nest["size"]["height"] <= 0.25
    # The ferry is stepped onto too; the bridge the riddle raises is walkable.
    dock = by_id["leap-moving-dock"]
    assert dock["position"]["y"] + dock["size"]["height"] <= 0.25
    assert by_id["leap-secret-bridge"]["size"]["height"] <= 0.25


# --- the play API ---------------------------------------------------------------------------------


def test_pip_offers_pirates_leap_alongside_his_treasure_quest(play):
    offered = {quest["questId"]: quest["status"] for quest in play.region()["quests"]}
    assert offered[leap.LEAP_QUEST_ID] == "AVAILABLE"
    assert accept_leap(play).json()["status"] == "ACTIVE"


def test_the_secret_treasure_completes_the_quest_and_rewards_once(play):
    accept_leap(play)
    child = play.child
    body = play.solve(leap.LEAP_CHEST_ID, wrong_first=True)  # a wrong answer costs nothing
    assert body["correct"] is True
    assert "pirates-leap-medal" in items(child)
    assert leap_quest(child).status == QuestStatus.COMPLETED
    assert WorldChange.objects.filter(child=child, change_key=leap.LEAP_CHEST_KEY).count() == 1
    assert owned(child, "pirates-leap-medal") == 1

    # Replay: the chest is open; asking again grants nothing more.
    assert play.chest(leap.LEAP_CHEST_ID)["isOpen"] is True
    again = play.challenge(leap.LEAP_CHEST_ID)
    assert again.status_code >= 400
    play.leave()
    play.come_back()
    assert owned(child, "pirates-leap-medal") == 1
    assert WorldChange.objects.filter(child=child, change_key=leap.LEAP_CHEST_KEY).count() == 1


def test_the_riddle_is_optional_and_unlocks_the_bridge_world_change(play):
    accept_leap(play)
    # The treasure opens without the riddle: the educational unlock is a bonus, never a gate.
    play.solve(leap.LEAP_CHEST_ID)
    assert leap_quest(play.child).status == QuestStatus.COMPLETED
    play.solve(leap.LEAP_RIDDLE_ID)
    assert WorldChange.objects.filter(child=play.child, change_key=leap.LEAP_RIDDLE_KEY).exists()
    assert "pirates-leap-sea-star" in items(play.child)


def test_collectibles_are_picked_up_once(play):
    for entity_id, item in ((leap.LEAP_SHELL_ID, "pirates-leap-shell"), (leap.LEAP_FEATHER_ID, "pirates-leap-feather")):
        assert play.pickup(entity_id).status_code in (200, 201)
        assert item in items(play.child)
        play.pickup(entity_id)
        assert owned(play.child, item) == 1


def test_another_family_cannot_play_this_childs_course(treasure, api):
    other = api(treasure.families.b)
    response = other.get(f"/api/v1/children/{treasure.families.a1.pk}/regions/{REGION}/")
    assert response.status_code == 404


def test_a_wrong_answer_never_opens_the_chest(play):
    issued = play.challenge(leap.LEAP_CHEST_ID).json()
    assert play.answer(issued["attemptId"], wrong(issued["attemptId"])).json()["correct"] is False
    assert play.chest(leap.LEAP_CHEST_ID)["isOpen"] is False
    assert WorldRegion.objects.filter(region_id=REGION).exists()
    assert right(issued["attemptId"]) is not None