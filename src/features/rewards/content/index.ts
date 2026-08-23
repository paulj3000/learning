import { ISLAND_COLLECTIBLE_SETS, ISLAND_ITEMS, ISLAND_REWARD_TABLE } from './islandItems';
import { CREATURE_CARE_COVE_ITEMS, CREATURE_CARE_COVE_REWARD_TABLE } from './creatureCareCoveItems';
import type { CollectibleSet, ItemDefinition, RewardTable } from '../types';

export * from './islandItems';
export * from './creatureCareCoveItems';

/**
 * Every authored item, set, and reward rule across every world
 * (docs/ROADMAP.md Phase 29, "shared player identity and inventory across
 * worlds").
 *
 * The Reward Engine is deliberately world-blind: a backpack is one backpack,
 * a collectible set may be finished anywhere, and a reward rule fires on
 * what a child did rather than on where they were standing. So the engines
 * read these aggregates, and the per-world constants above stay what they
 * are, an authoring unit. Which world owns which id is recorded once, in
 * that world's content pack (src/features/worlds/packs/), and nowhere else.
 */
export const ALL_ITEMS: ItemDefinition[] = [...ISLAND_ITEMS, ...CREATURE_CARE_COVE_ITEMS];

export const ALL_COLLECTIBLE_SETS: CollectibleSet[] = [...ISLAND_COLLECTIBLE_SETS];

export const ALL_REWARD_RULES: RewardTable = [
  ...ISLAND_REWARD_TABLE,
  ...CREATURE_CARE_COVE_REWARD_TABLE,
];
