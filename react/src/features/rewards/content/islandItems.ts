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
    setId: 'castle-keepsakes',
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
    setId: 'castle-keepsakes',
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
  // SC-R04-06: the keepsake for restoring the Great Storybook, shown on a Trophy Room pedestal.
  {
    id: 'great-storybook-seal',
    displayName: "The Great Storybook's Seal",
    description:
      'A golden seal pressed into the Great Storybook the day you helped bring its pages home.',
    category: 'KEEPSAKE',
    rarity: 'RARE',
    setId: 'castle-keepsakes',
  },
  // SC-R07-01: castle artifacts for the Trophy Room pedestals (slots 4 to 6). Each is earned once by
  // a server-graded path (an adventure completion, or a protected world change Django records).
  {
    id: 'painted-words-brush',
    displayName: 'Painted Words Brush',
    description: 'A little brush with a speck of every color. It helped the words find their way home.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
    setId: 'castle-keepsakes',
  },
  {
    id: 'three-clues-lens',
    displayName: "Clue Finder's Lens",
    description: 'A round glass lens for spotting clues. You found all three of them.',
    category: 'KEEPSAKE',
    rarity: 'UNCOMMON',
    setId: 'castle-keepsakes',
  },
  {
    id: 'secret-door-key',
    displayName: "Silver Keeper's Key",
    description: 'A small silver key from behind the secret door, to remember what was waiting there.',
    category: 'KEEPSAKE',
    rarity: 'RARE',
    setId: 'castle-keepsakes',
  },
];

/**
 * The Storykeeper Castle keepsakes (SC-R07-01), in Trophy Room pedestal order. Each age band earns
 * the ones its own castle adventures give, so no single child is expected to hold all six, and the
 * set has no completion prize. A pedestal waiting for one is never a debt (`castleTrophies.ts`).
 */
export const CASTLE_KEEPSAKE_IDS = [
  'storykeepers-quill',
  'blank-page-storybook',
  'great-storybook-seal',
  'painted-words-brush',
  'three-clues-lens',
  'secret-door-key',
] as const;

export const ISLAND_COLLECTIBLE_SETS: CollectibleSet[] = [
  {
    id: 'harbor-shells',
    displayName: 'Harbor Shells',
    completionMessage: 'You found every shell on the harbor beach. What a collection!',
    itemIds: ['spiral-shell', 'moon-shell', 'rainbow-shell', 'singing-shell'],
    completionItemId: 'beachcomber-hat',
  },
  {
    id: 'castle-keepsakes',
    displayName: 'Castle Keepsakes',
    completionMessage: 'Every pedestal in the Trophy Room has a keepsake on it.',
    itemIds: [...CASTLE_KEEPSAKE_IDS],
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
  // SC-R04-06: one rule per band's Great Storybook quest, all granting the one seal. Each rule
  // fires once per child, and a child has only their own band's quest, so the seal is given once.
  ...(
    [
      'restore-the-great-storybook-sprouts',
      'restore-the-great-storybook-pathfinders',
      'restore-the-great-storybook-explorers',
    ] as const
  ).map((questId) => ({
    id: `reward-${questId}`,
    trigger: { type: 'QUEST_COMPLETED' as const, questId },
    itemIds: ['great-storybook-seal'],
    message: 'The Great Storybook is whole again. A golden seal glows on its cover, just for you.',
  })),
  // SC-R07-01: castle artifacts. The two WORLD_CHANGE rules name protected keys (Great Storybook
  // page sources, docs/security/WORLD_CHANGE_INTEGRITY.md), and Django pays them only when its own
  // adventure or story path records that key at its own place, so a client cannot forge one.
  {
    id: 'reward-painted-words-brush',
    trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'the-painted-words' },
    itemIds: ['painted-words-brush'],
    message: 'Keeper Quill gives you a little paintbrush for bringing the words home.',
  },
  {
    id: 'reward-three-clues-lens',
    trigger: { type: 'WORLD_CHANGE', changeKey: 'SECRET_DOOR_CLUES_COLLECTED' },
    itemIds: ['three-clues-lens'],
    message: 'You found all three clues. Keeper Quill gives you a lens to keep.',
  },
  {
    id: 'reward-secret-door-key',
    trigger: { type: 'WORLD_CHANGE', changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' },
    itemIds: ['secret-door-key'],
    message: 'A silver key was waiting behind the door. It is yours to keep.',
  },
];

export function findItem(itemId: string): ItemDefinition | null {
  return ISLAND_ITEMS.find((item) => item.id === itemId) ?? null;
}

export function findCollectibleSet(setId: string): CollectibleSet | null {
  return ISLAND_COLLECTIBLE_SETS.find((set) => set.id === setId) ?? null;
}
