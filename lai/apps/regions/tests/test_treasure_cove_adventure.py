"""Treasure Cove's Game Engine Core AdventureDefinition matches what the seed publishes (GE-070).

The definition is data in `react/src/features/region-play/treasureCoveAdventure.json`; the client
validates it against the engine. This test is the other half: every id it names is one Django
really serves, so the definition can never drift from the content (Django is authoritative,
ADR-047). Equality, not inclusion: a new chest or pickup in the seed must be added there too.
"""

import json
from pathlib import Path

import pytest
from django.conf import settings

from apps.catalog.importer import import_content
from apps.regions.models import PlacementKind, WorldRegion
from apps.regions.treasure_rush_seed import REGION_ID, seed_treasure_rush

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

DEFINITION = (
    Path(settings.BASE_DIR).parent / "react/src/features/region-play/treasureCoveAdventure.json"
)


@pytest.fixture
def cove():
    import_content()
    seed_treasure_rush()
    return WorldRegion.objects.get(region_id=REGION_ID)


@pytest.fixture
def definition():
    return json.loads(DEFINITION.read_text(encoding="utf-8"))


def placed(definition, component_type):
    return {c["id"] for c in definition["components"] if c["type"] == component_type}


def test_the_definition_file_is_where_the_test_looks():
    assert DEFINITION.is_file(), DEFINITION


def test_it_names_this_area_and_its_place_as_the_realm(cove, definition):
    assert definition["id"] == REGION_ID
    assert definition["areas"] == [REGION_ID]
    assert definition["realmId"] == cove.location.slug


def test_every_chest_and_only_the_seeded_chests(cove, definition):
    seeded = set(cove.chests.values_list("entity_id", flat=True))
    assert placed(definition, "gameplay.chest") == seeded
    assert set(definition["challengeIds"]) == seeded


def test_every_pickup_and_only_the_seeded_pickups(cove, definition):
    seeded = set(
        cove.placements.filter(kind=PlacementKind.COLLECTIBLE).values_list("entity_id", flat=True)
    )
    assert placed(definition, "gameplay.collectible") == seeded


def test_the_quests_the_cove_offers(cove, definition):
    offered = set(cove.offered_quests.values_list("slug", flat=True))
    assert set(definition["questIds"]) == offered


def test_the_learning_objectives_are_the_chests_challenge_skills(cove, definition):
    skills = set()
    for chest in cove.chests.all():
        for spec in (chest.sprout_challenge, chest.pathfinder_challenge, chest.explorer_challenge):
            if spec is not None:
                skills.add(spec.skill_id)
    assert set(definition["learningObjectiveIds"]) == skills


def test_checkpoints_are_seeded_spawn_points_or_course_checkpoints(cove, definition):
    spawns = set(cove.spawn_points.values_list("checkpoint_id", flat=True))
    # GE-071: Pirate's Leap's course checkpoints live in the engine bridge block.
    course = {
        checkpoint["id"]
        for capability in cove.scene["engineBridge"]["capabilities"]
        if capability["id"] == "gameplay.checkpoints"
        for checkpoint in capability["config"]["checkpoints"]
    }
    declared = {c["id"] for c in definition["checkpoints"]}
    assert declared == {c for c in declared if c in spawns} | course
    assert course <= declared


def test_jump_challenges_are_the_ones_the_seed_tracks(cove, definition):
    seeded = {
        challenge["challengeId"]
        for capability in cove.scene["engineBridge"]["capabilities"]
        if capability["id"] == "gameplay.jumpChallenges"
        for challenge in capability["config"]["challenges"]
    }
    assert {c["id"] for c in definition["jumpChallenges"]} == seeded


def test_the_world_consequence_is_the_change_that_opens_lookout_point(cove, definition):
    # The cove's unlock rule lives in its seed-authored layout (`scene["layout"]`, TR-17).
    assert definition["worldConsequenceId"] == cove.scene["layout"]["unlock"]["changeKey"]
