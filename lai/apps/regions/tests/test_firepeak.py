"""Firepeak Volcano, The Volcano Awakens (FP-2, FP-4 to FP-12): the seed, the age bands, the five
stages end to end through the play API, stage order, rewards and the Discovery Journal, resume,
Django Admin edits during a visit, and the development-only publish command."""

import json

import pytest
from django.core.management import CommandError, call_command
from django.test import override_settings

from apps.catalog import authoring
from apps.catalog.importer import import_content
from apps.catalog.models import AssetOrigin, ContentAsset, NpcDefinition
from apps.catalog.tests.helpers import publish_edit
from apps.core.content_status import ContentStatus
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import firepeak_seed
from apps.regions.firepeak_seed import CHANGE, REGION_ID, seed_firepeak
from apps.regions.models import AreaPuzzle, WorldRegion

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

TELESCOPE = {"observed": ["crater", "lava-flow", "steam-vent"]}
PATHFINDER_CROSSING = {
    "placements": {
        "firepeak-gap-near": "firepeak-stone-small",
        "firepeak-gap-middle": "firepeak-stone-middle",
        "firepeak-gap-far": "firepeak-stone-big",
    }
}
EXPLORER_CROSSING = {
    "placements": {
        "firepeak-gap-near": "firepeak-stone-middle",
        "firepeak-gap-middle": "firepeak-stone-big",
        "firepeak-gap-far": "firepeak-stone-small",
    }
}
VALVES = {"sequence": ["firepeak-valve-red", "firepeak-valve-blue", "firepeak-valve-green"]}
JOURNAL = {
    "journal-volcano-crater",
    "journal-lava",
    "journal-steam-vents",
    "journal-volcanic-minerals",
    "journal-heart-crystal",
}


def publish_all():
    WorldRegion.objects.filter(region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)
    AreaPuzzle.objects.filter(region__region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)


@pytest.fixture
def firepeak(families):
    import_content()
    seed_firepeak()
    publish_all()
    return families


def base(child):
    return f"/api/v1/children/{child.pk}/"


def post(client, url, body=None):
    return client.post(url, json.dumps(body or {}), content_type="application/json")


def bootstrap(client, child):
    return client.get(f"{base(child)}regions/{REGION_ID}/")


def start(client, child):
    response = post(client, f"{base(child)}regions/{REGION_ID}/session/")
    assert response.status_code in (200, 201), response.content
    return response.json()["sessionId"]


def solve(client, child, session, puzzle_id, submission):
    return post(
        client,
        f"{base(child)}sessions/{session}/puzzles/{puzzle_id}/solve/",
        {"submission": submission},
    )


def accept(client, child):
    response = post(client, f"{base(child)}quests/the-volcano-awakens/accept/")
    assert response.status_code in (200, 201), response.content


def owned(child) -> set[str]:
    return set(InventoryItem.objects.filter(child=child).values_list("item__item_id", flat=True))


class TestSeed:
    def test_the_seed_needs_the_export_first(self, db):
        with pytest.raises(firepeak_seed.SeedPrerequisiteMissing):
            seed_firepeak()

    def test_the_seed_is_idempotent_and_never_overwrites(self, firepeak):
        puzzle = AreaPuzzle.objects.get(puzzle_id="firepeak-telescope")
        body = authoring.current_body(puzzle)
        body["title"] = "Use the big telescope"
        publish_edit(puzzle, body)

        assert seed_firepeak() == []

        puzzle.refresh_from_db()
        assert puzzle.title == "Use the big telescope"

    def test_every_puzzle_has_a_published_first_version_for_both_bands(self, firepeak):
        puzzles = AreaPuzzle.objects.filter(region__region_id=REGION_ID).order_by("sort_order")
        assert [p.puzzle_id for p in puzzles] == [
            "firepeak-telescope",
            "firepeak-crossing",
            "firepeak-steam",
            "firepeak-heart-crystal",
            "firepeak-return",
        ]
        for puzzle in puzzles:
            assert puzzle.published_revision.number == 1
            assert set(puzzle.parameters) == {"PATHFINDER", "EXPLORER"}
            assert authoring.validate(puzzle, authoring.current_body(puzzle)) == []

    def test_missing_models_are_asset_definitions_waiting_for_a_glb(self, firepeak):
        assets = ContentAsset.objects.filter(asset_id__startswith="firepeak-")
        assert assets.count() == len(firepeak_seed.FIREPEAK_ASSETS)
        assert all(a.origin == AssetOrigin.DJANGO and a.default_version is None for a in assets)

    def test_the_layout_passes_the_admin_checks(self, firepeak):
        region = WorldRegion.objects.get(region_id=REGION_ID)
        for row in [*region.placements.all(), *region.puzzles.all(), region]:
            row.full_clean()


class TestBootstrap:
    def test_a_pathfinder_sees_ember_the_quest_and_the_first_stage_open(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        body = bootstrap(client, child).json()

        ember = next(n for n in body["npcs"] if n["npcId"] == "professor-ember")
        assert ember["dialogue"][0]["nodeId"] == "ember-greeting"
        assert [q["questId"] for q in body["quests"]] == ["the-volcano-awakens"]
        states = {p["puzzleId"]: p for p in body["puzzles"]}
        assert states["firepeak-telescope"]["locked"] is False
        assert all(states[p]["locked"] for p in states if p != "firepeak-telescope")
        assert states["firepeak-crossing"]["parameters"]["showOutlines"] is True
        catalog = {a["assetId"]: a for a in body["catalog"]["assets"]}
        assert catalog["firepeak-professor-ember"]["deliverable"] is False
        assert catalog["rock"]["deliverable"] is True
        assert body["catalog"]["worldSlug"] == "learning-adventure-island"

    def test_sprouts_cannot_see_or_start_firepeak(self, firepeak, api):
        child = firepeak.a2
        child.age_band = "SPROUT"
        child.save()
        client = api(firepeak.a)
        assert bootstrap(client, child).status_code == 404
        session = post(client, f"{base(child)}regions/{REGION_ID}/session/")
        assert session.status_code in (404, 409)
        regions = client.get(f"{base(child)}regions/").json()["regions"]
        assert REGION_ID not in [r["regionId"] for r in regions]


class TestPlaythrough:
    def test_the_volcano_awakens_end_to_end(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        session = start(client, child)
        accept(client, child)

        # Stage 1: the telescope.
        assert (
            solve(client, child, session, "firepeak-telescope", {"observed": ["crater"]}).json()[
                "correct"
            ]
            is False
        )
        telescope = solve(client, child, session, "firepeak-telescope", TELESCOPE).json()
        assert telescope["correct"] and telescope["solvedNow"]
        assert {i["itemId"] for i in telescope["newItems"]} == {
            "journal-volcano-crater",
            "journal-lava",
            "journal-steam-vents",
        }
        assert all(i["journal"]["subject"] == "EARTH_SCIENCE" for i in telescope["newItems"])

        # Stage 2: the crossing (stage order is the server's: steam is still locked).
        locked = solve(client, child, session, "firepeak-steam", VALVES)
        assert locked.json()["error"]["code"] == "puzzle_locked"
        wrong = dict(PATHFINDER_CROSSING["placements"])
        wrong["firepeak-gap-near"], wrong["firepeak-gap-far"] = (
            wrong["firepeak-gap-far"],
            wrong["firepeak-gap-near"],
        )
        assert (
            solve(client, child, session, "firepeak-crossing", {"placements": wrong}).json()[
                "correct"
            ]
            is False
        )
        assert solve(client, child, session, "firepeak-crossing", PATHFINDER_CROSSING).json()[
            "correct"
        ]

        # Stage 3: the steam (a wrong order leaves the steam where it was).
        backwards = {"sequence": list(reversed(VALVES["sequence"]))}
        assert solve(client, child, session, "firepeak-steam", backwards).json()["correct"] is False
        assert solve(client, child, session, "firepeak-steam", VALVES).json()["correct"]

        # Stage 4: the crystal.
        crystal = solve(client, child, session, "firepeak-heart-crystal", {}).json()
        assert {"heart-crystal-fragment-1", "journal-heart-crystal"} <= {
            i["itemId"] for i in crystal["newItems"]
        }

        # Stage 5: back to Professor Ember.
        done = solve(client, child, session, "firepeak-return", {}).json()
        assert [i["itemId"] for i in done["newItems"]] == ["volcano-explorer-badge"]
        assert any(u["justCompleted"] for u in done["questUpdates"])

        progress = QuestProgress.objects.get(child=child, quest__slug="the-volcano-awakens")
        assert progress.status == QuestStatus.COMPLETED
        keys = set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True))
        assert {*CHANGE.values(), "FIREPEAK_VOLCANO_AWAKENED"} <= keys
        assert {"heart-crystal-fragment-1", "volcano-explorer-badge", *JOURNAL} <= owned(child)

        # Ember now thanks the child; replaying any stage grants nothing again.
        ember = next(
            n for n in bootstrap(client, child).json()["npcs"] if n["npcId"] == "professor-ember"
        )
        assert ember["dialogue"][0]["nodeId"] == "ember-thanks"
        again = solve(client, child, session, "firepeak-return", {}).json()
        assert again["alreadySolved"] and again["newItems"] == []
        assert GrantedRule.objects.filter(child=child).count() == 3

    def test_an_explorer_gets_the_harder_crossing(self, firepeak, api):
        child = firepeak.a2
        child.age_band = "EXPLORER"
        child.save()
        client = api(firepeak.a)
        session = start(client, child)
        solve(client, child, session, "firepeak-telescope", TELESCOPE)
        params = next(
            p
            for p in bootstrap(client, child).json()["puzzles"]
            if p["puzzleId"] == "firepeak-crossing"
        )["parameters"]
        assert params["showOutlines"] is False
        assert (
            solve(client, child, session, "firepeak-crossing", PATHFINDER_CROSSING).json()[
                "correct"
            ]
            is False
        )
        assert solve(client, child, session, "firepeak-crossing", EXPLORER_CROSSING).json()[
            "correct"
        ]


class TestAcceptingLate:
    def test_work_done_before_accepting_counts_once_the_quest_is_accepted(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        session = start(client, child)
        solve(client, child, session, "firepeak-telescope", TELESCOPE)
        solve(client, child, session, "firepeak-crossing", PATHFINDER_CROSSING)

        accept(client, child)

        progress = QuestProgress.objects.get(child=child, quest__slug="the-volcano-awakens")
        assert progress.status == QuestStatus.ACTIVE
        assert progress.current_stage_id == "redirect-the-steam"
        assert progress.completed_stage_ids == ["meet-professor-ember", "repair-the-crossing"]


class TestResume:
    def test_leaving_halfway_and_coming_back_keeps_everything(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        session = start(client, child)
        accept(client, child)
        solve(client, child, session, "firepeak-telescope", TELESCOPE)
        solve(client, child, session, "firepeak-crossing", PATHFINDER_CROSSING)
        assert post(client, f"{base(child)}sessions/{session}/pause/").status_code == 200

        resumed = start(client, child)

        assert resumed == session
        states = {p["puzzleId"]: p for p in bootstrap(client, child).json()["puzzles"]}
        assert states["firepeak-crossing"]["solved"] and not states["firepeak-steam"]["locked"]
        assert solve(client, child, session, "firepeak-steam", VALVES).json()["correct"]

    def test_a_new_visit_after_completing_one_keeps_progress(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        session = start(client, child)
        solve(client, child, session, "firepeak-telescope", TELESCOPE)
        post(client, f"{base(child)}sessions/{session}/complete/")

        second = start(client, child)

        assert second != session
        states = {p["puzzleId"]: p for p in bootstrap(client, child).json()["puzzles"]}
        assert states["firepeak-telescope"]["solved"] and not states["firepeak-crossing"]["locked"]


def ember():
    return NpcDefinition.objects.get(npc_id=firepeak_seed.NPC_ID)


def edit_line(node_id, text):
    """Publish a new version of Professor Ember with one dialogue line changed."""
    npc = ember()
    body = authoring.current_body(npc)
    for node in body["dialogue"]:
        if node["id"] == node_id:
            node["text"] = text
    publish_edit(npc, body)


def parameters(client, child):
    return {p["puzzleId"]: p["parameters"] for p in bootstrap(client, child).json()["puzzles"]}


class TestPuzzleLinesAreDialogue:
    """LAI-0817 (FP-D9): each band's puzzle lines are Ember's dialogue, served as before."""

    SERVED = {
        "PATHFINDER": {
            "firepeak-telescope": {
                "intro": "Look through my telescope. Can you find the crater, the lava, and "
                "the steam?",
                "completeMessage": "You found all three! Now let us go look closer.",
            },
            "firepeak-heart-crystal": {
                "scienceNote": "Crystals grow slowly as hot rock cools. This one also glows "
                "with island magic.",
            },
        },
        "EXPLORER": {
            "firepeak-telescope": {
                "intro": "Firepeak is waking up! Look through my telescope and find three "
                "clues: the crater, the lava flow, and a steam vent.",
                "completeMessage": "Great observing! The steam and lava tell us magma is "
                "moving. Let us cross the lava river and look closer.",
            },
            "firepeak-heart-crystal": {
                "scienceNote": "Real crystals grow when hot, mineral-rich liquid cools slowly "
                "and its tiny parts line up in a pattern. This one also glows with island "
                "magic.",
            },
        },
    }

    def test_the_puzzle_bodies_no_longer_carry_lines(self, firepeak):
        for puzzle in AreaPuzzle.objects.filter(region__region_id=REGION_ID):
            for params in authoring.current_body(puzzle)["ageBands"].values():
                assert not {"intro", "completeMessage", "scienceNote"} & set(params)

    @pytest.mark.parametrize("band", ["PATHFINDER", "EXPLORER"])
    def test_each_band_is_served_its_own_lines(self, firepeak, api, band):
        child = firepeak.a1
        child.age_band = band
        child.save(update_fields=["age_band"])
        served = parameters(api(firepeak.a), child)
        for puzzle_id, lines in self.SERVED[band].items():
            for part, text in lines.items():
                assert served[puzzle_id][part] == text
        # Every puzzle opens with an authored line for every band; shared lines reach both.
        assert all(params["intro"] for params in served.values())
        assert served["firepeak-crossing"]["scienceNote"] == (
            "Basalt is a dark rock that forms when lava cools quickly."
        )

    def test_puzzle_lines_are_never_said_in_conversation(self, firepeak, api):
        npcs = bootstrap(api(firepeak.a), firepeak.a1).json()["npcs"]
        node_ids = {node["nodeId"] for npc in npcs for node in npc["dialogue"]}
        assert "ember-greeting" in node_ids
        assert not any("-intro-" in i or "-scienceNote-" in i for i in node_ids)

    def test_a_visit_pinned_before_the_move_keeps_its_own_lines(self, firepeak, api):
        # A visit that pinned versions from before LAI-0817: the puzzle still carries its lines
        # and Ember has none. With no dialogue line replacing one, it plays as it started.
        from apps.game_sessions.models import AdventureSession

        client, child = api(firepeak.a), firepeak.a1
        session = AdventureSession.objects.get(pk=start(client, child))
        npc = ember()
        old_npc = authoring.current_body(npc)
        old_npc["dialogue"] = [n for n in old_npc["dialogue"] if "puzzleLine" not in n]
        crossing = AreaPuzzle.objects.get(puzzle_id="firepeak-crossing")
        old_crossing = authoring.current_body(crossing)
        old_crossing["ageBands"]["PATHFINDER"]["intro"] = "An intro from the old parameters."
        for row, body in ((npc, old_npc), (crossing, old_crossing)):
            # Recorded directly, as revisions published before the move were.
            revision = authoring.record_published(row, body, origin="SEED")
            session.pinned_revisions.remove(
                *session.pinned_revisions.filter(
                    content_type=revision.content_type, object_id=revision.object_id
                )
            )
            session.pinned_revisions.add(revision)

        served = parameters(client, child)

        assert served["firepeak-crossing"]["intro"] == "An intro from the old parameters."
        # No line and no old copy: the puzzle opens with its authored title, never silence.
        assert served["firepeak-telescope"]["intro"] == "Look through the telescope"


class TestAdminEditsDuringAVisit:
    def test_an_edit_reaches_new_visits_only(self, firepeak, api):
        client, child = api(firepeak.a), firepeak.a1
        start(client, child)
        edit_line("ember-telescope-intro-pathfinder", "Peek through the telescope!")

        during = bootstrap(client, child).json()["puzzles"][0]["parameters"]["intro"]
        sibling = firepeak.a2
        start(client, sibling)
        after = bootstrap(client, sibling).json()["puzzles"][0]["parameters"]["intro"]

        assert during != "Peek through the telescope!"
        assert after == "Peek through the telescope!"


class TestPublishCommand:
    def test_refused_outside_local_development(self, families):
        import_content()
        seed_firepeak()
        with pytest.raises(CommandError, match="not published"):
            call_command("publish_firepeak", stdout=None, stderr=None)

    @override_settings(DEBUG=True)
    def test_publishes_the_seeded_rows_in_local_development(self, families):
        import_content()
        call_command("seed_firepeak", stdout=None)
        call_command("publish_firepeak", stdout=None)
        region = WorldRegion.objects.get(region_id=REGION_ID)
        assert region.status == ContentStatus.PUBLISHED
        assert set(region.puzzles.values_list("status", flat=True)) == {ContentStatus.PUBLISHED}
