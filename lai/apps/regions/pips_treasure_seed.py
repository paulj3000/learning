"""Pip's Missing Treasure (TR-14): the four encounters of Treasure Cove, applied as rows.

Called by `seed_treasure_rush` after the region exists. Like the rest of the seed it creates
rows that do not exist yet and never edits one that does, so staff changes in Django admin and
every child's progress survive a re-run. The one exception is versioned and seed-owned:
`upgrade_pips_treasure` moves an existing region from the one-chest quest to this one
(`scene["adventureVersion"]`), once.

The encounters, in order (each chest requires the one before it, so hints and Pip's clues
always point somewhere the child can go):

1. **Pirate Landing**: the seeded chest (`cove-chest`), unchanged.
2. **Palm Tree Grove**: a `HIDDEN` chest in the ring of bushes; it appears once chest 1 is open.
3. **Shipwreck Beach**: a chest that also needs the Old Brass Key, a pickup on the X in the sand.
4. **Ancient Treasure Ruins**: a `PUZZLE` on the pedestal, answered by touching one of three
   rune stones; solving it unlocks the golden chest behind it.

Then the child returns to Pip, whose `TALK_TO` objective completes the quest, records
`TREASURE_COVE_QUEST_COMPLETE` (TR-17's signal) and grants the explorer badge.

Items, reward rules and the quest are catalog content from the export
(`react/src/features/content-export/treasureRushContent.ts`); positions match
`treasure_cove_layout.SPOTS`.
"""

from apps.catalog.models import ItemDefinition, Quest, RewardRule
from apps.education.models import ChallengeSpec
from apps.users.models import AgeBand

from .models import ChestPresentation, PlacementKind, TreasureChest, WorldObjectPlacement
from .treasure_cove_layout import RUNE_STONES, SPOTS

ADVENTURE_VERSION = 1
PIPS_QUEST_ID = "pips-missing-treasure"
LEGACY_QUEST_ID = "treasure-rush-cove"

LANDING_CHEST_KEY = "TREASURE_RUSH_COVE_CHEST_OPENED"
GROVE_CHEST_KEY = "TREASURE_COVE_GROVE_CHEST_OPENED"
BEACH_CHEST_KEY = "TREASURE_COVE_BEACH_CHEST_OPENED"
PUZZLE_SOLVED_KEY = "TREASURE_COVE_RUINS_PUZZLE_SOLVED"
FINAL_CHEST_KEY = "TREASURE_COVE_FINAL_CHEST_OPENED"
KEY_FOUND_KEY = "TREASURE_COVE_KEY_FOUND"
QUEST_COMPLETE_KEY = "TREASURE_COVE_QUEST_COMPLETE"

KEY_ITEM_ID = "old-brass-key"
KEY_ENTITY_ID = "cove-brass-key"
RUNE_STONE_IDS = ["cove-rune-stone-1", "cove-rune-stone-2", "cove-rune-stone-3"]

LANDING_CLUE = "My first chest is right here at Pirate Landing. Walk up to it and open it!"

# (slug suffix, title, {band: (skill, min, max, mode, choices)})
_SPECS = {
    "grove": (
        "Hidden chest",
        {
            AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
            AgeBand.PATHFINDER: ("subtraction-within-ten", 0, 10, "CHOICE", 4),
            AgeBand.EXPLORER: ("addition-within-ten", 1, 10, "NUMBER_INPUT", 0),
        },
    ),
    "beach": (
        "Locked chest",
        {
            AgeBand.SPROUT: ("counting-sets", 2, 5, "CHOICE", 3),
            AgeBand.PATHFINDER: ("counting-sets", 4, 10, "CHOICE", 4),
            AgeBand.EXPLORER: ("subtraction-within-ten", 0, 10, "CHOICE", 4),
        },
    ),
    # A puzzle is answered by touching one of three rune stones, so three choices for every band.
    "puzzle": (
        "Rune stone puzzle",
        {
            AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
            AgeBand.PATHFINDER: ("addition-within-ten", 1, 5, "CHOICE", 3),
            AgeBand.EXPLORER: ("subtraction-within-ten", 0, 10, "CHOICE", 3),
        },
    ),
    "final": (
        "Golden chest",
        {
            AgeBand.SPROUT: ("counting-sets", 1, 5, "CHOICE", 3),
            AgeBand.PATHFINDER: ("addition-within-ten", 2, 5, "NUMBER_INPUT", 0),
            AgeBand.EXPLORER: ("addition-within-ten", 1, 10, "NUMBER_INPUT", 0),
        },
    ),
}


def _specs(encounter: str, get_or_create) -> dict:
    title, bands = _SPECS[encounter]
    out = {}
    for band, (skill, low, high, mode, choices) in bands.items():
        out[band] = get_or_create(
            ChallengeSpec,
            {"slug": f"treasure-cove-{encounter}-{band.lower()}"},
            {
                "title": f"Treasure Cove {title.lower()}: {skill}",
                "age_band": band,
                "skill_id": skill,
                "min_value": low,
                "max_value": high,
                "response_mode": mode,
                "choice_count": choices,
            },
        )
    return out


def _bands(specs: dict) -> dict:
    return {
        "sprout_challenge": specs[AgeBand.SPROUT],
        "pathfinder_challenge": specs[AgeBand.PATHFINDER],
        "explorer_challenge": specs[AgeBand.EXPLORER],
    }


def seed_pips_treasure(region, get_or_create) -> None:
    """Create the encounters' specs, chests, rune stones and key that do not exist yet."""
    rules = {
        rule.rule_id: rule for rule in RewardRule.objects.filter(rule_id__startswith="reward-")
    }
    key_item = ItemDefinition.objects.get(item_id=KEY_ITEM_ID)

    for index, ((x, z), entity_id) in enumerate(zip(RUNE_STONES, RUNE_STONE_IDS, strict=True)):
        get_or_create(
            WorldObjectPlacement,
            {"region": region, "entity_id": entity_id},
            {
                "kind": PlacementKind.PROP,
                "label": f"Rune stone {index + 1}",
                "x": x,
                "z": z,
                "placeholder_width": 0.7,
                "placeholder_height": 1.7,
                "placeholder_depth": 0.5,
            },
        )
    key_x, key_z = SPOTS["beach-key"]
    get_or_create(
        WorldObjectPlacement,
        {"region": region, "entity_id": KEY_ENTITY_ID},
        {
            "kind": PlacementKind.COLLECTIBLE,
            "label": "Old brass key",
            "x": key_x,
            "z": key_z,
            "elevation": 0.5,
            "placeholder_width": 0.4,
            "placeholder_height": 0.2,
            "placeholder_depth": 0.1,
            "pickup_change_key": KEY_FOUND_KEY,
            "pickup_reward_rule": rules["reward-treasure-cove-key"],
        },
    )

    grove_x, grove_z = SPOTS["grove-hidden-chest"]
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": "cove-grove-chest"},
        {
            "label": "Hidden chest",
            "x": grove_x,
            "z": grove_z,
            "rotation_y": 2.36,  # facing the gap in the bushes, toward the flower trail
            "placeholder_width": 1.2,
            "placeholder_height": 0.9,
            "placeholder_depth": 0.8,
            "presentation": ChestPresentation.HIDDEN,
            "sort_order": 1,
            "required_world_change_key": LANDING_CHEST_KEY,
            "reward_rule": rules["reward-treasure-cove-grove-chest"],
            "world_change_key": GROVE_CHEST_KEY,
            "clue": "I hid a chest in Palm Tree Grove. Follow the flowers to the bushes!",
            **_bands(_specs("grove", get_or_create)),
        },
    )
    beach_x, beach_z = SPOTS["beach-locked-chest"]
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": "cove-beach-chest"},
        {
            "label": "Locked chest",
            "x": beach_x,
            "z": beach_z,
            "rotation_y": 3.14,
            "placeholder_width": 1.2,
            "placeholder_height": 0.9,
            "placeholder_depth": 0.8,
            "sort_order": 2,
            "required_world_change_key": GROVE_CHEST_KEY,
            "required_item": key_item,
            "reward_rule": rules["reward-treasure-cove-beach-chest"],
            "world_change_key": BEACH_CHEST_KEY,
            "clue": "A chest by the shipwreck is locked. Look for an X in the sand to find the "
            "key!",
            **_bands(_specs("beach", get_or_create)),
        },
    )
    pedestal_x, pedestal_z = SPOTS["ruins-pedestal"]
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": "cove-ruins-pedestal"},
        {
            "label": "Glowing pedestal",
            "asset_id": "",
            "open_clip": "",
            "x": pedestal_x,
            "z": pedestal_z,
            "placeholder_width": 1.6,
            "placeholder_height": 1.4,
            "placeholder_depth": 1.6,
            "presentation": ChestPresentation.PUZZLE,
            "sort_order": 3,
            "required_world_change_key": BEACH_CHEST_KEY,
            "answer_entity_ids": list(RUNE_STONE_IDS),
            "world_change_key": PUZZLE_SOLVED_KEY,
            "clue": "The ruins have a puzzle! Read the glowing pedestal, then touch the right "
            "rune stone.",
            **_bands(_specs("puzzle", get_or_create)),
        },
    )
    final_x, final_z = SPOTS["ruins-final-chest"]
    get_or_create(
        TreasureChest,
        {"region": region, "entity_id": "cove-final-chest"},
        {
            "label": "Golden chest",
            "x": final_x,
            "z": final_z,
            "scale": 1.25,
            "placeholder_width": 1.2,
            "placeholder_height": 0.9,
            "placeholder_depth": 0.8,
            "sort_order": 4,
            "required_world_change_key": PUZZLE_SOLVED_KEY,
            "reward_rule": rules["reward-treasure-cove-final-chest"],
            "world_change_key": FINAL_CHEST_KEY,
            "clue": "The golden chest is on the stone stage behind the pedestal. Open it!",
            **_bands(_specs("final", get_or_create)),
        },
    )


def upgrade_pips_treasure(region) -> bool:
    """Offer Pip's Missing Treasure in the cove instead of the one-chest quest, once.

    Only seed-owned state changes: the region's offered quests (the old quest stays in the
    catalog, so a child who started it keeps their progress and backpack) and the first chest's
    clue and order while they are still the seed's defaults. True if anything changed.
    """
    scene = region.scene if isinstance(region.scene, dict) else {}
    if scene.get("adventureVersion", 0) >= ADVENTURE_VERSION:
        return False
    region.offered_quests.remove(*Quest.objects.filter(slug=LEGACY_QUEST_ID))
    region.offered_quests.add(Quest.objects.get(slug=PIPS_QUEST_ID))
    TreasureChest.objects.filter(region=region, entity_id="cove-chest", clue="").update(
        clue=LANDING_CLUE
    )
    region.scene = {**scene, "adventureVersion": ADVENTURE_VERSION}
    region.save(update_fields=["scene", "updated_at"])
    return True
