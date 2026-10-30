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

export const TREASURE_RUSH_ITEMS: readonly ItemDefinition[] = [
  {
    id: 'golden-doubloon',
    displayName: 'Golden Doubloon',
    description: 'A shiny gold coin from the treasure chest in the cove.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
];

export const TREASURE_RUSH_REWARD_RULES: RewardTable = [
  {
    id: 'reward-treasure-rush-cove-chest',
    trigger: { type: 'WORLD_CHANGE', changeKey: TREASURE_RUSH_CHEST_CHANGE_KEY },
    itemIds: ['golden-doubloon'],
    message: 'You opened the chest and found a Golden Doubloon!',
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
];
