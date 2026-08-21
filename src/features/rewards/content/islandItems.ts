/**
 * The island's authored treasure (docs/ROADMAP.md Phase 24).
 *
 * Two authoring rules run through this file, both asserted in
 * `islandItems.test.ts`:
 *
 * - **Some treasure is simply treasure.** The roadmap makes this an explicit
 *   design rule, so several items here carry no lesson, no skill, and no
 *   purpose beyond being nice to have. An `ItemDefinition` has nowhere to
 *   put a learning objective even if someone wanted to.
 * - **Rewards attach to real content.** Every trigger below names an
 *   adventure slug, story slug, or world-change key that actually exists
 *   today, so the table cannot drift into rewarding content nobody can reach.
 *
 * Copy targets Pathfinders (ages 5-6), matching every other authored set.
 */
import type { CollectibleSet, ItemDefinition, RewardTable } from '../types';

export const ISLAND_ITEMS: ItemDefinition[] = [
  // --- Shell collection: the "simply treasure" set. No lesson attached. ---
  {
    id: 'spiral-shell',
    displayName: 'Spiral Shell',
    description: 'A little shell that curls around and around like a slide.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: 'harbor-shells',
  },
  {
    id: 'moon-shell',
    displayName: 'Moon Shell',
    description: 'Pale and round, like a tiny moon washed up on the sand.',
    category: 'COLLECTIBLE',
    rarity: 'COMMON',
    setId: 'harbor-shells',
  },
  {
    id: 'rainbow-shell',
    displayName: 'Rainbow Shell',
    description: 'Tip it toward the sun and it shows every color at once.',
    category: 'COLLECTIBLE',
    rarity: 'UNCOMMON',
    setId: 'harbor-shells',
  },
  {
    id: 'singing-shell',
    displayName: 'Singing Shell',
    description: 'Hold it to your ear and it hums the sound of the sea.',
    category: 'COLLECTIBLE',
    rarity: 'RARE',
    setId: 'harbor-shells',
    // Hidden: found by exploring, never listed as a slot waiting to be filled.
    hidden: true,
  },
  {
    id: 'beachcomber-hat',
    displayName: 'Beachcomber Hat',
    description: 'A wide straw hat for shell hunters. Earned by finding every shell.',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'HAT',
  },

  // --- Quest items: earned by completing real adventures and stories. ---
  {
    id: 'bridge-builders-hammer',
    displayName: "Bridge Builder's Hammer",
    description: 'Pip gave you this for fixing the Moonlight Bridge.',
    category: 'QUEST_ITEM',
    rarity: 'UNCOMMON',
  },
  {
    id: 'bee-dance-notebook',
    displayName: 'Bee Dance Notebook',
    description: 'Your own drawings of how bees waggle to share directions.',
    category: 'QUEST_ITEM',
    rarity: 'COMMON',
  },
  {
    id: 'storykeepers-quill',
    displayName: "Storykeeper's Quill",
    description: 'A feather pen from Keeper Quill, for the tale you helped tell.',
    category: 'QUEST_ITEM',
    rarity: 'UNCOMMON',
  },

  // --- Keepsakes: mementos of big moments. ---
  {
    id: 'ember-scale',
    displayName: "Ember's Scale",
    description: 'A warm, shimmering scale Ember gave you as a thank you.',
    category: 'KEEPSAKE',
    rarity: 'RARE',
  },
  {
    id: 'friendship-knot',
    displayName: 'Friendship Knot',
    description: 'Pip taught you this knot the day you became friends.',
    category: 'KEEPSAKE',
    rarity: 'COMMON',
  },

  // --- Cosmetics: creativity, not status. ---
  {
    id: 'explorer-backpack',
    displayName: 'Explorer Backpack',
    description: 'Plenty of pockets for whatever you find next.',
    category: 'COSMETIC',
    rarity: 'COMMON',
    cosmeticSlot: 'BACKPACK',
  },
  {
    id: 'star-lantern',
    displayName: 'Star Lantern',
    description: 'A little lantern that glows soft and steady.',
    category: 'COSMETIC',
    rarity: 'UNCOMMON',
    cosmeticSlot: 'ACCESSORY',
  },
];

export const ISLAND_COLLECTIBLE_SETS: CollectibleSet[] = [
  {
    id: 'harbor-shells',
    displayName: 'Harbor Shells',
    completionMessage: 'You found every shell on the harbor beach. What a collection!',
    itemIds: ['spiral-shell', 'moon-shell', 'rainbow-shell', 'singing-shell'],
    completionItemId: 'beachcomber-hat',
  },
];

/**
 * The island's reward table. Flat, deterministic, and readable top to bottom:
 * a content designer can see exactly what every action gives, because there
 * is no chance involved to reason about.
 */
export const ISLAND_REWARD_TABLE: RewardTable = [
  {
    id: 'reward-bridge-repaired',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'repair-the-moonlight-bridge' },
    itemIds: ['bridge-builders-hammer', 'explorer-backpack'],
    message: 'Pip hands you a hammer of your own. You earned it!',
  },
  {
    id: 'reward-waggle-dance',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'buzz-and-the-waggle-dance' },
    itemIds: ['bee-dance-notebook'],
    message: 'You made a notebook full of bee dance drawings.',
  },
  {
    id: 'reward-storykeepers-tale',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'the-storykeepers-tale' },
    itemIds: ['storykeepers-quill'],
    message: 'Keeper Quill gives you a feather pen for your story.',
  },
  {
    id: 'reward-ember-story',
    trigger: { type: 'STORY_COMPLETED', storySlug: 'dragon-of-ember-mountain' },
    itemIds: ['ember-scale', 'star-lantern'],
    message: 'Ember gives you a shining scale to remember the mountain by.',
  },
  {
    id: 'reward-pip-friendship',
    trigger: { type: 'NPC_RELATIONSHIP', npcId: 'pirate-pip', level: 'FRIEND' },
    itemIds: ['friendship-knot'],
    message: 'Pip shows you how to tie a friendship knot.',
  },
  {
    id: 'reward-bridge-world-change',
    trigger: { type: 'WORLD_CHANGE', changeKey: 'bridge-repaired' },
    itemIds: ['spiral-shell'],
    message: 'A shell washed up while you worked. It is yours to keep.',
  },
];

export function findItem(itemId: string): ItemDefinition | null {
  return ISLAND_ITEMS.find((item) => item.id === itemId) ?? null;
}

export function findCollectibleSet(setId: string): CollectibleSet | null {
  return ISLAND_COLLECTIBLE_SETS.find((set) => set.id === setId) ?? null;
}
