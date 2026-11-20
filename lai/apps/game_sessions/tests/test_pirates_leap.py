"""Treasure Cove: Pirate's Leap (LAI-JMP-03) through the seed and the play API.

The course itself is client-side (platforms, checkpoints, recovery); what Django decides is the
quest, the chest and riddle challenges, the collectibles and the rewards, each once per child.
"""

import json

import pytest

from apps.catalog.models import Quest
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.game_sessions.tests.test_pips_treasure import REGION, Play, items, right, wrong
from apps.inventory.models import InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import pirates_leap_seed as leap
from apps.regions.engine_bridge import engine_bridge_problems
from apps.regions.models import TreasureChest, WorldObjectPlacement, WorldRegion
from apps.regions.platforming import layout_problems
from apps.regions.treasure_rush_seed import seed_treasure_rush

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


@pytest.fixture
def play(treasure, api):
    # The shared fixture publishes the cove's own specs by name; publish the course's too, as
    # `manage.py publish_treasure_rush` does for every chest of the region.
    ChallengeSpec.objects.filter(slug__startswith="pirates-leap-").update(
        status=ContentStatus.PUBLISHED
    )
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
    # Since course v4 the platforms run in the engine bridge (GE-071).
    ids = {p["id"] for p in _capability(scene["engineBridge"], "gameplay.platforms")["platforms"]}
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


def test_the_course_snapshots_the_frontend_tests_load_are_current():
    rewrite = "Run `python -m apps.regions.pirates_leap_seed` from lai/ to rewrite the snapshots."
    stored = json.loads(leap.COURSE_SNAPSHOT_PATH.read_text())
    assert stored == json.loads(json.dumps(leap.leap_platforming())), rewrite
    bridge = json.loads(leap.BRIDGE_SNAPSHOT_PATH.read_text())
    assert bridge == json.loads(json.dumps(leap.leap_engine_bridge())), rewrite


# --- GE-071: the course on the Game Engine Core ---------------------------------------------------


def _capability(bridge, capability_id):
    return next(c["config"] for c in bridge["capabilities"] if c["id"] == capability_id)


def test_the_seed_splits_the_course_between_the_live_runtime_and_the_engine_bridge(treasure):
    scene = treasure.region.scene
    assert scene["piratesLeapVersion"] == leap.LEAP_VERSION
    # Live: only Pip's section zones; every platform and the plate run in the engine (v4).
    assert scene["platforming"]["platforms"] == []
    assert scene["platforming"]["pressurePlates"] == []
    assert scene["platforming"]["zones"]
    # Engine: the one checkpoint system, the water pools, the goal and jump tracking.
    bridge = scene["engineBridge"]
    assert bridge == leap.leap_engine_bridge()
    assert engine_bridge_problems(bridge) == []
    assert [c["id"] for c in bridge["capabilities"]] == [
        "gameplay.checkpoints",
        "gameplay.hazards",
        "gameplay.jumpChallenges",
        "gameplay.triggers",
        "gameplay.platforms",
    ]
    assert bridge["allowEnginePlatforms"] is True
    # The whole course, as authored, still passes the full live safety checks.
    assert leap.course_problems() == []


def test_the_bridge_keeps_every_checkpoint_pool_and_goal_exactly_as_authored():
    course = leap._authored_course()
    bridge = leap.leap_engine_bridge()
    checkpoints = _capability(bridge, "gameplay.checkpoints")
    assert [
        (c["id"], c["label"], c["position"]["x"], c["position"]["z"], c["yaw"])
        for c in checkpoints["checkpoints"]
    ] == [(c["id"], c["label"], c["x"], c["z"], c["yaw"]) for c in course["checkpoints"]]
    assert all(c["position"]["y"] == 0.0 for c in checkpoints["checkpoints"])  # ground level
    assert [g["id"] for g in checkpoints["goals"]] == ["leap-goal-nest"]
    hazards = _capability(bridge, "gameplay.hazards")["hazards"]
    assert {h["id"] for h in hazards} == {h["id"] for h in course["hazards"]}
    ids = {c["id"] for c in checkpoints["checkpoints"]}
    assert all(h["checkpointId"] in ids and h["kind"] == "WATER" for h in hazards)


def test_every_required_jump_has_a_walking_route_and_both_are_equal():
    challenges = _capability(leap.leap_engine_bridge(), "gameplay.jumpChallenges")["challenges"]
    by_id = {c["challengeId"]: c for c in challenges}
    assert set(by_id) == {"leap-steps", "leap-barrels", "leap-logs", "leap-ledge"}
    for challenge in challenges:
        kinds = [r["kind"] for r in challenge["routes"]]
        assert "JUMP" in kinds
        if not challenge["optional"]:
            assert "ACCESSIBLE" in kinds, challenge["challengeId"]
    # Only the training steps are jump-only, and nothing required depends on them.
    assert [c["challengeId"] for c in challenges if c["optional"]] == ["leap-steps"]
    # The treasure ledge is reached on foot by the stairs (owner decision 2026-11-19); the
    # plate-driven lift is a second, optional way up.
    walking = [r["routeId"] for r in by_id["leap-ledge"]["routes"] if r["kind"] == "ACCESSIBLE"]
    assert walking == ["leap-ledge-stairs", "leap-ledge-lift"]


def test_the_stairs_reach_the_ledge_one_walkable_step_at_a_time():
    """No jump and no moving platform is ever needed for the treasure (owner decision)."""
    platforms = {p["id"]: p for p in leap._authored_course()["platforms"]}
    stairs = [platforms[f"leap-stair-{n}"] for n in range(1, leap.STAIR_COUNT + 1)]
    tops = [s["position"]["y"] + s["size"]["height"] for s in stairs]
    rises = [b - a for a, b in zip([0.0, *tops], tops, strict=False)]
    assert all(0 < rise <= 0.25 for rise in rises)  # each step within a walked step-up
    assert tops[-1] == pytest.approx(leap.LEDGE_TOP)
    assert all(min(s["size"]["width"], s["size"]["depth"]) >= 0.8 for s in stairs)  # 0.8 m tops
    # Static: no step moves, vanishes or bounces.
    assert not any(k in s for s in stairs for k in ("motion", "vanish", "bounce", "activation"))

    # Each step touches the next one, and the top step touches the ledge.
    def box(p):
        x, z = p["position"]["x"], p["position"]["z"]
        w, d = p["size"]["width"] / 2, p["size"]["depth"] / 2
        return (x - w, x + w, z - d, z + d)

    def touch(a, b):
        ax0, ax1, az0, az1 = box(a)
        bx0, bx1, bz0, bz1 = box(b)
        return ax0 <= bx1 + 1e-6 and bx0 <= ax1 + 1e-6 and az0 <= bz1 + 1e-6 and bz0 <= az1 + 1e-6

    for lower, upper in zip(stairs, stairs[1:], strict=False):
        assert touch(lower, upper), (lower["id"], upper["id"])
    assert touch(stairs[-1], platforms["leap-ledge"])


def test_an_older_course_is_upgraded_once_and_keeps_staff_tuning(treasure):
    region = treasure.region
    old = {
        **region.scene,
        "piratesLeapVersion": 1,
        "platforming": leap._authored_course(),  # v1 kept checkpoints and pools in the live block
        "platformTuning": {"leap-moving-dock": {"speed": 0.8}},
    }
    old.pop("engineBridge", None)
    region.scene = old
    region.save()
    assert leap.upgrade_pirates_leap(region) is True
    region.refresh_from_db()
    assert region.scene["platforming"] == leap.leap_platforming()
    assert region.scene["engineBridge"] == leap.leap_engine_bridge()
    assert region.scene["platformTuning"] == {"leap-moving-dock": {"speed": 0.8}}
    assert leap.upgrade_pirates_leap(region) is False


def test_the_quest_completes_only_through_the_crows_nest_chest(treasure):
    """The shared scoring adapter (GE-109) derives the course award from this quest's completion
    and relies on it being reached only by the crow's-nest chest's server-graded challenge, which
    the walking route reaches too. If this ever changes, tell the scoring lead first."""
    quest = Quest.objects.get(slug=leap.LEAP_QUEST_ID)
    keys = {
        objective["changeKey"]
        for stage in quest.source["stages"]
        for objective in stage["objectives"]
    }
    assert keys == {leap.LEAP_CHEST_KEY}
    holders = list(
        TreasureChest.objects.filter(world_change_key=leap.LEAP_CHEST_KEY).values_list(
            "entity_id", flat=True
        )
    )
    assert holders == [leap.LEAP_CHEST_ID]
    assert not WorldObjectPlacement.objects.filter(pickup_change_key=leap.LEAP_CHEST_KEY).exists()


def test_the_course_never_needs_a_jump_to_finish():
    course = leap._authored_course()
    by_id = {p["id"]: p for p in course["platforms"]}
    # The lift is stepped onto (top within a 0.25 m step) and carries the child to the ledge top.
    lift = by_id["leap-lift"]
    assert lift["position"]["y"] + lift["size"]["height"] <= 0.25
    assert lift["position"]["y"] + lift["size"]["height"] + lift["motion"]["path"][0][
        "y"
    ] == pytest.approx(leap.LEDGE_TOP)
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
    for entity_id, item in (
        (leap.LEAP_SHELL_ID, "pirates-leap-shell"),
        (leap.LEAP_FEATHER_ID, "pirates-leap-feather"),
    ):
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


def test_the_feather_names_its_model_once_imported_and_keeps_a_childs_find(play):
    """Feather defect: the placement gains the `feather` model when the asset exists; its id,
    pickup key and reward are unchanged, so a feather already found stays found."""
    from apps.catalog.models import ContentAsset
    from apps.regions.models import WorldObjectPlacement

    region = WorldRegion.objects.get(region_id=REGION)
    feather = WorldObjectPlacement.objects.get(region=region, entity_id=leap.LEAP_FEATHER_ID)
    assert feather.asset_id == ""
    # Not imported yet: nothing changes.
    assert leap.link_feather_model(region) is False
    # A child picks it up before the model exists.
    assert play.pickup(leap.LEAP_FEATHER_ID).status_code in (200, 201)
    assert owned(play.child, "pirates-leap-feather") == 1

    ContentAsset.objects.create(
        asset_id="feather", kind="prop", category="prop", display_name="Feather", origin="DJANGO"
    )
    assert leap.link_feather_model(region) is True
    feather.refresh_from_db()
    assert feather.asset_id == "feather"
    feather.full_clean()  # a valid reference for a collectible
    assert (feather.pickup_change_key, feather.pickup_reward_rule.rule_id) == (
        leap.LEAP_FEATHER_KEY,
        "reward-pirates-leap-feather",
    )
    # Idempotent, and an administrator's own choice is never replaced.
    assert leap.link_feather_model(region) is False
    WorldObjectPlacement.objects.filter(pk=feather.pk).update(asset_id="prop-wooden-barrel")
    assert leap.link_feather_model(region) is False
    # The child's find survives (same entity id, same item).
    assert owned(play.child, "pirates-leap-feather") == 1
    play.pickup(leap.LEAP_FEATHER_ID)
    assert owned(play.child, "pirates-leap-feather") == 1
    # The play API still serves the feather by its id, now naming its model.
    served = {o["entityId"]: o for o in play.region()["objects"]}
    assert served[leap.LEAP_FEATHER_ID]["collected"] is True


def test_every_platform_moves_to_the_engine_unchanged_and_only_extras_are_optional():
    """Course v4: same places, sizes and timings; the lift and the dock are optional extras."""
    authored = {p["id"]: p for p in leap._authored_course()["platforms"]}
    engine = {
        p["id"]: p
        for p in _capability(leap.leap_engine_bridge(), "gameplay.platforms")["platforms"]
    }
    assert set(engine) == set(authored)
    for pid, spec in engine.items():
        live = authored[pid]
        assert spec["position"] == live["position"]
        assert spec["size"] == {
            "x": live["size"]["width"],
            "y": live["size"]["height"],
            "z": live["size"]["depth"],
        }
        assert spec.get("color") == live.get("color")
        assert spec.get("assetId") == live.get("assetId")
        if "motion" in live:
            assert spec["moving"]["speed"] == live["motion"]["speed"]
            assert spec["moving"]["path"] == live["motion"]["path"]
    required = {pid for pid, spec in engine.items() if spec["route"] == "REQUIRED"}
    assert required == leap.REQUIRED_PLATFORMS
    # The engine allows moving, falling and bounce platforms only as optional extras.
    for spec in engine.values():
        if any(k in spec for k in ("moving", "falling", "bounceHeight")):
            assert spec["route"] == "OPTIONAL", spec["id"]
    assert engine["leap-lift"]["moving"]["activeSignalId"] == "leap-lift-plate"
    assert engine["leap-secret-bridge"]["appearSignalId"] == f"world:{leap.LEAP_RIDDLE_KEY}"
    plates = _capability(leap.leap_engine_bridge(), "gameplay.triggers")["plates"]
    assert [(p["id"], p["latch"]) for p in plates] == [("leap-lift-plate", True)]


def test_staff_tuning_still_validates_for_the_engine_platforms(treasure):
    from apps.regions.platforming import tuning_problems

    scene = treasure.region.scene
    assert tuning_problems(scene, {"leap-moving-dock": {"speed": 0.8}}) == []
    assert tuning_problems(scene, {"no-such-platform": {"speed": 0.8}}) != []
