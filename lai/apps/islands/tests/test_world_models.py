"""Admin-authored Treasure Rush world content (TR-2): seed, placement, and chest rules."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.adventures.models import AdventureTemplate
from apps.core.content_loader import load_content
from apps.education.models import ChallengeSpec
from apps.islands.models import (
    PlacementKind,
    SpawnPoint,
    TreasureChest,
    WorldObjectPlacement,
    WorldRegion,
)
from apps.islands.treasure_rush_seed import (
    CHEST_ID,
    REGION_ID,
    SeedPrerequisiteMissing,
    seed_treasure_rush,
)
from apps.quests.models import QuestDefinition
from apps.users.models import AgeBand

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def seeded():
    load_content()
    seed_treasure_rush()
    return WorldRegion.objects.get(region_id=REGION_ID)


def test_the_seed_needs_the_loaded_content():
    with pytest.raises(SeedPrerequisiteMissing):
        seed_treasure_rush()


def test_the_seed_is_idempotent_and_keeps_admin_edits(seeded):
    seeded.title = "Pirate Cove"
    seeded.save()
    assert seed_treasure_rush() == []
    assert WorldRegion.objects.get(region_id=REGION_ID).title == "Pirate Cove"


def test_every_seeded_row_is_valid_and_draft(seeded):
    rows = [
        seeded,
        *seeded.spawn_points.all(),
        *seeded.placements.all(),
        *seeded.chests.all(),
        QuestDefinition.objects.get(quest_id="treasure-rush-cove"),
    ]
    for row in rows:
        row.full_clean()
    assert seeded.status == "DRAFT"
    assert QuestDefinition.objects.get(quest_id="treasure-rush-cove").status == "DRAFT"


def test_the_chest_has_a_challenge_for_every_band(seeded):
    chest = seeded.chests.get(entity_id=CHEST_ID)
    for band in AgeBand.values:
        assert chest.challenge_for(band).age_band == band
    assert chest.challenge_for("TODDLER") is None
    assert chest.reward_rule.items.get().item_id == "golden-doubloon"


def test_a_challenge_for_another_band_is_refused(seeded):
    chest = seeded.chests.get(entity_id=CHEST_ID)
    chest.sprout_challenge = ChallengeSpec.objects.get(slug="treasure-cove-explorer")
    with pytest.raises(ValidationError) as raised:
        chest.full_clean()
    assert "sprout_challenge" in raised.value.message_dict


def test_a_chest_needs_at_least_one_challenge(seeded):
    chest = TreasureChest(
        region=seeded, entity_id="empty", x=0, z=0, world_change_key="TREASURE_EMPTY_OPENED"
    )
    with pytest.raises(ValidationError) as raised:
        chest.full_clean()
    assert "__all__" in raised.value.message_dict


def test_entity_ids_are_unique_across_placements_and_chests(seeded):
    clash = WorldObjectPlacement(
        region=seeded, entity_id=CHEST_ID, kind=PlacementKind.PROP, x=1, z=1
    )
    with pytest.raises(ValidationError) as raised:
        clash.full_clean()
    assert "entity_id" in raised.value.message_dict


def test_an_npc_placement_needs_an_npc_and_props_must_not_have_one(seeded):
    with pytest.raises(ValidationError) as raised:
        WorldObjectPlacement(region=seeded, entity_id="x", kind=PlacementKind.NPC, x=0, z=0).full_clean()
    assert "npc" in raised.value.message_dict


@pytest.mark.parametrize(
    ("asset_id", "code"),
    [("not-a-real-asset", "asset_unknown"), ("treasure-chest", "asset_wrong_kind")],
)
def test_placement_assets_are_checked_against_the_placement_kind(seeded, asset_id, code):
    placement = seeded.placements.get(entity_id="cove-pip")
    placement.asset_id = asset_id
    with pytest.raises(ValidationError) as raised:
        placement.full_clean()
    assert code in [error.code for error in raised.value.error_dict["asset_id"]]


def test_a_chest_refuses_a_character_model(seeded):
    chest = seeded.chests.get(entity_id=CHEST_ID)
    chest.asset_id = "npc-pip"
    with pytest.raises(ValidationError) as raised:
        chest.full_clean()
    assert "asset_wrong_kind" in [error.code for error in raised.value.error_dict["asset_id"]]


def test_a_region_has_one_default_spawn(seeded):
    with pytest.raises(IntegrityError), transaction.atomic():
        SpawnPoint.objects.create(
            region=seeded, checkpoint_id="second", label="b", x=0, z=0, is_default=True
        )


def test_entry_ids_must_name_a_real_step_or_stage(seeded):
    quest = QuestDefinition.objects.get(quest_id="treasure-rush-cove")
    quest.entry_stage_id = "nowhere"
    with pytest.raises(ValidationError):
        quest.clean()
    adventure = AdventureTemplate.objects.first()
    adventure.entry_step_id = "nowhere"
    with pytest.raises(ValidationError):
        adventure.clean()
