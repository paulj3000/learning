"""Starter Treasure Rush content, as ordinary admin-editable rows (TR-2).

This is not source content and it is not exported: it only saves an administrator from
building the first region by hand. Everything is created as DRAFT and nothing is overwritten
once it exists, so admin edits survive a re-run. Needs `load_content` first (it uses Pirate
Builder Bay and Pirate Pip).

Placement follows proposed decisions TR-D1 (keepsake, not coins) and TR-D2 (a region inside
Pirate Builder Bay); if either is decided differently, change these rows in admin.
"""

from django.db import transaction

from apps.core.catalog import ContentStatus
from apps.education.models import ChallengeSpec
from apps.inventory.models import ItemCategory, ItemDefinition, ItemRarity, RewardRule
from apps.quests.models import QuestDefinition
from apps.users.models import AgeBand

from .models import (
    IslandLocation,
    NpcDefinition,
    PlacementKind,
    SpawnPoint,
    TreasureChest,
    WorldObjectPlacement,
    WorldRegion,
)

REGION_ID = "treasure-rush-cove"
CHEST_ID = "cove-chest"
CHEST_CHANGE_KEY = "TREASURE_RUSH_COVE_CHEST_OPENED"
REWARD_ITEM_ID = "golden-doubloon"
REWARD_RULE_ID = "reward-treasure-rush-cove-chest"
QUEST_ID = "treasure-rush-cove"


class SeedPrerequisiteMissing(LookupError):
    pass


@transaction.atomic
def seed_treasure_rush() -> list[str]:
    """Create the starter rows that do not exist yet. Returns what was created."""
    created: list[str] = []

    def get_or_create(model, lookup: dict, values: dict):
        row, was_created = model.objects.get_or_create(**lookup, defaults=values)
        if was_created:
            created.append(f"{model.__name__} {row}")
        return row

    try:
        bay = IslandLocation.objects.get(slug="pirate-builder-bay")
        pip = NpcDefinition.objects.get(npc_id="pirate-pip")
    except (IslandLocation.DoesNotExist, NpcDefinition.DoesNotExist) as error:
        raise SeedPrerequisiteMissing("Run load_content first.") from error

    doubloon = get_or_create(
        ItemDefinition,
        {"item_id": REWARD_ITEM_ID},
        {
            "display_name": "Golden Doubloon",
            "description": "A shiny gold coin from the treasure chest in the cove.",
            "category": ItemCategory.KEEPSAKE,
            "rarity": ItemRarity.UNCOMMON,
        },
    )
    rule = get_or_create(
        RewardRule,
        {"rule_id": REWARD_RULE_ID},
        {
            "trigger": {"type": "CHEST_OPENED", "chestId": CHEST_ID},
            "message": "You opened the chest and found a Golden Doubloon!",
        },
    )
    if not rule.items.exists():
        rule.items.add(doubloon)

    specs = {
        AgeBand.SPROUT: get_or_create(
            ChallengeSpec,
            {"slug": "treasure-cove-sprout"},
            {
                "title": "Treasure Cove chest: count the coins",
                "age_band": AgeBand.SPROUT,
                "skill_id": "counting-sets",
                "min_value": 1,
                "max_value": 5,
                "response_mode": "CHOICE",
                "choice_count": 3,
            },
        ),
        AgeBand.PATHFINDER: get_or_create(
            ChallengeSpec,
            {"slug": "treasure-cove-pathfinder"},
            {
                "title": "Treasure Cove chest: add the coins",
                "age_band": AgeBand.PATHFINDER,
                "skill_id": "addition-within-ten",
                "min_value": 1,
                "max_value": 5,
                "response_mode": "CHOICE",
                "choice_count": 4,
            },
        ),
        AgeBand.EXPLORER: get_or_create(
            ChallengeSpec,
            {"slug": "treasure-cove-explorer"},
            {
                "title": "Treasure Cove chest: take away coins",
                "age_band": AgeBand.EXPLORER,
                "skill_id": "subtraction-within-ten",
                "min_value": 0,
                "max_value": 10,
                "response_mode": "NUMBER_INPUT",
                "choice_count": 0,
            },
        ),
    }

    region = get_or_create(
        WorldRegion,
        {"region_id": REGION_ID},
        {
            "location": bay,
            "title": "Treasure Cove",
            "scene": {
                "bounds": {"halfExtentX": 18, "halfExtentZ": 18, "wallThickness": 1},
                "environment": {"backgroundColor": 0x9FD8F0},
                "copy": {
                    "loading": "Sailing to Treasure Cove.",
                    "instructions": "Walk to the treasure chest and open it.",
                    "calmStop": "The tide is going out. Time to rest. The cove will be here.",
                },
            },
        },
    )
    get_or_create(
        SpawnPoint,
        {"region": region, "checkpoint_id": "cove-landing"},
        {"label": "the landing", "x": 0.0, "z": 10.0, "yaw": 0.0, "is_default": True},
    )
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": CHEST_ID},
        {
            "label": "Treasure chest",
            "x": 0.0,
            "z": -6.0,
            "placeholder_width": 1.2,
            "placeholder_height": 0.9,
            "placeholder_depth": 0.8,
            "sprout_challenge": specs[AgeBand.SPROUT],
            "pathfinder_challenge": specs[AgeBand.PATHFINDER],
            "explorer_challenge": specs[AgeBand.EXPLORER],
            "reward_rule": rule,
            "world_change_key": CHEST_CHANGE_KEY,
        },
    )
    get_or_create(
        WorldObjectPlacement,
        {"region": region, "entity_id": "cove-pip"},
        {
            "kind": PlacementKind.NPC,
            "npc": pip,
            "label": "Pirate Pip",
            "x": 3.0,
            "z": 6.0,
            "interaction_id": pip.interaction_id,
            "placeholder_height": 1.6,
        },
    )
    get_or_create(
        QuestDefinition,
        {"quest_id": QUEST_ID},
        {
            "title": "Treasure Rush",
            "summary": "Find the treasure chest in the cove and open it with a number puzzle.",
            "age_bands": [AgeBand.SPROUT, AgeBand.PATHFINDER, AgeBand.EXPLORER],
            "giver_npc": pip,
            "prerequisites": [{"type": "ALWAYS"}],
            "entry_stage_id": "open-the-chest",
            "stages": [
                {
                    "id": "open-the-chest",
                    "title": "Open the treasure chest",
                    "objectives": [
                        {
                            "id": "treasure-cove-open-chest",
                            "kind": "BUILD",
                            "changeKey": CHEST_CHANGE_KEY,
                            "label": "Open the treasure chest in the cove",
                        }
                    ],
                }
            ],
            "completion": {"journalNote": "You opened the treasure chest in Treasure Cove."},
            "status": ContentStatus.DRAFT,
        },
    )
    return created
