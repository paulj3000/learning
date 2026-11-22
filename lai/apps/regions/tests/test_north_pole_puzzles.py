"""North Pole puzzle content (NP-024): every body passes the real validators, matches the
contract table, and every answer is graded correct by the real grader. No database needed."""

import json

import pytest

from apps.regions import north_pole_layout as layout
from apps.regions import north_pole_puzzles as np_puzzles
from apps.regions import puzzles
from apps.regions.models import PuzzleKind

C, ORD = PuzzleKind.CHOOSE_ANSWER, PuzzleKind.ORDER_SEQUENCE
OBS, PLACE = PuzzleKind.OBSERVE_FEATURES, PuzzleKind.PLACE_PLATFORMS
RET, COL = PuzzleKind.RETURN_TO_NPC, PuzzleKind.COLLECT_OBJECT
FRAGMENTS = [
    f"NORTH_POLE_FRAGMENT_{z}"
    for z in ("VILLAGE", "WORKSHOP", "FOREST", "LAKE", "STABLES", "GINGERBREAD", "MOUNTAIN")
]
GIFTS, BRIDGE2, FOUND = (
    "NORTH_POLE_WORKSHOP_GIFTS_CHECKED",
    "NORTH_POLE_MOUNTAIN_BRIDGE_TWO",
    "NORTH_POLE_SNOWBALL_FOUND",
)
NP = "NORTH_POLE_"

# Contract section 5 (hard-coded): id, kind, requires, key, reward rule.
EXPECTED = [
    ("np-welcome-look", OBS, [], NP + "WELCOME_LOOKED", "np-rule-welcome"),
    ("np-workshop-count", C, [NP + "WELCOME_LOOKED"], NP + "WORKSHOP_TOYS_COUNTED", None),
    ("np-workshop-sort", C, [NP + "WORKSHOP_TOYS_COUNTED"], NP + "WORKSHOP_PRESENTS_SORTED", None),
    (
        "np-workshop-pattern",
        C,
        [NP + "WORKSHOP_PRESENTS_SORTED"],
        NP + "WORKSHOP_PATTERN_FIXED",
        None,
    ),
    ("np-workshop-assemble", ORD, [GIFTS], NP + "WORKSHOP_RESTORED", "np-rule-workshop"),
    ("np-forest-sequence", C, [NP + "WORKSHOP_RESTORED"], NP + "FOREST_SEQUENCE_DONE", None),
    ("np-forest-signs", C, [NP + "FOREST_SEQUENCE_DONE"], NP + "FOREST_SIGNS_READ", None),
    ("np-forest-stripes", ORD, [NP + "FOREST_SIGNS_READ"], NP + "FOREST_DONE", "np-rule-forest"),
    ("np-lake-sums", C, [NP + "FOREST_DONE"], NP + "LAKE_BRIDGE", None),
    ("np-lake-order", ORD, [NP + "LAKE_BRIDGE"], NP + "LAKE_ORDERED", None),
    ("np-lake-shapes", C, [NP + "LAKE_ORDERED"], NP + "LAKE_DONE", "np-rule-lake"),
    ("np-stables-facts", C, [NP + "LAKE_DONE"], NP + "STABLES_FACTS_LEARNED", None),
    ("np-stables-tracks", C, [NP + "STABLES_FACTS_LEARNED"], NP + "STABLES_TRACKS_FOLLOWED", None),
    (
        "np-stables-supplies",
        C,
        [NP + "STABLES_TRACKS_FOLLOWED"],
        NP + "STABLES_SUPPLIES_FOUND",
        None,
    ),
    (
        "np-stables-return",
        RET,
        [NP + "STABLES_SUPPLIES_FOUND", FOUND],
        NP + "SNOWBALL_HOME",
        "np-rule-reindeer",
    ),
    ("np-ginger-shapes", C, [NP + "SNOWBALL_HOME"], NP + "GINGER_SHAPES_MATCHED", None),
    ("np-ginger-symmetry", C, [NP + "GINGER_SHAPES_MATCHED"], NP + "GINGER_SYMMETRY_DONE", None),
    ("np-ginger-recipe", C, [NP + "GINGER_SYMMETRY_DONE"], NP + "GINGER_RECIPE_READ", None),
    ("np-ginger-measure", C, [NP + "GINGER_RECIPE_READ"], NP + "GINGER_MEASURED", None),
    (
        "np-ginger-build",
        PLACE,
        [NP + "GINGER_MEASURED"],
        NP + "GINGER_REPAIRED",
        "np-rule-gingerbread",
    ),
    ("np-mountain-weather", C, [BRIDGE2], NP + "MOUNTAIN_SUMMIT", "np-rule-mountain"),
    ("np-obs-stars", C, [NP + "MOUNTAIN_SUMMIT"], NP + "OBS_STARS_LEARNED", None),
    ("np-obs-constellation", C, [NP + "OBS_STARS_LEARNED"], NP + "OBS_CONSTELLATION_FOUND", None),
    ("np-obs-sequence", ORD, [NP + "OBS_CONSTELLATION_FOUND"], NP + "OBS_SEQUENCE_DONE", None),
    (
        "np-obs-fragments",
        ORD,
        [NP + "OBS_SEQUENCE_DONE", *FRAGMENTS],
        NP + "FRAGMENTS_PLACED",
        None,
    ),
    ("np-obs-final", C, [NP + "FRAGMENTS_PLACED"], NP + "STAR_RESTORED", "np-rule-star"),
    (
        "np-eve-sleigh-bell",
        COL,
        [NP + "STAR_RESTORED"],
        NP + "CHRISTMAS_EVE",
        "np-rule-christmas-eve",
    ),
]
BANDS = ("SPROUT", "PATHFINDER", "EXPLORER")
BY_ID = {p["puzzleId"]: p for p in np_puzzles.PUZZLES}
QUIZ = [e[0] for e in EXPECTED if e[1] in (C, ORD)]


def test_contract_table_matches_exactly():
    got = [
        (p["puzzleId"], p["kind"], p["requiresChangeKeys"], p["worldChangeKey"], p["rewardRuleId"])
        for p in np_puzzles.PUZZLES
    ]
    assert got == EXPECTED
    assert len(got) == 27


def test_every_body_passes_the_real_validators():
    for body in np_puzzles.PUZZLES:
        assert puzzles.body_problems(body["kind"], body) == [], body["puzzleId"]


def test_all_three_bands_present():
    for body in np_puzzles.PUZZLES:
        assert set(body["ageBands"]) == set(BANDS), body["puzzleId"]


def test_keys_unique_and_chain_is_acyclic_and_ordered():
    keys = [p["worldChangeKey"] for p in np_puzzles.PUZZLES]
    assert len(set(keys)) == len(keys)
    # Keys the other content produces: chests and pickups (contract section 5).
    external = {GIFTS, BRIDGE2, FOUND, *FRAGMENTS}
    produced: set[str] = set()
    for body in np_puzzles.PUZZLES:
        for required in body["requiresChangeKeys"]:
            assert required in produced or required in external, (body["puzzleId"], required)
        assert body["worldChangeKey"] not in body["requiresChangeKeys"]
        produced.add(body["worldChangeKey"])


def test_chest_and_pickup_keys_are_required_where_the_contract_says():
    assert GIFTS in BY_ID["np-workshop-assemble"]["requiresChangeKeys"]
    assert BRIDGE2 in BY_ID["np-mountain-weather"]["requiresChangeKeys"]
    assert FOUND in BY_ID["np-stables-return"]["requiresChangeKeys"]
    assert set(FRAGMENTS) <= set(BY_ID["np-obs-fragments"]["requiresChangeKeys"])


@pytest.mark.parametrize("pid", QUIZ)
@pytest.mark.parametrize("band", BANDS)
def test_quiz_shape_by_band(pid, band):
    params = BY_ID[pid]["ageBands"][band]
    variants = params["variants"]
    assert 3 <= len(variants) <= 8
    assert len(params["hints"]) == 2
    assert params["hintAfterAttempts"] == (1 if band == "SPROUT" else 2)
    for variant in variants:
        entries = variant.get("options") or variant["items"]
        labels = [e["label"] for e in entries]
        assert len(set(labels)) == len(labels), (pid, band, variant["id"])
        if variant.get("options"):
            n = len(variant["options"])
            if band == "SPROUT":
                assert 2 <= n <= 3
                symbols = [o["symbol"] for o in variant["options"]]
                assert len(set(symbols)) == n, (pid, variant["id"])
            elif band == "PATHFINDER":
                assert n == 3, (pid, variant["id"])
            else:
                assert n == (3 if pid == "np-lake-sums" else 4), (pid, variant["id"], n)


@pytest.mark.parametrize("pid", QUIZ)
@pytest.mark.parametrize("band", BANDS)
def test_every_answer_is_graded_correct_and_a_wrong_choice_is_not(pid, band):
    body = BY_ID[pid]
    params = body["ageBands"][band]
    for variant in params["variants"]:
        if body["kind"] == C:
            good = {"variantId": variant["id"], "choice": variant["answer"]}
            assert puzzles.grade(C, params, good) is True
            wrong = next(o["id"] for o in variant["options"] if o["id"] != variant["answer"])
            assert puzzles.grade(C, params, {"variantId": variant["id"], "choice": wrong}) is False
        else:
            good = {"variantId": variant["id"], "order": variant["answer"]}
            assert puzzles.grade(ORD, params, good) is True
            shown = [i["id"] for i in variant["items"]]
            assert shown != variant["answer"], "items must not arrive solved"
            assert puzzles.grade(ORD, params, {"variantId": variant["id"], "order": shown}) is False


def test_copy_rules():
    banned = ("—", "–", "wrong", "incorrect", "Wrong")
    for body in np_puzzles.PUZZLES:
        for params in body["ageBands"].values():
            texts = [body["title"], *params.get("hints", [])]
            for variant in params.get("variants", []):
                texts += [variant["prompt"], variant["explanation"]]
                texts += [e["label"] for e in variant.get("options", variant.get("items", []))]
            for feature in params.get("features", []):
                texts += [feature["label"], feature["explanation"]]
            for text in texts:
                assert not any(b in text for b in banned), text


def test_arithmetic_is_recomputed():
    assert np_puzzles.ARITHMETIC
    for (pid, band, vid), (op, args) in np_puzzles.ARITHMETIC.items():
        variant = next(v for v in BY_ID[pid]["ageBands"][band]["variants"] if v["id"] == vid)
        label = next(o["label"] for o in variant["options"] if o["id"] == variant["answer"])
        expected = {
            "id": lambda a: a,
            "add": lambda a, b: a + b,
            "sub": lambda a, b: a - b,
            "mul": lambda a, b: a * b,
            "div": lambda a, b: a / b,
            "sub3": lambda a, b, c: a - b - c,
            "mulsub": lambda a, b, c: a * b - c,
            "addmul": lambda a, b, c: a + b * c,
            "divsub": lambda a, b, c: a / b - c,
            "submul": lambda a, b, c: a - b * c,
        }[op](*args)
        assert expected == int(expected) and int(label) == expected, (pid, band, vid)


@pytest.mark.parametrize("band", BANDS)
def test_lake_order_answers_are_sorted_numbers(band):
    for variant in BY_ID["np-lake-order"]["ageBands"][band]["variants"]:
        value = {i["id"]: int(i["label"]) for i in variant["items"]}
        ordered = [value[i] for i in variant["answer"]]
        descending = "biggest number to the smallest" in variant["prompt"]
        assert ordered == sorted(ordered, reverse=descending)
        assert len(set(ordered)) == len(ordered)


def test_age_reading_load_grows_with_band():
    def average(band):
        lengths = [
            len(v["prompt"]) for pid in QUIZ for v in BY_ID[pid]["ageBands"][band]["variants"]
        ]
        return sum(lengths) / len(lengths)

    assert average("SPROUT") < average("PATHFINDER") < average("EXPLORER")


def test_entity_ids_cover_every_binding():
    assert set(np_puzzles.ENTITY_IDS) == {e[0] for e in EXPECTED}
    for pid in QUIZ:
        assert np_puzzles.ENTITY_IDS[pid]
    assert np_puzzles.ENTITY_IDS["np-stables-return"] == ["np-noel"]
    assert np_puzzles.ENTITY_IDS["np-eve-sleigh-bell"] == ["np-sleigh-bell"]
    assert np_puzzles.ENTITY_IDS is layout.PUZZLE_ENTITIES
    for pid, bands in np_puzzles.ENTITY_MAPS.items():
        bound = set(np_puzzles.ENTITY_IDS[pid])
        for band, maps in bands.items():
            for mapping in maps.values():
                assert set(mapping.values()) <= bound, (pid, band)
                assert set(BY_ID[pid]["ageBands"][band][next(iter(maps))]) == set(mapping)


def test_welcome_features_are_entity_ids_with_band_counts():
    ids = set(np_puzzles.ENTITY_IDS["np-welcome-look"])
    counts = {}
    for band, params in BY_ID["np-welcome-look"]["ageBands"].items():
        counts[band] = len(params["features"])
        assert {f["id"] for f in params["features"]} <= ids
    assert counts == {"SPROUT": 3, "PATHFINDER": 4, "EXPLORER": 5}
    assert puzzles.grade(
        OBS,
        BY_ID["np-welcome-look"]["ageBands"]["SPROUT"],
        {"observed": [f["id"] for f in BY_ID["np-welcome-look"]["ageBands"]["SPROUT"]["features"]]},
    )


def test_lake_sums_options_are_the_three_floes_in_every_band():
    for band in BANDS:
        for variant in BY_ID["np-lake-sums"]["ageBands"][band]["variants"]:
            assert [o["id"] for o in variant["options"]] == ["a", "b", "c"]


def test_ginger_build_is_solvable_and_matches_entities():
    for band in BANDS:
        params = BY_ID["np-ginger-build"]["ageBands"][band]
        placements = dict(
            zip(
                tuple(f"np-ginger-slot-{i}" for i in range(1, 4)),
                tuple(f"np-ginger-stone-{i}" for i in range(1, 4)),
                strict=True,
            )
        )
        assert puzzles.grade(PLACE, params, {"placements": placements}) is True
        wrong = {
            **placements,
            "np-ginger-slot-1": "np-ginger-stone-3",
            "np-ginger-slot-3": "np-ginger-stone-1",
        }
        assert puzzles.grade(PLACE, params, {"placements": wrong}) is False


def test_return_and_collect_use_contract_entities():
    for band in BANDS:
        assert BY_ID["np-stables-return"]["ageBands"][band]["npcEntityId"] == "np-noel"
        assert BY_ID["np-eve-sleigh-bell"]["ageBands"][band]["discoveryMessage"]


def test_every_entity_reference_exists_in_the_layout():
    for body in np_puzzles.PUZZLES:
        pid = body["puzzleId"]
        allowed = set(layout.PUZZLE_ENTITIES[pid])
        for band, params in body["ageBands"].items():
            refs = []
            for key in ("optionEntities", "itemEntities"):
                for ref, entity in (params.get(key) or {}).items():
                    refs.append(entity)
                    assert layout.PUZZLE_ENTITY_MAPS[pid][ref] == entity, (pid, band, ref)
            refs += [f["id"] for f in params.get("features", [])]
            refs += [s["id"] for s in params.get("stones", [])]
            refs += [s["id"] for s in params.get("slots", [])]
            refs += [params["npcEntityId"]] if "npcEntityId" in params else []
            assert set(refs) <= allowed, (pid, band, set(refs) - allowed)
    assert len(layout.PUZZLE_ENTITIES["np-obs-fragments"]) == 7
    for band in ("PATHFINDER", "EXPLORER"):
        assert set(np_puzzles.ENTITY_MAPS["np-obs-fragments"][band]["itemEntities"]) == set(
            layout.FRAGMENT_ZONES
        ) - {"village"}


def test_the_json_snapshot_equals_the_module():
    assert json.loads(np_puzzles.SNAPSHOT_PATH.read_text()) == np_puzzles.snapshot()
    expected = json.dumps(np_puzzles.snapshot(), indent=1, sort_keys=True) + "\n"
    assert np_puzzles.SNAPSHOT_PATH.read_text() == expected
