import type { QuestDefinition } from '../quests/types';
import type { ItemDefinition, RewardTable } from '../rewards/types';

/**
 * Treasure Rush's non-spatial content (POST-MERGE-03): the keepsake, the reward rule and the
 * quest. Exported only, never loaded by the Amplify app, so adding them here changes nothing a
 * child sees today. They reach Django through the one content import (`manage.py
 * load_content`), like all other catalog content (ADR-019 sub-decision 8).
 *
 * The cove's layout (region, spawn point, chest, Pip's placement) is spatial data and stays out
 * of the export until LAI-0805's decision; it is authored in
 * `lai/apps/regions/treasure_rush_seed.py`, which uses the same ids as this module.
 *
 * The chest records `TREASURE_RUSH_COVE_CHEST_OPENED` when it opens (decision TR-D1: a keepsake,
 * no coins). The reward rule and the quest are keyed on that world change, in the existing
 * trigger and objective vocabularies.
 */

export const TREASURE_RUSH_CHEST_CHANGE_KEY = 'TREASURE_RUSH_COVE_CHEST_OPENED';

/*
  Pip's Missing Treasure (TR-14): four encounters across Treasure Cove's four zones. The chests,
  the key and the ruins puzzle are placed by `lai/apps/regions/treasure_rush_seed.py` with these
  same keys; each world change below is recorded by Django when the child earns it.
*/
export const PIPS_TREASURE_QUEST_ID = 'pips-missing-treasure';
export const COVE_GROVE_CHEST_KEY = 'TREASURE_COVE_GROVE_CHEST_OPENED';
export const COVE_BEACH_CHEST_KEY = 'TREASURE_COVE_BEACH_CHEST_OPENED';
export const COVE_FINAL_CHEST_KEY = 'TREASURE_COVE_FINAL_CHEST_OPENED';
export const COVE_KEY_FOUND_KEY = 'TREASURE_COVE_KEY_FOUND';
/** Recorded when the quest completes: what TR-17's bridge and Lookout Point unlock listens for. */
export const COVE_QUEST_COMPLETE_KEY = 'TREASURE_COVE_QUEST_COMPLETE';

export const TREASURE_RUSH_ITEMS: readonly ItemDefinition[] = [
  {
    id: 'golden-doubloon',
    displayName: 'Golden Doubloon',
    description: 'A shiny gold coin from the treasure chest in the cove.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'palm-grove-pearl',
    displayName: 'Palm Grove Pearl',
    description: 'A round, shiny pearl that was hidden in the bushes of Palm Tree Grove.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'old-brass-key',
    displayName: 'Old Brass Key',
    description: 'A heavy key that washed up on Shipwreck Beach. What does it open?',
    category: 'QUEST_ITEM',
    rarity: 'COMMON',
  },
  {
    id: 'shipwreck-compass',
    displayName: 'Shipwreck Compass',
    description: 'A little compass from the old ship. Its needle always finds north.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'ruins-sunstone',
    displayName: 'Sunstone',
    description: 'A warm golden stone from the Ancient Treasure Ruins. It glows like the sun.',
    category: 'KEEPSAKE',
    rarity: 'RARE',
  },
  {
    id: 'treasure-cove-explorer',
    displayName: 'Treasure Cove Explorer Badge',
    description: "For finding all of Pip's missing treasure in Treasure Cove.",
    category: 'KEEPSAKE',
    rarity: 'RARE',
  },
];

export const TREASURE_RUSH_REWARD_RULES: RewardTable = [
  {
    id: 'reward-treasure-rush-cove-chest',
    trigger: { type: 'WORLD_CHANGE', changeKey: TREASURE_RUSH_CHEST_CHANGE_KEY },
    itemIds: ['golden-doubloon'],
    message: 'You opened the chest and found a Golden Doubloon!',
  },
  {
    id: 'reward-treasure-cove-grove-chest',
    trigger: { type: 'WORLD_CHANGE', changeKey: COVE_GROVE_CHEST_KEY },
    itemIds: ['palm-grove-pearl'],
    message: 'You found the hidden chest and a Palm Grove Pearl!',
  },
  {
    id: 'reward-treasure-cove-key',
    trigger: { type: 'WORLD_CHANGE', changeKey: COVE_KEY_FOUND_KEY },
    itemIds: ['old-brass-key'],
    message: 'You found an Old Brass Key! It is in your backpack.',
  },
  {
    id: 'reward-treasure-cove-beach-chest',
    trigger: { type: 'WORLD_CHANGE', changeKey: COVE_BEACH_CHEST_KEY },
    itemIds: ['shipwreck-compass'],
    message: 'The key fits! You found a Shipwreck Compass!',
  },
  {
    id: 'reward-treasure-cove-final-chest',
    trigger: { type: 'WORLD_CHANGE', changeKey: COVE_FINAL_CHEST_KEY },
    itemIds: ['ruins-sunstone'],
    message: 'The golden chest is open! You found the Sunstone!',
  },
  {
    id: 'reward-pips-missing-treasure-complete',
    trigger: { type: 'QUEST_COMPLETED', questId: PIPS_TREASURE_QUEST_ID },
    itemIds: ['treasure-cove-explorer'],
    message: 'You are a Treasure Cove Explorer!',
  },
];

export const TREASURE_RUSH_QUESTS: readonly QuestDefinition[] = [
  {
    id: 'treasure-rush-cove',
    title: 'Treasure Rush',
    summary: 'Find the treasure chest in the cove and open it with a number puzzle.',
    giverNpcId: 'pirate-pip',
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'open-the-chest',
    stages: [
      {
        id: 'open-the-chest',
        title: 'Open the treasure chest',
        objectives: [
          {
            id: 'treasure-cove-open-chest',
            label: 'Open the treasure chest in the cove',
            kind: 'BUILD',
            changeKey: TREASURE_RUSH_CHEST_CHANGE_KEY,
          },
        ],
      },
    ],
    completion: { journalNote: 'You opened the treasure chest in Treasure Cove.' },
  },
  {
    id: PIPS_TREASURE_QUEST_ID,
    title: "Pip's Missing Treasure",
    summary: 'Pip lost four treasures around the cove. Find them all and bring them back to Pip!',
    giverNpcId: 'pirate-pip',
    ageBands: ['SPROUT', 'PATHFINDER', 'EXPLORER'],
    prerequisites: [{ type: 'ALWAYS' }],
    entryStageId: 'find-the-treasure',
    stages: [
      {
        id: 'find-the-treasure',
        title: "Find Pip's treasures",
        objectives: [
          {
            id: 'cove-landing-chest',
            label: 'Open the chest at Pirate Landing',
            kind: 'BUILD',
            changeKey: TREASURE_RUSH_CHEST_CHANGE_KEY,
          },
          {
            id: 'cove-grove-chest',
            label: 'Find the hidden chest in Palm Tree Grove',
            kind: 'BUILD',
            changeKey: COVE_GROVE_CHEST_KEY,
          },
          {
            id: 'cove-beach-chest',
            label: 'Unlock the chest on Shipwreck Beach',
            kind: 'BUILD',
            changeKey: COVE_BEACH_CHEST_KEY,
          },
          {
            id: 'cove-final-chest',
            label: 'Open the golden chest in the ruins',
            kind: 'BUILD',
            changeKey: COVE_FINAL_CHEST_KEY,
          },
        ],
        nextStageId: 'return-to-pip',
      },
      {
        id: 'return-to-pip',
        title: 'Bring the treasure back to Pip',
        objectives: [
          {
            id: 'cove-return-to-pip',
            label: 'Talk to Pip at Pirate Landing',
            kind: 'TALK_TO',
            npcId: 'pirate-pip',
            memoryFlag: 'cove-treasure-returned',
          },
        ],
      },
    ],
    completion: {
      journalNote: "You found all four of Pip's missing treasures in Treasure Cove.",
      worldChanges: [
        {
          locationSlug: 'pirate-builder-bay',
          changeType: 'UNLOCK',
          changeKey: COVE_QUEST_COMPLETE_KEY,
        },
      ],
    },
  },
];
