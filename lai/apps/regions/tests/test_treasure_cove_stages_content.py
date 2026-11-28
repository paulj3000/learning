"""Treasure Cove's stage content (#102): valid, kind to read aloud, and the same as the snapshot.

No database: these check the authored bodies with the server's own puzzle rules.
"""

import json

import pytest

from apps.regions import puzzles
from apps.regions import treasure_cove_stages as stages
from apps.regions.treasure_cove_layout import CREEK, STAGE_SPOTS, cove_layout

ROWS = stages.puzzle_rows()
BANDS = {"SPROUT", "PATHFINDER", "EXPLORER"}


def variants(body):
    for band, params in body["ageBands"].items():
        for variant in params.get("variants", []):
            yield band, params, variant


@pytest.mark.parametrize(
    ("puzzle_id", "kind", "entity_ids", "body"), ROWS, ids=[r[0] for r in ROWS]
)
def test_every_stage_body_passes_the_server_puzzle_rules(puzzle_id, kind, entity_ids, body):
    assert puzzles.body_problems(kind, body) == []
    assert body["puzzleId"] == puzzle_id and set(body["ageBands"]) == BANDS


@pytest.mark.parametrize(
    ("puzzle_id", "kind", "entity_ids", "body"), ROWS, ids=[r[0] for r in ROWS]
)
def test_every_answer_object_is_one_of_the_stages_own_placements(puzzle_id, kind, entity_ids, body):
    placed = {row["entity_id"] for row in stages.placement_rows()} | set(stages.RUNE_STONE_IDS)
    assert set(entity_ids) <= placed
    for params in body["ageBands"].values():
        mapping = params.get("optionEntities") or params.get("itemEntities") or {}
        assert set(mapping.values()) <= set(entity_ids)


def test_every_option_has_a_symbol_so_nothing_depends_on_colour():
    for *_, body in ROWS:
        for _, _, variant in variants(body):
            for entry in variant.get("options", []) + variant.get("items", []):
                assert entry["symbol"] in puzzles.SYMBOLS, (body["puzzleId"], entry)


def test_child_facing_text_has_no_em_dashes():
    text = json.dumps([row[3] for row in ROWS]) + json.dumps(stages.CLUES)
    assert "—" not in text


def test_the_map_always_points_to_the_grove_so_the_story_holds_for_every_variant():
    body = next(row[3] for row in ROWS if row[0] == "cove-treasure-map")
    assert {variant["answer"] for _, _, variant in variants(body)} == {"grove"}


def test_learning_stages_carry_a_catalog_skill_on_every_variant():
    learning = [row for row in ROWS if row[1] in puzzles.SKILL_KINDS]
    assert len(learning) == 5
    for _, kind, _, body in learning:
        for band, params, variant in variants(body):
            skill = puzzles.skill_for(
                kind,
                params,
                {
                    "variantId": variant["id"],
                    **({"choice": "x"} if kind == "CHOOSE_ANSWER" else {}),
                },
            )
            assert skill, (body["puzzleId"], band, variant["id"])


def test_chest_stages_record_the_existing_chest_keys():
    keys = {row[0]: row[3]["worldChangeKey"] for row in ROWS}
    assert keys["cove-treasure-map"] == stages.LANDING_CHEST_KEY
    assert keys["cove-crocodile-creek"] == stages.GROVE_CHEST_KEY
    assert keys["cove-supply-dock"] == stages.BEACH_CHEST_KEY
    assert keys["cove-forgotten-cave"] == stages.PUZZLE_SOLVED_KEY
    assert keys["cove-lost-treasure"] == stages.FINAL_CHEST_KEY


def test_the_stepping_stones_are_in_the_creek_and_clear_of_every_collider():
    for letter in "abcde":
        x, z = STAGE_SPOTS[f"creek-stone-{letter}"]
        assert CREEK["minX"] < x < CREEK["maxX"] and CREEK["minZ"] < z < CREEK["maxZ"]
    colliders = [c["rect"] for c in cove_layout()["colliders"] if "rect" in c]
    for spot, (x, z) in STAGE_SPOTS.items():
        for rect in colliders:
            inside = rect["minX"] <= x <= rect["maxX"] and rect["minZ"] <= z <= rect["maxZ"]
            assert not inside, (spot, rect["id"])


def test_the_snapshot_the_frontend_reads_is_the_seed():
    assert json.loads(stages.SNAPSHOT_PATH.read_text()) == json.loads(
        json.dumps(stages.snapshot())
    ), "run `python -m apps.regions.treasure_cove_stages` from lai/"
