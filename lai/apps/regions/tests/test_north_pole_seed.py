"""North Pole: The Missing Christmas Star (NP-038, NP-053 to NP-056) through the seed and the play
API: the seed and its prerequisites, every age band, the whole storyline in order (27 puzzles,
three math chests, the star fragments), stage order, wrong answers that cost nothing, one-time
rewards, the nine quests, resume, replay and practice, ownership, and the development publish.

Movement, jumping and checkpoints are client-side (engine tests); what Django decides is graded
and recorded here, the same way the game client calls it.
"""

import json

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import AssetOrigin, ContentAsset
from apps.catalog.tests.helpers import publish_edit
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.game_sessions.models import ChallengeAttempt
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.question_studio.models import QuestionPool
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import north_pole_layout as layout
from apps.regions import north_pole_seed
from apps.regions.models import AreaPuzzle, TreasureChest, WorldRegion
from apps.regions.north_pole_assets import ASSETS
from apps.regions.north_pole_puzzles import PUZZLES
from apps.regions.north_pole_seed import (
    CHESTS,
    COMPLETION_KEY,
    QUEST_IDS,
    REGION_ID,
    seed_north_pole,
    upgrade_north_pole,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

BODIES = {body["puzzleId"]: body for body in PUZZLES}
FRAGMENTS = [p["entity_id"] for p in layout.PLACEMENTS if p["entity_id"].startswith("np-fragment-")]


def publish_all():
    WorldRegion.objects.filter(region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)
    AreaPuzzle.objects.filter(region__region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)
    ChallengeSpec.objects.filter(slug__startswith="np-").update(status=ContentStatus.PUBLISHED)


def _seed_north_pole():
    import_content()
    seed_north_pole()
    publish_all()


@pytest.fixture(scope="module")
def north_pole_content(module_content):
    """`_seed_north_pole()` once for the module (lai/conftest.py, "Module content baseline")."""
    return module_content.seed("north_pole", _seed_north_pole)


@pytest.fixture
def north_pole(north_pole_content, families):
    if not north_pole_content.has("north_pole"):
        _seed_north_pole()
    return families


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


class Play:
    """One child playing North Pole Village through the API, the way the game client does."""

    def __init__(self, client, child):
        self.client, self.child = client, child
        self.base = f"/api/v1/children/{child.pk}/"
        self.session = self.start()

    def start(self):
        response = post(self.client, f"{self.base}regions/{REGION_ID}/session/")
        assert response.status_code in (200, 201), response.content
        return response.json()["sessionId"]

    def region(self) -> dict:
        return self.client.get(f"{self.base}regions/{REGION_ID}/").json()

    def solve(self, puzzle_id, submission):
        return post(
            self.client,
            f"{self.base}sessions/{self.session}/puzzles/{puzzle_id}/solve/",
            {"submission": submission},
        )

    def accept(self, quest_id):
        return post(self.client, f"{self.base}quests/{quest_id}/accept/")

    def pickup(self, entity_id):
        return post(self.client, f"{self.base}sessions/{self.session}/pickups/{entity_id}/")

    def challenge(self, chest_id):
        return post(self.client, f"{self.base}sessions/{self.session}/chests/{chest_id}/challenge/")

    def answer(self, attempt_id, value):
        return post(self.client, f"{self.base}attempts/{attempt_id}/answer/", {"answer": value})

    def open_chest(self, chest_id, *, wrong_first=False):
        issued = self.challenge(chest_id)
        assert issued.status_code in (200, 201), issued.content
        attempt = ChallengeAttempt.objects.get(pk=issued.json()["attemptId"])
        if wrong_first:
            choices = [c for c in (attempt.choices or []) if c != attempt.answer]
            wrong = choices[0] if choices else attempt.answer + 1
            assert self.answer(attempt.pk, wrong).json()["correct"] is False
            attempt = ChallengeAttempt.objects.get(pk=self.challenge(chest_id).json()["attemptId"])
        response = self.answer(attempt.pk, attempt.answer)
        assert response.status_code == 200, response.content
        return response.json()


def submission(puzzle_id: str, band: str, *, correct=True) -> dict:
    """What a child who answers right (or wrong) sends, from the authored parameters."""
    body = BODIES[puzzle_id]
    params = body["ageBands"][band]
    kind = body["kind"]
    if kind == "CHOOSE_ANSWER":
        variant = params["variants"][0]
        choice = variant["answer"]
        if not correct:
            choice = next(o["id"] for o in variant["options"] if o["id"] != variant["answer"])
        return {"variantId": variant["id"], "choice": choice}
    if kind == "ORDER_SEQUENCE":
        variant = params["variants"][0]
        order = list(variant["answer"])
        if not correct:
            order = list(reversed(order))
        return {"variantId": variant["id"], "order": order}
    if kind == "OBSERVE_FEATURES":
        features = [f["id"] for f in params["features"]]
        return {"observed": features if correct else features[:1]}
    if kind == "PLACE_PLATFORMS":
        by_size = {}
        for stone in params["stones"]:
            by_size.setdefault(stone["size"], []).append(stone["id"])
        placements = {slot["id"]: by_size[slot["gap"]].pop() for slot in params["slots"]}
        if not correct:
            slots = list(placements)
            placements[slots[0]], placements[slots[1]] = placements[slots[1]], placements[slots[0]]
        return {"placements": placements}
    return {}


def keys(child) -> set[str]:
    return set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))


def owned(child) -> set[str]:
    return set(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


def play_everything(play: Play, band: str, *, check_wrong=False):
    """The whole storyline in contract order: puzzles, chests and fragments where they fall."""
    chests_after = {
        "np-workshop-pattern": ["np-workshop-gift-chest"],
        "np-ginger-build": ["np-mountain-lever-1", "np-mountain-lever-2"],
    }
    fragment_after = {
        "np-welcome-look": "np-fragment-village",
        "np-workshop-assemble": "np-fragment-workshop",
        "np-forest-stripes": "np-fragment-forest",
        "np-lake-shapes": "np-fragment-lake",
        "np-stables-supplies": "np-fragment-stables",
        "np-ginger-build": "np-fragment-gingerbread",
        "np-mountain-weather": "np-fragment-mountain",
    }
    for body in PUZZLES:
        puzzle_id = body["puzzleId"]
        if puzzle_id == "np-stables-return":
            assert play.pickup("np-snowball-collar").status_code in (200, 201)
        if check_wrong and body["kind"] in ("CHOOSE_ANSWER", "ORDER_SEQUENCE"):
            wrong = play.solve(puzzle_id, submission(puzzle_id, band, correct=False)).json()
            assert wrong["correct"] is False, puzzle_id
        result = play.solve(puzzle_id, submission(puzzle_id, band))
        assert result.status_code == 200, (puzzle_id, result.content)
        assert result.json()["correct"] is True, puzzle_id
        for chest in chests_after.get(puzzle_id, []):
            assert play.open_chest(chest, wrong_first=check_wrong)["correct"] is True
        if puzzle_id in fragment_after:
            assert play.pickup(fragment_after[puzzle_id]).status_code in (200, 201)


class TestSeed:
    def test_the_seed_needs_the_export_first(self, db):
        with pytest.raises(north_pole_seed.SeedPrerequisiteMissing):
            seed_north_pole()

    def test_the_seed_is_idempotent_and_never_overwrites(self, north_pole):
        puzzle = AreaPuzzle.objects.get(puzzle_id="np-workshop-count")
        body = authoring.current_body(puzzle)
        body["title"] = "Count the toys with Tinker"
        publish_edit(puzzle, body)

        assert seed_north_pole() == []

        puzzle.refresh_from_db()
        assert puzzle.title == "Count the toys with Tinker"

    def test_every_puzzle_has_a_published_first_version_for_every_band(self, north_pole):
        puzzles = AreaPuzzle.objects.filter(region__region_id=REGION_ID).order_by("sort_order")
        assert [p.puzzle_id for p in puzzles] == [b["puzzleId"] for b in PUZZLES]
        for puzzle in puzzles:
            assert puzzle.published_revision.number == 1
            assert set(puzzle.parameters) == {"SPROUT", "PATHFINDER", "EXPLORER"}
            assert authoring.validate(puzzle, authoring.current_body(puzzle)) == []

    def test_rows_pass_the_admin_checks_and_the_area_is_valid(self, north_pole):
        region = WorldRegion.objects.get(region_id=REGION_ID)
        assert region.location.slug == "north-pole-village"
        assert region.location.world.slug == "north-pole"
        for row in [*region.placements.all(), *region.puzzles.all(), *region.chests.all(), region]:
            row.full_clean()
        assert set(region.offered_quests.values_list("slug", flat=True)) == set(QUEST_IDS)

    def test_missing_models_are_asset_definitions_waiting_for_a_glb(self, north_pole):
        ids = [a.asset_id for a in ASSETS]
        assets = ContentAsset.objects.filter(asset_id__in=ids)
        assert assets.count() == len(ids)
        assert all(a.origin == AssetOrigin.DJANGO and a.default_version is None for a in assets)

    def test_math_chests_have_a_spec_per_band_and_a_disabled_studio_pool(self, north_pole):
        for chest_id in north_pole_seed.POOLED_CHESTS:
            chest = TreasureChest.objects.get(entity_id=chest_id)
            assert all(getattr(chest, f) is not None for f in chest.BAND_FIELDS.values())
            pool = QuestionPool.objects.get(region_id=REGION_ID, entity_id=chest_id)
            assert pool.enabled is False  # staff enable it once a set is published (ADR-046)
        replay = TreasureChest.objects.get(entity_id="np-replay-workshop-sums")
        assert replay.presentation == "REPLAY" and replay.reward_rule is None


class TestLayoutUpgrade:
    """GE-074 save compatibility: a database seeded before layout v2/v3 is upgraded in place."""

    def old_scene(self):
        scene = layout.scene()
        for key in ("engineBridge",):
            scene.pop(key)
        scene["effects"]["checkpoints"] = [
            {"id": "np-cp-landing", "label": "Santa's Landing", "x": 0, "z": 92, "yaw": 0}
        ]
        scene["northPoleVersion"] = 1
        scene["copy"] = {**scene["copy"], "loading": "My own words."}
        scene["platformTuning"] = {"np-plat-trampoline": {"bounceHeight": 2.0}}
        return scene

    def test_an_old_layout_is_upgraded_and_authored_copy_and_tuning_survive(self, north_pole, api):
        seed_north_pole()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        region.scene = self.old_scene()
        region.save()
        child = north_pole.a1
        play = Play(api(north_pole.a), child)
        assert (
            play.solve("np-welcome-look", submission("np-welcome-look", "PATHFINDER")).json()[
                "correct"
            ]
            is True
        )
        before_keys, before_items = keys(child), owned(child)

        created = seed_north_pole()
        assert f"layout v{layout.LAYOUT_VERSION} for {REGION_ID}" in created
        region.refresh_from_db()
        assert region.scene["northPoleVersion"] == layout.LAYOUT_VERSION
        assert region.scene["engineBridge"] == layout.scene()["engineBridge"]
        assert "checkpoints" not in region.scene["effects"]
        assert region.scene["copy"]["loading"] == "My own words."
        assert region.scene["platformTuning"] == {"np-plat-trampoline": {"bounceHeight": 2.0}}
        # The child's saves are rows, untouched by the upgrade, and play continues.
        assert keys(child) == before_keys and owned(child) == before_items
        assert (
            Play(api(north_pole.a), child).region()["region"]["scene"]["northPoleVersion"]
            == layout.LAYOUT_VERSION
        )

    def test_a_v4_layout_snows_once_on_the_engine_and_keeps_its_fog_and_aurora(self, north_pole):
        seed_north_pole()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        scene = layout.scene()
        scene["northPoleVersion"] = 4
        scene["engineBridge"] = {
            **scene["engineBridge"],
            "capabilities": scene["engineBridge"]["capabilities"][:3],
        }
        scene["atmosphere"] = {
            **scene["atmosphere"],
            "fog": {"color": 0x112233, "near": 40, "far": 150},  # staff-authored: kept
            "precipitation": {"kind": "SNOW", "density": 0.6},
        }
        region.scene = scene
        region.save()
        assert upgrade_north_pole(region) is True
        region.refresh_from_db()
        assert "precipitation" not in region.scene["atmosphere"]
        assert region.scene["atmosphere"]["fog"] == {"color": 0x112233, "near": 40, "far": 150}
        assert (
            region.scene["atmosphere"]["skyRibbons"] == layout.scene()["atmosphere"]["skyRibbons"]
        )
        ids = [c["id"] for c in region.scene["engineBridge"]["capabilities"]]
        assert ids[-1] == "environment.weather"

    def test_a_current_layout_is_left_alone(self, north_pole):
        seed_north_pole()
        region = WorldRegion.objects.get(region_id=REGION_ID)
        version = region.version
        assert upgrade_north_pole(region) is False
        region.refresh_from_db()
        assert region.version == version


class TestBootstrap:
    @pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
    def test_every_band_sees_the_area_with_only_the_first_puzzle_open(self, north_pole, api, band):
        child = north_pole.a1
        child.age_band = band
        child.save()
        body = Play(api(north_pole.a), child).region()
        states = {p["puzzleId"]: p for p in body["puzzles"]}
        assert set(states) == set(BODIES)
        assert states["np-welcome-look"]["locked"] is False
        assert all(states[p]["locked"] for p in states if p != "np-welcome-look")
        offered = {q["questId"]: q["status"] for q in body["quests"]}
        assert offered["np-q01-welcome"] == "AVAILABLE"
        listed = api(north_pole.a).get(f"/api/v1/children/{child.pk}/regions/").json()["regions"]
        assert REGION_ID in [r["regionId"] for r in listed]

    @pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
    def test_every_puzzle_is_introduced_and_closed_by_its_npc(self, north_pole, api, band):
        # The client refuses a non-choice puzzle without an intro; the server falls back to the
        # title, but every North Pole puzzle has its host NPC's own lines for every band.
        child = north_pole.a1
        child.age_band = band
        child.save()
        for puzzle in Play(api(north_pole.a), child).region()["puzzles"]:
            params = puzzle["parameters"]
            assert params["intro"] != BODIES[puzzle["puzzleId"]]["title"], puzzle["puzzleId"]
            assert params.get("completeMessage"), puzzle["puzzleId"]

    def test_another_family_cannot_see_or_play_this_child(self, north_pole, api):
        other = api(north_pole.b)
        child = north_pole.a1
        assert other.get(f"/api/v1/children/{child.pk}/regions/{REGION_ID}/").status_code == 404
        response = post(other, f"/api/v1/children/{child.pk}/regions/{REGION_ID}/session/")
        assert response.status_code == 404


class TestPlaythrough:
    @pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
    def test_the_missing_christmas_star_end_to_end(self, north_pole, api, band):
        child = north_pole.a1
        child.age_band = band
        child.save()
        play = Play(api(north_pole.a), child)
        for quest_id in QUEST_IDS[:1]:
            assert play.accept(quest_id).status_code in (200, 201)

        play_everything(play, band, check_wrong=(band == "PATHFINDER"))

        recorded = keys(child)
        assert {b["worldChangeKey"] for b in PUZZLES} <= recorded
        assert {spec[2] for chest, spec in CHESTS.items() if spec[0] == "CHEST"} <= recorded
        assert {
            "np-trophy-christmas-star",
            "np-badge-santas-helper",
            "np-badge-reindeer-rescuer",
            "np-cosmetic-santa-hat",
            *[f"np-star-{f.removeprefix('np-')}" for f in FRAGMENTS],
        } <= owned(child)

        # Accepting the remaining quests afterwards credits everything already done (NP-D3).
        for quest_id in QUEST_IDS[1:]:
            assert play.accept(quest_id).status_code in (200, 201)
        statuses = dict(
            QuestProgress.objects.filter(child=child).values_list("quest__slug", "status")
        )
        assert all(statuses[q] == QuestStatus.COMPLETED for q in QUEST_IDS), statuses
        assert COMPLETION_KEY in keys(child)

    @pytest.mark.parametrize("band", ["SPROUT", "PATHFINDER", "EXPLORER"])
    def test_every_quiz_solve_records_skill_evidence_for_the_dashboard(self, north_pole, api, band):
        """FPV-D10: each graded quiz answer records evidence under a catalog objective, and the
        parent's skill view shows it. Mechanical kinds record none."""
        from apps.catalog.models import LearningObjective
        from apps.education.models import SkillEvidence
        from apps.regions import puzzles

        child = north_pole.a1
        child.age_band = band
        child.save()
        client = api(north_pole.a)
        play = Play(client, child)
        assert play.accept(QUEST_IDS[0]).status_code in (200, 201)
        play_everything(play, band)

        known = set(LearningObjective.objects.values_list("code", flat=True))
        expected = set()
        for body in PUZZLES:
            if body["kind"] in puzzles.SKILL_KINDS:
                params = body["ageBands"][band]
                code = puzzles.skill_for(body["kind"], params, submission(body["puzzleId"], band))
                assert code in known, (body["puzzleId"], code)
                expected.add((body["puzzleId"], code))
        recorded = {
            (e.puzzle_attempt.puzzle_key, e.learning_objective_code)
            for e in SkillEvidence.objects.filter(child=child, puzzle_attempt__isnull=False)
        }
        assert recorded == expected
        skills = client.get(f"/api/v1/children/{child.pk}/skill-progress/").json()["skills"]
        assert {code for _pid, code in expected} <= {s["learningObjectiveCode"] for s in skills}

    def test_stage_order_is_the_servers(self, north_pole, api):
        play = Play(api(north_pole.a), north_pole.a1)
        locked = play.solve("np-workshop-count", submission("np-workshop-count", "PATHFINDER"))
        assert locked.json()["error"]["code"] == "puzzle_locked"
        # The observatory needs every fragment, not just the puzzles before it.
        for body in PUZZLES[: [b["puzzleId"] for b in PUZZLES].index("np-obs-fragments")]:
            if body["puzzleId"] == "np-stables-return":
                play.pickup("np-snowball-collar")
            play.solve(body["puzzleId"], submission(body["puzzleId"], "PATHFINDER"))
            if body["puzzleId"] == "np-workshop-pattern":
                play.open_chest("np-workshop-gift-chest")
            if body["puzzleId"] == "np-ginger-build":
                play.open_chest("np-mountain-lever-1")
                play.open_chest("np-mountain-lever-2")
        blocked = play.solve("np-obs-fragments", submission("np-obs-fragments", "PATHFINDER"))
        assert blocked.json()["error"]["code"] == "puzzle_locked"

    def test_rewards_are_granted_once_and_a_replay_is_practice(self, north_pole, api):
        child = north_pole.a1
        play = Play(api(north_pole.a), child)
        play_everything(play, "PATHFINDER")
        granted = GrantedRule.objects.filter(child=child).count()
        items = owned(child)

        # Solved choice puzzles still grade as practice and grant nothing (FPV-D6).
        again = play.solve("np-lake-sums", submission("np-lake-sums", "PATHFINDER")).json()
        assert again["alreadySolved"] and again.get("practice") is True
        assert play.pickup("np-fragment-lake").status_code == 200  # already in the backpack

        # Post-story practice chests repeat and grant nothing permanent.
        for _ in range(2):
            assert play.open_chest("np-replay-workshop-sums")["correct"] is True
        assert GrantedRule.objects.filter(child=child).count() == granted
        assert owned(child) == items

    def test_the_tenth_snowflake_completes_the_set_and_gives_the_scarf_once(self, north_pole, api):
        # Set completion is granted by the server (inventory.services, FPV-18 a2a96ca5).
        child = north_pole.a1
        play = Play(api(north_pole.a), child)
        play_everything(play, "PATHFINDER")
        flakes = [f"np-snowflake-{n:02d}" for n in range(1, 11)]
        for entity_id in flakes[:-1]:
            assert play.pickup(entity_id).status_code in (200, 201), entity_id
        assert "np-cosmetic-snowflake-scarf" not in owned(child)
        assert play.pickup(flakes[-1]).status_code in (200, 201)
        assert "np-cosmetic-snowflake-scarf" in owned(child)
        assert play.pickup(flakes[-1]).status_code == 200  # already in the backpack
        scarves = InventoryItem.objects.filter(
            child=child, item__item_id="np-cosmetic-snowflake-scarf"
        )
        assert scarves.count() == 1

    def test_leaving_and_coming_back_keeps_everything(self, north_pole, api):
        child = north_pole.a1
        play = Play(api(north_pole.a), child)
        play.solve("np-welcome-look", submission("np-welcome-look", "PATHFINDER"))
        play.pickup("np-fragment-village")
        post(play.client, f"{play.base}sessions/{play.session}/complete/")
        play.session = play.start()
        body = play.region()
        states = {p["puzzleId"]: p for p in body["puzzles"]}
        assert states["np-welcome-look"]["solved"] is True
        assert states["np-workshop-count"]["locked"] is False
        assert "np-star-fragment-village" in owned(child)


class TestPublish:
    def test_refused_outside_local_development(self, families):
        with pytest.raises(CommandError):
            call_command("publish_north_pole")

    @override_settings(DEBUG=True)
    def test_publishes_the_seeded_rows_in_local_development(self, families):
        import_content()
        call_command("seed_north_pole")
        call_command("publish_north_pole")
        region = WorldRegion.objects.get(region_id=REGION_ID)
        assert region.status == ContentStatus.PUBLISHED
        assert set(region.puzzles.values_list("status", flat=True)) == {ContentStatus.PUBLISHED}

    @override_settings(DEBUG=True)
    def test_every_published_puzzle_skill_is_a_learning_objective(self, families):
        from apps.education.services import puzzle_skill_report

        import_content()
        call_command("seed_north_pole")
        call_command("publish_north_pole")
        assert [r for r in puzzle_skill_report() if r["region"] == REGION_ID] == []
