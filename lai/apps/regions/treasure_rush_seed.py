"""The Treasure Rush region, applied as rows (TR-2, adapted in POST-MERGE-03).

Temporary source of truth for the cove's **spatial** layout and its chest challenges: the
region, spawn point, treasure chest and Pip's placement (LAI-0805 decides how layouts are
authored later). Everything non-spatial (the location, Pip, the Golden Doubloon, its reward rule
and the quest) is catalog content from the export
(`react/src/features/content-export/treasureRushContent.ts`), so run `load_content` first.

Region, challenge specs and Adventure launch points are created as DRAFT and nothing is
overwritten once it exists.

The bridge signpost (ADR-041 decision C) is the cove's Adventure launch object: it offers Pirate
Builder Bay's bridge adventure for the child's age band (one launch point per band, all on the
same signpost). It uses the bundled `signpost` prop; no new or unpublished asset is needed.

The cove's four-zone layout (TR-13) is `treasure_cove_layout.py`, written into
`scene["layout"]`. It is the one thing the seed refreshes on an existing region: when the stored
`layoutVersion` is older than `LAYOUT_VERSION`, the seed replaces the layout and bounds, bumps the
region's version, and turns the landing spawn point to face inland if it still has the old
default. Title, copy, placements and status are never touched.
"""

import math

from django.db import transaction

from apps.catalog.models import Adventure, Location, NpcDefinition, Quest, RewardRule
from apps.education.models import ChallengeSpec
from apps.users.models import AgeBand

from .models import (
    AdventureLaunchPoint,
    LaunchObjectKind,
    PlacementKind,
    SpawnPoint,
    TreasureChest,
    WorldObjectPlacement,
    WorldRegion,
)
from .treasure_cove_layout import BOUNDS, LAYOUT_VERSION, cove_layout

REGION_ID = "treasure-rush-cove"
CHEST_ID = "cove-chest"
CHEST_CHANGE_KEY = "TREASURE_RUSH_COVE_CHEST_OPENED"
REWARD_ITEM_ID = "golden-doubloon"
REWARD_RULE_ID = "reward-treasure-rush-cove-chest"
QUEST_ID = "treasure-rush-cove"
SIGNPOST_ID = "cove-bridge-signpost"
# Pirate Builder Bay's bridge adventure, one per age band (content export, adventures.json).
BRIDGE_ADVENTURES = {
    "three-planks-for-the-bridge": "Help Pip carry planks to the bridge",
    "repair-the-moonlight-bridge": "Help Pip repair the Moonlight Bridge",
    "the-tide-gate-calculation": "Help Pip work out the tide gate",
}


# Off the boat, facing inland (south) toward Pip, the first chest and the ruins.
LANDING_YAW = math.pi


class SeedPrerequisiteMissing(LookupError):
    pass


def upgrade_cove_layout(region: WorldRegion) -> bool:
    """Bring an existing region's seed-owned layout up to `LAYOUT_VERSION`. True if it changed."""
    scene = region.scene if isinstance(region.scene, dict) else {}
    if scene.get("layoutVersion", 1) >= LAYOUT_VERSION:
        return False
    region.scene = {
        **scene,
        "bounds": dict(BOUNDS),
        "layoutVersion": LAYOUT_VERSION,
        "layout": cove_layout(),
    }
    region.version += 1
    region.save(update_fields=["scene", "version", "updated_at"])
    # Only the old default facing is turned; a spawn point an admin moved or turned stays put.
    region.spawn_points.filter(checkpoint_id="cove-landing", x=0.0, z=10.0, yaw=0.0).update(
        yaw=LANDING_YAW
    )
    return True


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
                "bounds": dict(BOUNDS),
                "layoutVersion": LAYOUT_VERSION,
                "layout": cove_layout(),
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
        {"label": "the landing", "x": 0.0, "z": 10.0, "yaw": LANDING_YAW, "is_default": True},
    )
    if upgrade_cove_layout(region):
        created.append(f"WorldRegion {region} layout v{LAYOUT_VERSION}")
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
    signpost = get_or_create(
        WorldObjectPlacement,
        {"region": region, "entity_id": SIGNPOST_ID},
        {
            "kind": PlacementKind.PROP,
            "label": "Bridge signpost",
            "asset_id": "signpost",
            "x": -3.0,
            "z": 6.0,
            "placeholder_width": 0.6,
            "placeholder_height": 1.6,
            "placeholder_depth": 0.2,
        },
    )
    adventures = Adventure.objects.filter(slug__in=BRIDGE_ADVENTURES, location=bay)
    for order, adventure in enumerate(sorted(adventures, key=lambda a: a.slug)):
        get_or_create(
            AdventureLaunchPoint,
            {"region": region, "launch_id": f"signpost-{adventure.slug}"},
            {
                "entity_id": signpost.entity_id,
                "object_kind": LaunchObjectKind.SIGN,
                "adventure": adventure,
                "label": BRIDGE_ADVENTURES[adventure.slug],
                "prompt": "The sign points to the broken bridge.",
                "sort_order": order,
            },
        )
    if not region.offered_quests.exists():
        region.offered_quests.add(quest)
    return created
