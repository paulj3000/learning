"""Treasure Cove's redesigned adventure (#102) through the play API, decided by Django.

The five stages are 3D Area puzzles; each that ends at a chest records the chest's own key, so
the chest opens without its old question and the quest, rewards and bridge work as before. Uses
the shared `treasure` fixture (the seeded, published cove) with the stage puzzles published, the
way `publish_treasure_rush` leaves a developer's database.
"""

import json

import pytest

from apps.catalog import authoring
from apps.core.content_status import ContentStatus
from apps.education.models import SkillEvidence
from apps.game_sessions.models import ChallengeAttempt, PuzzleAttempt
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import treasure_cove_stages as stages
from apps.regions.models import AreaPuzzle, PuzzleKind, TreasureChest, WorldRegion
from apps.regions.pips_treasure_seed import (
    ADVENTURE_VERSION,
    KEY_ENTITY_ID,
    PIPS_QUEST_ID,
    QUEST_COMPLETE_KEY,
    REPLAY_CHANGE_KEY,
    upgrade_pips_treasure,
)
from apps.regions.seeding import SeedContentInvalid, seed_puzzle

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

REGION = "treasure-rush-cove"
LANDING, GROVE, BEACH, PEDESTAL, FINAL = (
    "cove-chest",
    "cove-grove-chest",
    "cove-beach-chest",
    "cove-ruins-pedestal",
    "cove-final-chest",
)
STAGE_CHESTS = (LANDING, GROVE, BEACH, PEDESTAL, FINAL)
PIP = "cove-pip"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


class Play:
    """One child playing the redesigned cove through the API, as the game client does."""

    def __init__(self, client, child):
        self.client, self.child = client, child
        self.base = f"/api/v1/children/{child.pk}/"
        self.session = post(client, f"{self.base}regions/{REGION}/session/").json()["sessionId"]

    def region(self) -> dict:
        return self.client.get(f"{self.base}regions/{REGION}/").json()

    def chests(self) -> dict:
        return {c["entityId"]: c for c in self.region()["chests"]}

    def puzzle(self, puzzle_id) -> dict:
        return next(p for p in self.region()["puzzles"] if p["puzzleId"] == puzzle_id)

    def accept(self):
        return post(self.client, f"{self.base}quests/{PIPS_QUEST_ID}/accept/")

    def submit(self, puzzle_id, submission):
        url = f"{self.base}sessions/{self.session}/puzzles/{puzzle_id}/solve/"
        return post(self.client, url, {"submission": submission})

    def challenge(self, entity_id):
        url = f"{self.base}sessions/{self.session}/chests/{entity_id}/challenge/"
        return post(self.client, url)

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

    # -- answers, from the parameters the server sends (nothing secret is sent) ---------------

    def variant(self, puzzle_id, index=0) -> dict:
        return self.puzzle(puzzle_id)["parameters"]["variants"][index]

    def right(self, puzzle_id, index=0) -> dict:
        variant = self.variant(puzzle_id, index)
        if "options" in variant:
            return {"variantId": variant["id"], "choice": variant["answer"]}
        return {"variantId": variant["id"], "order": variant["answer"]}

    def wrong(self, puzzle_id, index=0) -> dict:
        variant = self.variant(puzzle_id, index)
        if "options" in variant:
            other = next(o["id"] for o in variant["options"] if o["id"] != variant["answer"])
            return {"variantId": variant["id"], "choice": other}
        return {"variantId": variant["id"], "order": list(reversed(variant["answer"]))}

    def solve(self, puzzle_id, *, wrong_first=False) -> dict:
        if wrong_first:
            missed = self.submit(puzzle_id, self.wrong(puzzle_id))
            assert missed.status_code == 200 and missed.json()["correct"] is False
        kind = self.puzzle(puzzle_id)["kind"]
        submission = {} if kind == "COLLECT_OBJECT" else self.right(puzzle_id)
        response = self.submit(puzzle_id, submission)
        assert response.status_code == 200, response.json()
        body = response.json()
        assert body["correct"] is True, body
        return body


def publish_stages():
    AreaPuzzle.objects.filter(region__region_id=REGION).update(status=ContentStatus.PUBLISHED)


@pytest.fixture
def stages_published(treasure):
    publish_stages()
    return treasure


@pytest.fixture
def play(stages_published, api):
    return Play(api(stages_published.families.a), stages_published.families.a1)


def as_band(play, band):
    play.child.age_band = band
    play.child.save(update_fields=["age_band"])
    return play


def keys(child) -> set[str]:
    return set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))


def items(child) -> list[str]:
    return sorted(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


def play_every_stage(play, *, wrong_first=False):
    """The whole adventure, in story order, the way a child plays it."""
    play.accept()
    for n in (1, 2, 3):
        play.solve(f"cove-map-piece-{n}")
    play.solve("cove-treasure-map", wrong_first=wrong_first)
    play.solve("cove-crocodile-creek", wrong_first=wrong_first)
    assert play.pickup().status_code in (200, 201)
    play.solve("cove-supply-dock", wrong_first=wrong_first)
    for n in (1, 2, 3):
        play.solve(f"cove-cave-carving-{n}")
    play.solve("cove-forgotten-cave", wrong_first=wrong_first)
    return play.solve("cove-lost-treasure", wrong_first=wrong_first)


# --- the seed -------------------------------------------------------------------------------------


def test_the_seed_adds_eleven_stage_puzzles_in_story_order_and_their_objects(treasure):
    region = treasure.region
    puzzles = list(region.puzzles.order_by("sort_order"))
    assert [p.puzzle_id for p in puzzles] == [row[0] for row in stages.puzzle_rows()]
    assert len(puzzles) == 11
    placed = set(region.placements.values_list("entity_id", flat=True))
    for puzzle in puzzles:
        assert set(puzzle.entity_ids) <= placed
    kinds = {p.kind for p in puzzles}
    # At least three distinct interactive mechanics (the issue's floor), none of them a chest.
    assert {PuzzleKind.COLLECT_OBJECT, PuzzleKind.CHOOSE_ANSWER, PuzzleKind.ORDER_SEQUENCE} <= kinds
    assert region.scene["adventureVersion"] == ADVENTURE_VERSION
    stand_ins = {e["entityId"] for e in region.scene["effects"]["standIns"]}
    assert {row["entity_id"] for row in stages.placement_rows()} <= stand_ins


def test_every_stage_has_parameters_for_all_three_age_bands(treasure):
    for puzzle in treasure.region.puzzles.all():
        body = authoring.current_body(puzzle)
        assert set(body["ageBands"]) == {"SPROUT", "PATHFINDER", "EXPLORER"}, puzzle.puzzle_id


def test_chest_stages_record_the_chests_own_keys_and_grant_their_rewards(treasure):
    by_key = {p.world_change_key: p for p in treasure.region.puzzles.all()}
    for chest in TreasureChest.objects.filter(region=treasure.region, entity_id__in=STAGE_CHESTS):
        puzzle = by_key[chest.world_change_key]
        assert puzzle.reward_rule_id == chest.reward_rule_id, chest.entity_id


def test_reseeding_creates_nothing_new_and_keeps_an_administrators_edit(treasure):
    from apps.regions.treasure_rush_seed import seed_treasure_rush

    TreasureChest.objects.filter(entity_id=GROVE).update(clue="Staff wrote this clue.")
    assert seed_treasure_rush() == []
    assert TreasureChest.objects.get(entity_id=GROVE).clue == "Staff wrote this clue."


def test_a_version_one_region_is_upgraded_once_and_keeps_staff_clues(treasure):
    region = treasure.region
    old = stages.CLUES
    TreasureChest.objects.filter(region=region, entity_id=LANDING).update(clue=old[LANDING][0])
    TreasureChest.objects.filter(region=region, entity_id=BEACH).update(clue="A staff clue.")
    region.scene = {
        **{k: v for k, v in region.scene.items() if k != "effects"},
        "adventureVersion": 1,
    }
    region.save()
    assert upgrade_pips_treasure(region) is True
    assert TreasureChest.objects.get(entity_id=LANDING).clue == old[LANDING][1]
    assert TreasureChest.objects.get(entity_id=BEACH).clue == "A staff clue."
    region.refresh_from_db()
    assert region.scene["adventureVersion"] == ADVENTURE_VERSION
    assert len(region.scene["effects"]["standIns"]) == len(stages.placement_rows())
    assert upgrade_pips_treasure(region) is False


# --- the authoring rule (#102) --------------------------------------------------------------------


def test_a_puzzle_may_record_the_key_of_a_chest_in_its_own_area_only(treasure):
    from apps.catalog.models import Location
    from apps.regions.models import PlacementKind, WorldObjectPlacement

    free = Location.objects.exclude(pk__in=WorldRegion.objects.values("location_id")).first()
    other = WorldRegion.objects.create(region_id="stages-test-other", location=free, title="Other")
    WorldObjectPlacement.objects.create(
        region=other, entity_id="other-thing", kind=PlacementKind.PROP, label="Thing", x=0, z=0
    )
    body = {
        "puzzleId": "other-steals-a-chest",
        "kind": "COLLECT_OBJECT",
        "title": "Not yours",
        "requiresChangeKeys": [],
        "worldChangeKey": "TREASURE_COVE_GROVE_CHEST_OPENED",  # a cove chest's key
        "rewardRuleId": None,
        "ageBands": {"PATHFINDER": {"discoveryMessage": "Found it.", "hints": []}},
    }
    with pytest.raises(SeedContentInvalid, match="already recorded by something else"):
        seed_puzzle(
            other,
            puzzle_id="other-steals-a-chest",
            kind="COLLECT_OBJECT",
            entity_ids=["other-thing"],
            body=body,
        )


def test_two_puzzles_still_cannot_share_a_key(treasure):
    body = authoring.current_body(treasure.region.puzzles.get(puzzle_id="cove-map-piece-1"))
    with pytest.raises(SeedContentInvalid, match="already recorded by something else"):
        seed_puzzle(
            treasure.region,
            puzzle_id="cove-map-piece-copy",
            kind="COLLECT_OBJECT",
            entity_ids=["cove-map-piece-1"],
            body={**body, "puzzleId": "cove-map-piece-copy"},
        )


def test_a_puzzle_may_not_record_the_key_of_a_replay_activity(treasure):
    # A replay (TR-20) never opens, so a puzzle "opening" it would leave it locked for good.
    body = authoring.current_body(treasure.region.puzzles.get(puzzle_id="cove-map-piece-1"))
    with pytest.raises(SeedContentInvalid, match="replay activity"):
        seed_puzzle(
            treasure.region,
            puzzle_id="cove-spyglass-copy",
            kind="COLLECT_OBJECT",
            entity_ids=["cove-map-piece-1"],
            body={**body, "puzzleId": "cove-spyglass-copy", "worldChangeKey": REPLAY_CHANGE_KEY},
        )


# --- chests never ask their old question ----------------------------------------------------------


def test_a_chest_a_stage_opens_never_issues_its_old_question(play):
    play.accept()
    chests = play.chests()
    assert chests[LANDING]["lockReason"] == "PUZZLE"
    for entity_id in STAGE_CHESTS:
        refused = play.challenge(entity_id)
        assert refused.status_code == 409, entity_id
        assert refused.json()["error"]["code"] == "chest_locked"
    assert not ChallengeAttempt.objects.filter(child=play.child).exists()


def test_with_the_stages_unpublished_the_chests_keep_their_old_questions(treasure, api):
    child = treasure.families.a1
    play = Play(api(treasure.families.a), child)
    assert play.chests()[LANDING]["lockReason"] is None
    assert play.challenge(LANDING).status_code in (200, 201)


def test_the_stages_unlock_in_story_order(play):
    play.accept()
    locked = {p["puzzleId"]: p["locked"] for p in play.region()["puzzles"]}
    assert not locked["cove-map-piece-1"] and locked["cove-treasure-map"]
    assert locked["cove-crocodile-creek"] and locked["cove-lost-treasure"]
    refused = play.submit("cove-treasure-map", play.right("cove-treasure-map"))
    assert refused.status_code == 409
    for n in (1, 2, 3):
        play.solve(f"cove-map-piece-{n}")
    assert play.puzzle("cove-treasure-map")["locked"] is False


def test_the_dock_needs_the_brass_key_from_the_sand(play):
    play.accept()
    for n in (1, 2, 3):
        play.solve(f"cove-map-piece-{n}")
    play.solve("cove-treasure-map")
    play.solve("cove-crocodile-creek")
    assert play.puzzle("cove-supply-dock")["locked"] is True
    assert play.chests()[BEACH]["lockReason"] == "ITEM"
    play.pickup()
    assert play.puzzle("cove-supply-dock")["locked"] is False
    assert play.chests()[BEACH]["lockReason"] == "PUZZLE"


# --- the whole adventure, every age band ----------------------------------------------------------


@pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
def test_a_new_child_plays_every_stage_to_the_end_in_each_age_band(play, band):
    as_band(play, band)
    finale = play_every_stage(play)
    assert finale["solvedNow"] is True and finale["newItems"]
    chests = play.chests()
    assert all(chests[entity_id]["isOpen"] for entity_id in STAGE_CHESTS)
    assert items(play.child) == sorted(
        [
            "golden-doubloon",
            "old-brass-key",
            "palm-grove-pearl",
            "ruins-sunstone",
            "shipwreck-compass",
        ]
    )
    # No chest question was ever asked: learning happened in the stages.
    assert not ChallengeAttempt.objects.filter(child=play.child).exists()
    body = play.talk().json()
    progress = QuestProgress.objects.get(child=play.child, quest__slug=PIPS_QUEST_ID)
    assert progress.status == QuestStatus.COMPLETED, body
    assert QUEST_COMPLETE_KEY in keys(play.child)


def test_each_band_gets_its_own_parameters(play):
    seen = {}
    for band in ("SPROUT", "PATHFINDER", "EXPLORER"):
        as_band(play, band)
        creek = play.puzzle("cove-crocodile-creek")["parameters"]
        seen[band] = len(creek["itemEntities"])
    assert seen == {"SPROUT": 3, "PATHFINDER": 4, "EXPLORER": 5}


def test_skill_evidence_is_recorded_for_the_learning_stages_only(play):
    play_every_stage(play)
    evidence = SkillEvidence.objects.filter(child=play.child)
    attempts = PuzzleAttempt.objects.filter(child=play.child)
    learning = {"cove-treasure-map", "cove-crocodile-creek", "cove-supply-dock"} | {
        "cove-forgotten-cave",
        "cove-lost-treasure",
    }
    assert evidence.count() == len(learning)
    assert set(attempts.filter(evidence__isnull=False).values_list("puzzle_key", flat=True)) == (
        learning
    )


def test_a_wrong_try_opens_nothing_counts_a_failure_and_the_next_try_is_supported(play):
    play.accept()
    for n in (1, 2, 3):
        play.solve(f"cove-map-piece-{n}")
    missed = play.submit("cove-treasure-map", play.wrong("cove-treasure-map")).json()
    assert missed["correct"] is False and missed["failedAttempts"] == 1
    assert play.chests()[LANDING]["isOpen"] is False
    assert play.puzzle("cove-treasure-map")["failedAttempts"] == 1
    play.solve("cove-treasure-map")
    assert play.chests()[LANDING]["isOpen"] is True
    levels = list(
        SkillEvidence.objects.filter(child=play.child)
        .order_by("observed_at")
        .values_list("result", "support_level")
    )
    assert levels == [("INCORRECT", 0), ("CORRECT", 1)]


def test_hints_are_authored_for_every_learning_stage_and_band(play):
    for band in ("SPROUT", "PATHFINDER", "EXPLORER"):
        as_band(play, band)
        for puzzle in play.region()["puzzles"]:
            assert puzzle["parameters"]["hints"], (band, puzzle["puzzleId"])


# --- save, resume, replay and rewards -------------------------------------------------------------


def test_progress_survives_leaving_and_coming_back(play):
    play.accept()
    for n in (1, 2, 3):
        play.solve(f"cove-map-piece-{n}")
    play.solve("cove-treasure-map")
    play.leave()
    play.come_back()
    puzzles = {p["puzzleId"]: p for p in play.region()["puzzles"]}
    assert puzzles["cove-treasure-map"]["solved"] is True
    assert puzzles["cove-crocodile-creek"]["locked"] is False
    assert play.chests()[LANDING]["isOpen"] is True


def test_a_solved_stage_can_be_practised_again_without_a_second_reward(play):
    play_every_stage(play)
    granted = GrantedRule.objects.filter(child=play.child).count()
    owned = items(play.child)
    attempts = PuzzleAttempt.objects.filter(child=play.child).count()
    evidence = SkillEvidence.objects.filter(child=play.child).count()
    for puzzle_id in ("cove-crocodile-creek", "cove-supply-dock", "cove-lost-treasure"):
        for index in (0, 1):
            again = play.submit(puzzle_id, play.right(puzzle_id, index)).json()
            assert again["practice"] is True and again["correct"] is True
            assert again["newItems"] == []
    assert GrantedRule.objects.filter(child=play.child).count() == granted
    assert items(play.child) == owned
    assert PuzzleAttempt.objects.filter(child=play.child).count() == attempts
    assert SkillEvidence.objects.filter(child=play.child).count() == evidence


def test_replay_offers_more_than_one_variant_for_every_learning_stage(play):
    for band in ("SPROUT", "PATHFINDER", "EXPLORER"):
        as_band(play, band)
        for puzzle in play.region()["puzzles"]:
            if puzzle["kind"] in ("CHOOSE_ANSWER", "ORDER_SEQUENCE"):
                assert len(puzzle["parameters"]["variants"]) >= 2, (band, puzzle["puzzleId"])


def test_answers_move_between_crates_so_replay_is_not_always_the_same_crate(play):
    for band in ("SPROUT", "PATHFINDER", "EXPLORER"):
        as_band(play, band)
        variants = play.puzzle("cove-supply-dock")["parameters"]["variants"]
        assert len({v["answer"] for v in variants}) > 1, band


# --- existing children keep their progress -------------------------------------------------------


def test_a_child_who_opened_chests_the_old_way_finds_those_stages_solved(stages_published, api):
    from apps.progression.services import record_world_change

    child = stages_published.families.a1
    location = stages_published.region.location.slug
    for key in (stages.LANDING_CHEST_KEY, stages.GROVE_CHEST_KEY):
        record_world_change(
            child, location_slug=location, change_type="UNLOCK", change_key=key, payload={}
        )
    play = Play(api(stages_published.families.a), child)
    puzzles = {p["puzzleId"]: p for p in play.region()["puzzles"]}
    assert puzzles["cove-treasure-map"]["solved"] is True
    assert puzzles["cove-crocodile-creek"]["solved"] is True
    # The map pieces they never needed stay to find, and gate nothing they have done.
    assert puzzles["cove-map-piece-1"]["solved"] is False
    assert puzzles["cove-supply-dock"]["solved"] is False
    play.pickup()
    assert play.puzzle("cove-supply-dock")["locked"] is False
    # Re-solving the stage they finished the old way is practice: nothing granted again.
    again = play.submit("cove-crocodile-creek", play.right("cove-crocodile-creek")).json()
    assert again["practice"] is True and again["newItems"] == []
