/**
 * Creature Care Cove's treasure (docs/ROADMAP.md Phase 29).
 *
 * Authored under exactly the rules `islandItems.ts` states, because a second
 * world does not get a second set of rules: nothing is random, rarity is
 * descriptive, nothing is ever lost, and some treasure is simply treasure.
 *
 * **Why one rule on `QUEST_COMPLETED` rather than several on the world
 * changes the cove records.** Only two of the six `RewardTrigger` kinds are
 * wired into live gameplay today: `QUEST_COMPLETED` (fired by
 * `syncQuestProgress`) and `DISCOVERY` (fired by `openDiscovery`). The other
 * four, `WORLD_CHANGE` included, are still dormant platform-wide, which is a
 * Phase 24 limitation this phase inherited rather than one it introduced -
 * `reward-bridge-world-change` on the island has never fired either. Keying
 * the cove's treasure on `COVE_CREATURES_FED` would have read perfectly and
 * granted nothing, so the cove hangs its one rule on the trigger that
 * actually fires. When the dormant triggers are wired up, this is the
 * natural place to split the grant back apart.
 */
import type { ItemDefinition, RewardTable } from '../types';

export const CREATURE_CARE_COVE_ITEMS: ItemDefinition[] = [
  {
    id: 'lantern-shell',
    displayName: 'Lantern Shell',
    description: 'A thin, pale shell that glows faintly when you hold it up to a light.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
  },
  {
    id: 'keepers-tally-book',
    displayName: "Keeper's Tally Book",
    description: 'A small book with a page for every creature and a line for every day.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
  },
  {
    id: 'cove-keepers-apron',
    displayName: "Cove Keeper's Apron",
    description: 'A sturdy apron with deep pockets, worn by everyone who helps at the cove.',
    category: 'COSMETIC',
    rarity: 'RARE',
    cosmeticSlot: 'OUTFIT',
  },
];

export const CREATURE_CARE_COVE_REWARD_TABLE: RewardTable = [
  {
    id: 'reward-helping-at-the-cove',
    trigger: { type: 'QUEST_COMPLETED', questId: 'helping-at-the-cove' },
    itemIds: ['lantern-shell', 'keepers-tally-book', 'cove-keepers-apron'],
    message: 'Nella gives you a lantern shell, a tally book, and an apron of your very own.',
  },
];
