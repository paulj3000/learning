"""The Heart of Firepeak through the play API (design sections 5 to 7): load_content, seed,
publish, then all fourteen puzzles in order for a Pathfinder and for an Explorer, pickups once,
idempotent grants, the quest, practice replay, and who may open the Area."""

import json

import pytest
from django.core.management import call_command
from django.test import override_settings

from apps.catalog.importer import import_content
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import firepeak_heart_content as content
from apps.regions import firepeak_heart_seed as seed

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = seed.REGION_ID
QUEST = seed.QUEST_ID


@pytest.fixture
def heart(families):
    import_content()
    with override_settings(DEBUG=True):
        call_command("seed_firepeak_heart", stdout=None)
        call_command("publish_firepeak_heart", stdout=None)
    return families


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def start(client, child):
    response = post(client, f"{base(child)}regions/{REGION}/session/")
    assert response.status_code in (200, 201), response.content
    return response.json()["sessionId"]


def solve(client, child, session, puzzle_id, submission):
    return post(
        client,
        f"{base(child)}sessions/{session}/puzzles/{puzzle_id}/solve/",
        {"submission": submission},
    )


def pickup(client, child, session, entity_id):
    return post(client, f"{base(child)}sessions/{session}/pickups/{entity_id}/")


def owned(child) -> set[str]:
    return set(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


def right_answer(kind, params):
    """The submission the server accepts, from the first variant's parameters."""
    if kind == "OBSERVE_FEATURES":
        return {"observed": [f["id"] for f in params["features"]]}
    if kind == "CHOOSE_ANSWER":
        variant = params["variants"][0]
        return {"variantId": variant["id"], "choice": variant["answer"]}
    if kind == "ORDER_SEQUENCE":
        variant = params["variants"][0]
        return {"variantId": variant["id"], "order": variant["answer"]}
    return {}


def wrong_answer(kind, params):
    if kind == "CHOOSE_ANSWER":
        variant = params["variants"][0]
        other = next(o["id"] for o in variant["options"] if o["id"] != variant["answer"])
        return {"variantId": variant["id"], "choice": other}
    if kind == "ORDER_SEQUENCE":
        variant = params["variants"][0]
        return {"variantId": variant["id"], "order": list(reversed(variant["answer"]))}
    return None


def play_all(client, child, band):
    session = start(client, child)
    assert post(client, f"{base(child)}quests/{QUEST}/accept/").status_code in (200, 201)
    for puzzle_id, kind, _entities, body in content.puzzle_rows():
        params = body["ageBands"][band]
        wrong = wrong_answer(kind, params)
        if wrong:
            assert solve(client, child, session, puzzle_id, wrong).json()["correct"] is False
        outcome = solve(client, child, session, puzzle_id, right_answer(kind, params)).json()
        assert outcome["correct"] and outcome["solvedNow"], (puzzle_id, outcome)
    return session


@pytest.mark.parametrize("band", ["PATHFINDER", "EXPLORER"])
def test_all_fourteen_puzzles_in_order_complete_the_quest(heart, api, band):
    child = heart.a1
    child.age_band = band
    child.save()
    client = api(heart.a)
    session = start(client, child)
    post(client, f"{base(child)}quests/{QUEST}/accept/")

    rows = content.puzzle_rows()
    # Order is the server's: the second puzzle is locked until the map is read.
    second = rows[1]
    locked = solve(client, child, session, second[0], right_answer(second[1], second[3]["ageBands"][band]))
    assert locked.json()["error"]["code"] == "puzzle_locked"

    for puzzle_id, kind, _entities, body in rows:
        params = body["ageBands"][band]
        wrong = wrong_answer(kind, params)
        if wrong:
            assert solve(client, child, session, puzzle_id, wrong).json()["correct"] is False
        outcome = solve(client, child, session, puzzle_id, right_answer(kind, params)).json()
        assert outcome["correct"] and outcome["solvedNow"], (puzzle_id, outcome)

    progress = QuestProgress.objects.get(child=child, quest__slug=QUEST)
    assert progress.status == QuestStatus.COMPLETED
    keys = set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
    assert {row[3]["worldChangeKey"] for row in rows} <= keys
    assert "FIREPEAK_HEART_COMPLETE" in keys
    assert {
        "fh-badge-heart-of-firepeak",
        "fh-badge-first-steps",
        "fh-badge-forge-master",
        "fh-badge-volcano-scientist",
        "fh-crystal-forest",
        "fh-crystal-magma",
        "fh-crystal-cavern",
        "fh-crystal-forge",
        # Set completion (server grant, FPV-18): all four elemental crystals.
        "fh-badge-crystal-collector",
    } <= owned(child)


def test_each_pickup_is_granted_once_and_grants_are_idempotent(heart, api):
    child = heart.a1
    client = api(heart.a)
    session = play_all(client, child, "PATHFINDER")
    grants = GrantedRule.objects.filter(child=child).count()
    shards = [p["entity_id"] for p in seed.layout.placements() if p["kind"] == "COLLECTIBLE"]
    for entity in shards:
        assert pickup(client, child, session, entity).status_code in (200, 201), entity
    assert {i for i in owned(child) if i.startswith("fh-shard-item-")} != set()
    after_pickups = GrantedRule.objects.filter(child=child).count()
    assert after_pickups == grants + len(shards)
    # Every shard owned completes the ember-shard set exactly once (FPV-18).
    assert "fh-badge-master-explorer" in owned(child)
    assert InventoryItem.objects.filter(child=child, item__item_id="fh-badge-master-explorer").count() == 1
    for entity in shards:
        pickup(client, child, session, entity)
    for puzzle_id, kind, _e, body in content.puzzle_rows():
        solve(client, child, session, puzzle_id, right_answer(kind, body["ageBands"]["PATHFINDER"]))
    assert GrantedRule.objects.filter(child=child).count() == after_pickups
    assert InventoryItem.objects.filter(child=child, item__item_id__startswith="fh-shard-item-").count() >= 1


def test_practice_replay_on_a_solved_choose_answer_records_nothing(heart, api):
    child = heart.a1
    client = api(heart.a)
    session = start(client, child)
    rows = content.puzzle_rows()
    solve(client, child, session, rows[0][0], right_answer(rows[0][1], rows[0][3]["ageBands"]["PATHFINDER"]))
    pid, kind, _e, body = rows[1]
    params = body["ageBands"]["PATHFINDER"]
    assert solve(client, child, session, pid, right_answer(kind, params)).json()["solvedNow"]
    changes = WorldChange.objects.filter(child=child).count()
    grants = GrantedRule.objects.filter(child=child).count()
    items = InventoryItem.objects.filter(child=child).count()

    replay = solve(client, child, session, pid, wrong_answer(kind, params)).json()
    assert replay["practice"] is True and replay["alreadySolved"] is True and replay["correct"] is False
    again = solve(client, child, session, pid, right_answer(kind, params)).json()
    assert again["practice"] is True and again["correct"] is True and again["newItems"] == []

    assert WorldChange.objects.filter(child=child).count() == changes
    assert GrantedRule.objects.filter(child=child).count() == grants
    assert InventoryItem.objects.filter(child=child).count() == items


def test_the_bootstrap_offers_the_quest_and_the_five_npcs(heart, api):
    client, child = api(heart.a), heart.a1
    body = client.get(f"{base(child)}regions/{REGION}/").json()
    assert [q["questId"] for q in body["quests"]] == [QUEST]
    assert {"flint", "kindle", "professor-basalt", "cinder", "ignis"} <= {n["npcId"] for n in body["npcs"]}
    states = {p["puzzleId"]: p for p in body["puzzles"]}
    assert len(states) == 14
    assert states["fh-landing-map"]["locked"] is False
    assert all(states[p]["locked"] for p in states if p != "fh-landing-map")
    assert body["region"]["scene"]["firepeakHeartVersion"] == seed.HEART_VERSION


def test_another_familys_child_gets_404(heart, api):
    client = api(heart.b)
    assert client.get(f"{base(heart.a1)}regions/{REGION}/").status_code == 404
    assert post(client, f"{base(heart.a1)}regions/{REGION}/session/").status_code == 404


def test_a_sprouts_child_cannot_open_the_area(heart, api):
    child = heart.a2
    child.age_band = "SPROUT"
    child.save()
    client = api(heart.a)
    assert client.get(f"{base(child)}regions/{REGION}/").status_code == 404
    assert post(client, f"{base(child)}regions/{REGION}/session/").status_code in (404, 409)
    regions = client.get(f"{base(child)}regions/").json()["regions"]
    assert REGION not in [r["regionId"] for r in regions]


def test_a_v2_save_mid_adventure_upgrades_to_one_checkpoint_list_and_keeps_everything(heart, api):
    """GE-073 save compatibility: an Area seeded at layout v2 (two checkpoint lists, platforming
    lava) upgrades to v3 on the next seed; a child part-way through keeps every row and plays on."""
    from apps.regions.models import WorldRegion

    region = WorldRegion.objects.get(region_id=REGION)
    old = dict(region.scene)
    old.pop("engineBridge")
    old["firepeakHeartVersion"] = 2
    old["copy"] = {**old["copy"], "loading": "My own words."}
    region.scene = old
    region.save()

    child, client = heart.a1, api(heart.a)
    session = start(client, child)
    assert post(client, f"{base(child)}quests/{QUEST}/accept/").status_code in (200, 201)
    first_three = content.puzzle_rows()[:3]
    for puzzle_id, kind, _entities, body in first_three:
        assert solve(client, child, session, puzzle_id, right_answer(kind, body["ageBands"]["PATHFINDER"])).json()["correct"]
    changes = set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
    items, progress = owned(child), QuestProgress.objects.get(child=child, quest__slug=QUEST)

    with override_settings(DEBUG=True):
        call_command("seed_firepeak_heart", stdout=None)
    region.refresh_from_db()
    assert region.scene["firepeakHeartVersion"] == seed.HEART_VERSION == 3
    assert region.scene["engineBridge"] == seed.layout.scene()["engineBridge"]
    assert region.scene["copy"]["loading"] == "My own words."

    assert set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True)) == changes
    assert owned(child) == items
    after = QuestProgress.objects.get(child=child, quest__slug=QUEST)
    assert (after.status, after.completed_objective_ids, after.completed_stage_ids) == (
        progress.status,
        progress.completed_objective_ids,
        progress.completed_stage_ids,
    )
    # Play continues on the upgraded Area: the next puzzle solves, the solved ones are practice.
    puzzle_id, kind, _entities, body = content.puzzle_rows()[3]
    session = start(client, child)
    assert solve(client, child, session, puzzle_id, right_answer(kind, body["ageBands"]["PATHFINDER"])).json()["solvedNow"]
