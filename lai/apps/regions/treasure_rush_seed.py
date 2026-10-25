"""The Treasure Rush region, applied as rows (TR-2, adapted in POST-MERGE-03).

Temporary source of truth for the cove's **spatial** layout and its chest challenges: the
region, spawn point, treasure chest and Pip's placement (LAI-0805 decides how layouts are
authored later). Everything non-spatial (the location, Pip, the Golden Doubloon, its reward rule
and the quest) is catalog content from the export
(`react/src/features/content-export/treasureRushContent.ts`), so run `load_content` first.

Region and challenge specs are created as DRAFT and nothing is overwritten once it exists.
"""

from django.db import transaction

from apps.catalog.models import Location, NpcDefinition, Quest, RewardRule
from apps.education.models import ChallengeSpec
from apps.users.models import AgeBand

from .models import PlacementKind, SpawnPoint, TreasureChest, WorldObjectPlacement, WorldRegion

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
        bay = Location.objects.get(slug="pirate-builder-bay")
        pip = NpcDefinition.objects.get(npc_id="pirate-pip")
        rule = RewardRule.objects.get(rule_id=REWARD_RULE_ID)
        quest = Quest.objects.get(slug=QUEST_ID)
    except (
        Location.DoesNotExist,
        NpcDefinition.DoesNotExist,
        RewardRule.DoesNotExist,
        Quest.DoesNotExist,
    ) as error:
        raise SeedPrerequisiteMissing("Run load_content first.") from error

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
            "asset_id": "npc-pip",
            "x": 3.0,
            "z": 6.0,
            "interaction_id": pip.interaction_id,
            "placeholder_height": 1.6,
        },
    )
    if not region.offered_quests.exists():
        region.offered_quests.add(quest)
    return created
