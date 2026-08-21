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

  // --- Exploration: the things secrets keep (docs/ROADMAP.md Phase 26). ---
  // Two keys and two pieces of treasure. The keys are `QUEST_ITEM` rather
  // than `COLLECTIBLE` because they are for opening something, and the
  // backpack should not invite a child to feel they are missing one.
  {
    id: 'driftwood-key',
    displayName: 'Driftwood Key',
    description: 'A key carved out of a piece of driftwood, worn smooth by the sea.',
    category: 'QUEST_ITEM',
    rarity: 'UNCOMMON',
  },
  {
    id: 'glowing-moss-jar',
    displayName: 'Jar of Glowing Moss',
    description: 'A little jar of soft green moss that never stops glowing.',
    category: 'QUEST_ITEM',
    rarity: 'COMMON',
  },
  {
    id: 'glowworm-crystal',
    displayName: 'Glowworm Crystal',
    description: 'Clear as water, and it catches every light in the room.',
    category: 'COLLECTIBLE',
    rarity: 'RARE',
    // Not in any set, and hidden: it exists in exactly one cave, and a child
    // who never goes in should never see a gap where it would have been.
    hidden: true,
  },
  {
    id: 'blank-page-storybook',
    displayName: 'The Book with a Blank Page',
    description: 'An old storybook from the reading nook. The last page is still empty.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
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
    // Authored world-change keys are SCREAMING_SNAKE (see the adventure
    // content packs); this rule spelled it kebab-case and so could never
    // fire. Found while wiring the Phase 25 Quest Engine, which is the
    // first thing that calls `grantRewards` at all - and asserted below by
    // `islandItems.test.ts`, since a trigger key that matches nothing fails
    // silently by design.
    trigger: { type: 'WORLD_CHANGE', changeKey: 'BRIDGE_REPAIRED' },
    itemIds: ['spiral-shell'],
    message: 'A shell washed up while you worked. It is yours to keep.',
  },
  // --- Phase 26: the secrets, and the one rare thing that closes the set. ---
  //
  // Every rule below is a `DISCOVERY` trigger, the seam Phase 24 defined and
  // left dormant because nothing could be discovered yet. "Rare-collectible
  // spawning" is exactly this and nothing more: a rare item that exists in
  // one out-of-the-way place, granted deterministically to whoever walks
  // there. There is still no roll anywhere in this table.
  {
    id: 'reward-harbor-tide-pool',
    trigger: { type: 'DISCOVERY', discoveryKey: 'harbor-tide-pool' },
    itemIds: ['moon-shell'],
    message: 'A moon shell was waiting at the bottom of the pool.',
  },
  {
    id: 'reward-bay-tide-tunnel',
    trigger: { type: 'DISCOVERY', discoveryKey: 'bay-tide-tunnel' },
    itemIds: ['driftwood-key'],
    message: 'You take the driftwood key down off its nail.',
  },
  {
    id: 'reward-harbor-keepers-door',
    trigger: { type: 'DISCOVERY', discoveryKey: 'harbor-keepers-door' },
    itemIds: ['rainbow-shell'],
    message: 'The harbor keeper will not mind you keeping the rainbow shell.',
  },
  {
    id: 'reward-wonderwild-glow-moss',
    trigger: { type: 'DISCOVERY', discoveryKey: 'wonderwild-glow-moss' },
    itemIds: ['glowing-moss-jar'],
    message: 'Now you have a light of your own.',
  },
  {
    id: 'reward-wonderwild-glowworm-cave',
    trigger: { type: 'DISCOVERY', discoveryKey: 'wonderwild-glowworm-cave' },
    itemIds: ['glowworm-crystal'],
    message: 'You pick up the crystal. It glows for a while after you leave.',
  },
  {
    id: 'reward-castle-tapestry-stair',
    trigger: { type: 'DISCOVERY', discoveryKey: 'castle-tapestry-stair' },
    itemIds: ['blank-page-storybook'],
    message: 'You carry the book with the blank page down the stair with you.',
  },
  {
    id: 'reward-quiet-places',
    // The last shell in the harbor set, and the only way to get it. Finding
    // every quiet place is what makes it appear, which also means the
    // `harbor-shells` set finally has a complete path through the island -
    // until this phase, three of its four shells had no source at all.
    trigger: { type: 'QUEST_COMPLETED', questId: 'the-quiet-places' },
    itemIds: ['singing-shell'],
    message: 'A shell you have never seen before is sitting on the tide pool rock. Listen to it.',
  },
];

export function findItem(itemId: string): ItemDefinition | null {
  return ISLAND_ITEMS.find((item) => item.id === itemId) ?? null;
}

export function findCollectibleSet(setId: string): CollectibleSet | null {
  return ISLAND_COLLECTIBLE_SETS.find((set) => set.id === setId) ?? null;
}
