"""The Heart of Firepeak's seed, puzzle content and commands (design sections 5, 6, 7 and 8).

Three groups:

- **Pure** (no database): the snapshot equals the seed, the puzzle table matches section 6, every
  variant satisfies the CHOOSE_ANSWER / ORDER_SEQUENCE contract (section 5), copy rules, and the
  version gate.
- **Needs fp/puzzle-kinds** (`puzzles.RULES` has the two new kinds): every body validates with
  `puzzles.body_problems`.
- **Needs fp/content and fp/puzzle-kinds** (the export has the Place, NPCs, quest and rules, and
  the two kinds exist): seed rows, idempotence, never overwrites, commands. Skipped, with the
  reason, until the coordinator merges those streams.
"""

import json
import re
from types import SimpleNamespace

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.regions import firepeak_heart_content as content
from apps.regions import firepeak_heart_layout as layout
from apps.regions import firepeak_heart_seed as seed
from apps.regions import puzzles
from apps.regions.models import PuzzleKind

BANDS = ("PATHFINDER", "EXPLORER")
ROWS = content.puzzle_rows()
PLACED = {p["entity_id"] for p in layout.placements()}
SYMBOLS = {"circle", "square", "triangle", "star", "diamond", "hexagon", "heart", "moon"}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NEW_KINDS_EXIST = "CHOOSE_ANSWER" in puzzles.RULES and "ORDER_SEQUENCE" in puzzles.RULES
needs_kinds = pytest.mark.skipif(
    not NEW_KINDS_EXIST, reason="awaits the fp/puzzle-kinds merge (CHOOSE_ANSWER, ORDER_SEQUENCE)"
)


# --- the snapshot and the table ----------------------------------------------------------------


class TestSnapshot:
    def test_the_json_snapshot_equals_the_seed(self):
        stored = json.loads(seed.SNAPSHOT_PATH.read_text())
        assert stored == json.loads(json.dumps(seed.snapshot())), (
            "Run `python -m apps.regions.firepeak_heart_seed` from lai/ to rewrite the snapshot."
        )

    def test_the_snapshot_names_every_puzzle_entity_and_asset(self):
        stored = json.loads(seed.SNAPSHOT_PATH.read_text())
        placed = {p["entity_id"] for p in stored["placements"]}
        assert all(e in placed for puzzle in stored["puzzles"] for e in puzzle["entityIds"])
        assets = {a["assetId"] for a in stored["assets"]}
        assert {p["asset"] for p in stored["placements"]} <= assets
        assert "firepeak-volcano-main" in assets


class TestPuzzleTable:
    def test_fourteen_puzzles_in_design_order(self):
        assert [r[0] for r in ROWS] == [
            "fh-landing-map",
            "fh-emberwood-pattern",
            "fh-emberwood-count",
            "fh-lava-numbers",
            "fh-lava-compare",
            "fh-caverns-shapes",
            "fh-caverns-arrange",
            "fh-forge-switches",
            "fh-forge-circuit",
            "fh-summit-rocks",
            "fh-summit-island",
            "fh-heart-crystals",
            "fh-heart-restore",
            "fh-heart-return",
        ]

    def test_kinds_keys_and_rewards_match_the_table(self):
        table = {r[0]: (r[1], r[3]["worldChangeKey"], r[3]["rewardRuleId"]) for r in ROWS}
        assert table["fh-landing-map"] == (
            "OBSERVE_FEATURES",
            "FIREPEAK_HEART_MAP_READ",
            "fh-rule-first-steps",
        )
        assert table["fh-emberwood-pattern"] == (
            "CHOOSE_ANSWER",
            "FIREPEAK_HEART_PATTERN_SOLVED",
            None,
        )
        assert table["fh-emberwood-count"] == (
            "CHOOSE_ANSWER",
            "FIREPEAK_HEART_EMBERWOOD_DONE",
            "fh-rule-emberwood",
        )
        assert table["fh-lava-numbers"] == ("CHOOSE_ANSWER", "FIREPEAK_HEART_LAVA_BRIDGE", None)
        assert table["fh-lava-compare"] == (
            "CHOOSE_ANSWER",
            "FIREPEAK_HEART_LAVA_CROSSED",
            "fh-rule-lava",
        )
        assert table["fh-caverns-shapes"] == (
            "CHOOSE_ANSWER",
            "FIREPEAK_HEART_SHAPES_MATCHED",
            None,
        )
        assert table["fh-caverns-arrange"] == (
            "ORDER_SEQUENCE",
            "FIREPEAK_HEART_CAVERN_LIT",
            "fh-rule-caverns",
        )
        assert table["fh-forge-switches"] == (
            "ORDER_SEQUENCE",
            "FIREPEAK_HEART_FORGE_POWERED",
            None,
        )
        assert table["fh-forge-circuit"] == (
            "CHOOSE_ANSWER",
            "FIREPEAK_HEART_FORGE_RESTORED",
            "fh-rule-forge",
        )
        assert table["fh-summit-rocks"] == ("CHOOSE_ANSWER", "FIREPEAK_HEART_ROCKS_NAMED", None)
        assert table["fh-summit-island"] == (
            "ORDER_SEQUENCE",
            "FIREPEAK_HEART_SUMMIT_REACHED",
            "fh-rule-scientist",
        )
        assert table["fh-heart-crystals"] == ("ORDER_SEQUENCE", "FIREPEAK_HEART_CRYSTALS_SET", None)
        assert table["fh-heart-restore"] == ("COLLECT_OBJECT", "FIREPEAK_HEART_RESTORED", None)
        assert table["fh-heart-return"] == (
            "RETURN_TO_NPC",
            "FIREPEAK_HEART_CELEBRATED",
            "fh-rule-heart",
        )

    def test_each_puzzle_requires_the_one_before_it(self):
        previous = None
        for _pid, _kind, _entities, body in ROWS:
            assert body["requiresChangeKeys"] == ([previous] if previous else [])
            previous = body["worldChangeKey"]

    def test_the_keys_that_open_the_gates_are_the_zone_completion_keys(self):
        changes = {r[3]["worldChangeKey"] for r in ROWS}
        assert {key for _id, _z, key in layout.GATES} <= changes
        assert "FIREPEAK_HEART_LAVA_BRIDGE" in changes  # the bridge signal

    def test_body_shape(self):
        for _pid, kind, entities, body in ROWS:
            assert set(body) == puzzles.BODY_KEYS
            assert body["kind"] == kind and set(body["ageBands"]) == set(BANDS)
            assert entities and all(e in PLACED for e in entities), body["puzzleId"]

    def test_reward_rules_and_pickups_are_the_export_ones(self):
        wanted = seed.reward_rule_ids()
        assert {
            "fh-rule-first-steps",
            "fh-rule-emberwood",
            "fh-rule-lava",
            "fh-rule-caverns",
            "fh-rule-forge",
            "fh-rule-scientist",
            "fh-rule-heart",
            *[
                f"fh-rule-shard-{z}"
                for z in ("landing", "emberwood", "lava", "caverns", "forge", "summit", "heart")
            ],
        } == wanted

    def test_copy_has_no_dialogue_params_and_no_em_dashes(self):
        for _pid, _kind, _entities, body in ROWS:
            text = json.dumps(body)
            assert "\\u2014" not in text and "\\u2013" not in text
            for band in body["ageBands"].values():
                assert not ({"intro", "completeMessage", "scienceNote"} & set(band))
                assert len(band.get("hints", [])) <= 4


# --- the CHOOSE_ANSWER / ORDER_SEQUENCE contract (design section 5) ----------------------------


def contract_problems(kind, params, entity_ids):
    problems = []
    key = "optionEntities" if kind == "CHOOSE_ANSWER" else "itemEntities"
    variants = params["variants"]
    if not 1 <= len(variants) <= 8:
        problems.append("variants: 1 to 8")
    entities = params.get(key)
    if entities is not None:
        if not all(SLUG.match(k) for k in entities):
            problems.append("entity keys must be slugs")
        if not set(entities.values()) <= set(entity_ids):
            problems.append("entity ids must be in the puzzle's entity_ids")
    seen = set()
    for v in variants:
        where = v["id"]
        if v["id"] in seen or not SLUG.match(v["id"]):
            problems.append(f"{where}: variant id")
        seen.add(v["id"])
        if not (v["prompt"] and len(v["prompt"]) <= 200):
            problems.append(f"{where}: prompt length {len(v['prompt'])}")
        if not (v["explanation"] and len(v["explanation"]) <= 240):
            problems.append(f"{where}: explanation length {len(v['explanation'])}")
        listed = v["options"] if kind == "CHOOSE_ANSWER" else v["items"]
        low, high = (2, 4) if kind == "CHOOSE_ANSWER" else (2, 6)
        ids = [o["id"] for o in listed]
        if not low <= len(listed) <= high or len(set(ids)) != len(ids):
            problems.append(f"{where}: count or duplicate ids")
        for option in listed:
            if not SLUG.match(option["id"]) or not option["label"].strip():
                problems.append(f"{where}: option id or label")
            if option.get("symbol") not in SYMBOLS:
                problems.append(f"{where}: option {option['id']} needs a symbol")
        if len({o["symbol"] for o in listed}) != len(listed):
            problems.append(f"{where}: symbols must differ")
        if len({o["label"] for o in listed}) != len(listed):
            problems.append(f"{where}: labels must differ")
        if kind == "CHOOSE_ANSWER":
            if v["answer"] not in ids:
                problems.append(f"{where}: answer not an option")
        elif sorted(v["answer"]) != sorted(ids):
            problems.append(f"{where}: answer is not a permutation of the items")
        if entities is not None and set(entities) != set(ids):
            problems.append(f"{where}: option ids must equal the entity keys")
    return problems


NEW_KIND_ROWS = [r for r in ROWS if r[1] in {"CHOOSE_ANSWER", "ORDER_SEQUENCE"}]


class TestVariantContract:
    @pytest.mark.parametrize("row", NEW_KIND_ROWS, ids=lambda r: r[0])
    @pytest.mark.parametrize("band", BANDS)
    def test_every_variant_satisfies_the_contract(self, row, band):
        pid, kind, entity_ids, body = row
        params = body["ageBands"][band]
        assert contract_problems(kind, params, entity_ids) == [], pid
        assert 3 <= len(params["variants"]) <= 5, pid
        assert params["subject"] in {"MATHEMATICS", "EARTH_SCIENCE", "LITERACY", "LOGIC"}
        assert SLUG.match(params["skill"])
        assert params["hintAfterAttempts"] == 2 and 1 <= len(params["hints"]) <= 4

    @pytest.mark.parametrize("row", NEW_KIND_ROWS, ids=lambda r: r[0])
    def test_the_answer_is_not_always_the_same_position(self, row):
        _pid, kind, _e, body = row
        if kind != "CHOOSE_ANSWER":
            return
        for band in BANDS:
            positions = {
                [o["id"] for o in v["options"]].index(v["answer"])
                for v in body["ageBands"][band]["variants"]
            }
            assert len(positions) >= 2, band

    def test_presentations_match_design_section_6(self):
        expected = {
            "fh-emberwood-pattern": "CRYSTALS",
            "fh-emberwood-count": "CARDS",
            "fh-lava-numbers": "PLATFORMS",
            "fh-lava-compare": "PATHS",
            "fh-caverns-shapes": "SHAPES",
            "fh-caverns-arrange": "CRYSTALS",
            "fh-forge-switches": "SWITCHES",
            "fh-forge-circuit": "PATHS",
            "fh-summit-rocks": "SAMPLES",
            "fh-summit-island": "STORY",
            "fh-heart-crystals": "CRYSTALS",
        }
        for pid, _kind, _e, body in NEW_KIND_ROWS:
            for params in body["ageBands"].values():
                assert params["presentation"] == expected[pid]

    def test_pathfinders_and_explorers_get_different_content(self):
        for _pid, _kind, _e, body in NEW_KIND_ROWS:
            pathfinder = json.dumps(body["ageBands"]["PATHFINDER"]["variants"])
            explorer = json.dumps(body["ageBands"]["EXPLORER"]["variants"])
            assert pathfinder != explorer

    def test_the_map_asks_for_three_places_then_five(self):
        body = ROWS[0][3]["ageBands"]
        assert len(body["PATHFINDER"]["features"]) == 3 and len(body["EXPLORER"]["features"]) == 5

    def test_switch_and_story_puzzles_use_three_steps_then_four_or_five(self):
        by_id = {r[0]: r[3] for r in ROWS}
        for pid, pathfinder, explorer in (("fh-forge-switches", 3, 4), ("fh-summit-island", 3, 5)):
            for band, count in (("PATHFINDER", pathfinder), ("EXPLORER", explorer)):
                for v in by_id[pid]["ageBands"][band]["variants"]:
                    assert len(v["items"]) == count, (pid, band)

    def test_arithmetic_answers_are_correct(self):
        """Spot-check the maths variants: the options include the true result and it is the answer."""
        sums = re.compile(r"answer to (\d+) ([+-]) (\d+)\??")
        for pid in ("fh-lava-numbers",):
            body = {r[0]: r[3] for r in ROWS}[pid]
            for band in BANDS:
                for v in body["ageBands"][band]["variants"]:
                    match = sums.search(v["prompt"])
                    if match:
                        a, op, b = int(match[1]), match[2], int(match[3])
                        truth = a + b if op == "+" else a - b
                        labels = {o["id"]: o["label"] for o in v["options"]}
                        assert labels[v["answer"]] == str(truth), v["prompt"]
                    times = re.search(r"answer to (\d+) times (\d+)", v["prompt"])
                    if times:
                        truth = int(times[1]) * int(times[2])
                        labels = {o["id"]: o["label"] for o in v["options"]}
                        assert labels[v["answer"]] == str(truth), v["prompt"]


class TestBodiesValidate:
    @pytest.mark.parametrize("row", ROWS, ids=lambda r: r[0])
    def test_every_body_validates_with_the_server_rules(self, row):
        pid, kind, _entities, body = row
        if kind not in puzzles.RULES:
            pytest.skip("awaits the fp/puzzle-kinds merge")
        assert puzzles.body_problems(kind, body) == [], pid


# --- the version gate --------------------------------------------------------------------------


class TestVersionGate:
    def region(self, scene):
        saved = []
        return SimpleNamespace(
            scene=scene, version=1, save=lambda **kw: saved.append(kw), saved=saved
        )

    def test_a_missing_or_old_layout_is_written_and_authored_copy_survives(self):
        region = self.region(
            {"copy": {"loading": "My own words."}, "platformTuning": {"x": {"speed": 1}}}
        )
        assert seed.upgrade_firepeak_heart(region) is True
        assert region.scene["firepeakHeartVersion"] == seed.HEART_VERSION
        assert region.scene["copy"] == {"loading": "My own words."}
        assert region.scene["platformTuning"] == {"x": {"speed": 1}}
        assert region.scene["platforming"]["platforms"] and region.version == 2

    def test_a_current_layout_is_left_alone(self):
        region = self.region(layout.scene())
        assert seed.upgrade_firepeak_heart(region) is False
        assert region.version == 1 and region.saved == []


# --- database tests (need the export and the new kinds) ----------------------------------------


@pytest.fixture
def heart(families):
    from apps.catalog.importer import import_content
    from apps.catalog.models import Location

    import_content()
    if not Location.objects.filter(slug=seed.PLACE_SLUG).exists():
        pytest.skip("awaits the fp/content merge (Place firepeak-heart is not in the export)")
    if "CHOOSE_ANSWER" not in PuzzleKind.values:
        pytest.skip("awaits the fp/puzzle-kinds merge")
    return families


@pytest.mark.postgres
@pytest.mark.django_db
class TestPrerequisites:
    def test_the_seed_needs_the_export_first(self):
        with pytest.raises(seed.SeedPrerequisiteMissing, match="load_content"):
            seed.seed_firepeak_heart()

    def test_the_command_explains_the_missing_export(self):
        with pytest.raises(CommandError, match="load_content"):
            call_command("seed_firepeak_heart", stdout=None)

    def test_publishing_before_seeding_is_refused_with_a_reason(self):
        with override_settings(DEBUG=True), pytest.raises(CommandError, match="not published"):
            call_command("publish_firepeak_heart", stdout=None, stderr=None)


@pytest.mark.postgres
@pytest.mark.django_db
class TestSeedRows:
    def test_creates_the_area_spawn_placements_assets_and_puzzles(self, heart):
        from apps.catalog.models import AssetOrigin, ContentAsset
        from apps.regions.models import AreaPuzzle, SpawnPoint, WorldObjectPlacement, WorldRegion

        created = seed.seed_firepeak_heart()
        assert created
        region = WorldRegion.objects.get(region_id=seed.REGION_ID)
        assert region.age_bands == ["PATHFINDER", "EXPLORER"]
        assert region.scene["firepeakHeartVersion"] == seed.HEART_VERSION
        assert region.offered_quests.filter(slug=seed.QUEST_ID).exists()
        assert (
            SpawnPoint.objects.get(region=region, is_default=True).checkpoint_id == "fh-cp-landing"
        )
        assert WorldObjectPlacement.objects.filter(region=region).count() == len(
            layout.placements()
        )
        assert list(
            AreaPuzzle.objects.filter(region=region)
            .order_by("sort_order")
            .values_list("puzzle_id", flat=True)
        ) == [r[0] for r in ROWS]
        assets = ContentAsset.objects.filter(tags__contains=[seed.ASSET_TAG])
        assert assets.count() >= len(layout.ASSET_DEFS) - 2  # two reuse existing firepeak ids
        assert all(a.origin == AssetOrigin.DJANGO and a.default_version is None for a in assets)

    def test_every_row_passes_the_admin_checks(self, heart):
        from apps.regions.models import WorldRegion

        seed.seed_firepeak_heart()
        region = WorldRegion.objects.get(region_id=seed.REGION_ID)
        for row in [*region.placements.all(), *region.puzzles.all(), region]:
            row.full_clean()

    def test_shards_name_a_pickup_key_and_a_reward_rule(self, heart):
        from apps.regions.models import WorldObjectPlacement

        seed.seed_firepeak_heart()
        shards = WorldObjectPlacement.objects.filter(entity_id__startswith="fh-shard-")
        assert shards.count() == 7
        for shard in shards:
            assert shard.pickup_change_key.startswith("FIREPEAK_HEART_SHARD_")
            assert shard.pickup_reward_rule.rule_id.startswith("fh-rule-shard-")

    def test_seed_is_idempotent_and_never_overwrites(self, heart):
        from apps.catalog import authoring
        from apps.catalog.tests.helpers import publish_edit
        from apps.regions.models import AreaPuzzle, WorldObjectPlacement

        seed.seed_firepeak_heart()
        puzzle = AreaPuzzle.objects.get(puzzle_id="fh-lava-numbers")
        edited = authoring.current_body(puzzle)
        edited["title"] = "Build the bridge"
        publish_edit(puzzle, edited)
        WorldObjectPlacement.objects.filter(entity_id="fh-flint").update(x=1.0)

        assert seed.seed_firepeak_heart() == []

        puzzle.refresh_from_db()
        assert puzzle.title == "Build the bridge"
        assert WorldObjectPlacement.objects.get(entity_id="fh-flint").x == 1.0

    def test_each_puzzle_has_a_published_first_version_for_both_bands(self, heart):
        from apps.catalog import authoring
        from apps.regions.models import AreaPuzzle

        seed.seed_firepeak_heart()
        for puzzle in AreaPuzzle.objects.filter(region__region_id=seed.REGION_ID):
            assert puzzle.published_revision.number == 1
            assert set(puzzle.parameters) == set(BANDS)
            assert authoring.validate(puzzle, authoring.current_body(puzzle)) == []

    def test_firepeak_volcano_is_untouched(self, heart):
        from apps.regions import firepeak_seed
        from apps.regions.models import WorldRegion

        firepeak_seed.seed_firepeak()
        before = WorldRegion.objects.get(region_id=firepeak_seed.REGION_ID).scene
        seed.seed_firepeak_heart()
        assert WorldRegion.objects.get(region_id=firepeak_seed.REGION_ID).scene == before


@pytest.mark.postgres
@pytest.mark.django_db
class TestPublishCommand:
    def test_refused_outside_local_development(self, heart):
        seed.seed_firepeak_heart()
        with pytest.raises(CommandError, match="not published"):
            call_command("publish_firepeak_heart", stdout=None, stderr=None)

    @override_settings(DEBUG=True)
    def test_publishes_the_seeded_rows_in_local_development(self, heart):
        from apps.core.content_status import ContentStatus
        from apps.regions.models import WorldRegion

        call_command("seed_firepeak_heart", stdout=None)
        call_command("publish_firepeak_heart", stdout=None)
        region = WorldRegion.objects.get(region_id=seed.REGION_ID)
        assert region.status == ContentStatus.PUBLISHED
        assert set(region.puzzles.values_list("status", flat=True)) == {ContentStatus.PUBLISHED}
        call_command("publish_firepeak_heart", stdout=None)  # idempotent


class TestNpcManagerPlacements:
    """The NPC Manager's spots (`apps/npcs/firepeak_content.py`) are where the seed places the NPCs."""

    def test_every_spot_equals_the_seeded_placement(self):
        from apps.npcs.firepeak_content import NPCS

        placements = {p["entity_id"]: p for p in layout.placements() if p["kind"] == "NPC"}
        spots = {spot.key: spot for npc in NPCS for spot in npc.spots}
        assert set(spots) == set(placements)
        for key, spot in spots.items():
            assert (spot.x, spot.z) == (placements[key]["x"], placements[key]["z"]), key
