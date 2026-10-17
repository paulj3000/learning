/**
 * Reward/Economy Engine (docs/ROADMAP.md Phase 24, docs/ARCHITECTURE.md
 * "Platform engine boundaries" entry 9). Owns inventory, item definitions,
 * collectible sets, and reward tables.
 *
 * Kept deliberately distinct from two neighbors it is easy to conflate:
 * a `WorldChange` is not a reward (the bridge being repaired is a change to
 * the island, not treasure in a backpack), and `SkillProgress` is not a
 * reward (an item is never proof of mastery, and mastery is never spent).
 *
 * Four safety properties hold across this whole engine, each asserted by
 * tests rather than left to convention:
 *
 * 1. **Nothing is random.** Every grant is a deterministic function of what
 *    the child did. The same action always yields the same items. This is
 *    the structural answer to CLAUDE.md pillar 7's "no loot-box mechanics"
 *    — there is no randomness to tune, so there is no chance-based reward
 *    to be tuned into a compulsion loop.
 * 2. **Rarity is descriptive, never a drop rate.** See `ItemRarity`.
 * 3. **Nothing is lost.** Items are never consumed, spent, taken, traded,
 *    or expired. There is no currency and no sink, so no child can be made
 *    to feel poorer than another (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 *    section 19: "avoid systems designed around envy, rarity pressure, or
 *    leaderboards").
 * 4. **Not every reward is educational.** Per the roadmap's own explicit
 *    design rule, "some treasure is simply treasure" — `ItemDefinition`
 *    carries no learning objective at all, and authored content includes
 *    items that exist purely for delight.
 */

/** Stable authored identifier for an item. Never generated at runtime. */
export type ItemId = string;

/**
 * What an item is for. Drawn directly from the roadmap's own list
 * (collectible sets, cosmetics, quest items, hidden collectibles) — hidden
 * collectibles are ordinary `COLLECTIBLE` items flagged `hidden`, rather
 * than a fifth category, since hiddenness is about how an item is found and
 * not about what it is.
 */
export type ItemCategory = 'COLLECTIBLE' | 'COSMETIC' | 'QUEST_ITEM' | 'KEEPSAKE';

/**
 * How scarce an item is *in the authored world* — roughly, how far off the
 * main path a child has to wander to find it. It exists so a content
 * designer can describe an item and so the backpack can group things
 * pleasingly.
 *
 * It is emphatically NOT a drop chance, a power tier, or a status rank.
 * Nothing in `rewardTable.ts` reads rarity when deciding what to grant
 * (asserted in `rewardTable.test.ts`), there is no randomness for it to
 * weight, and no child-facing surface ranks children by what they hold.
 * The explorable-world roadmap's section 19 rules out envy and rarity
 * pressure outright; keeping rarity purely descriptive is how that rule
 * survives contact with an inventory system.
 */
export type ItemRarity = 'COMMON' | 'UNCOMMON' | 'RARE';

export const ITEM_RARITY_ORDER: readonly ItemRarity[] = ['COMMON', 'UNCOMMON', 'RARE'];

/** Where a cosmetic sits on the avatar. Cosmetics are owned now; equipping is a later phase. */
export type CosmeticSlot = 'HAT' | 'BACKPACK' | 'ACCESSORY' | 'OUTFIT';

/** An authored item. Content, not a database row. */
export interface ItemDefinition {
  id: ItemId;
  /** Child-facing name. Readable aloud and localizable (CLAUDE.md section 13). */
  displayName: string;
  /** Child-facing one-line description. */
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  /** Collectible set this belongs to, if any. */
  setId?: string;
  /**
   * A collectible that is not shown in the backpack's "still to find" list,
   * so discovering it is a surprise rather than a checklist item a child can
   * feel behind on. Only meaningful for `COLLECTIBLE`.
   */
  hidden?: boolean;
  /** Required for, and only for, `COSMETIC` items. */
  cosmeticSlot?: CosmeticSlot;
}

/**
 * A named group of collectibles. Completing a set is its own small
 * celebration; it never unlocks learning content, and never gates anything
 * a child needs.
 */
export interface CollectibleSet {
  id: string;
  displayName: string;
  /** Child-facing line shown when the set is finished. */
  completionMessage: string;
  itemIds: readonly ItemId[];
  /**
   * An optional cosmetic granted for finishing the set. Deliberately limited
   * to a cosmetic: a set reward must never be something a child needs.
   */
  completionItemId?: ItemId;
}

/**
 * What a child did that earned something. A closed set, so a reward can
 * only ever be attached to an authored, deterministic event — there is no
 * "open a chest" source, because there are no chests to open.
 */
export type RewardTrigger =
  | { type: 'ADVENTURE_COMPLETED'; templateSlug: string }
  // A story slug, e.g. 'dragon-of-ember-mountain'. Named `storySlug` rather
  // than `storyId` because that is what the value actually is: the
  // `ChildStoryProgress.storyId` column stores a `StoryDefinition.slug`.
  | { type: 'STORY_COMPLETED'; storySlug: string }
  | { type: 'QUEST_COMPLETED'; questId: string }
  | { type: 'WORLD_CHANGE'; changeKey: string }
  | { type: 'NPC_RELATIONSHIP'; npcId: string; level: string }
  | { type: 'DISCOVERY'; discoveryKey: string };

/**
 * One authored rule: this trigger grants these items. Flat and total —
 * every rule that matches grants everything it names, with no weighting,
 * no roll, and no "one of the following".
 */
export interface RewardRule {
  id: string;
  trigger: RewardTrigger;
  itemIds: readonly ItemId[];
  /** Child-facing line shown when this rule fires. */
  message: string;
}

/** The island's full reward table. */
export type RewardTable = readonly RewardRule[];

/** The outcome of resolving a trigger: what to grant and what to say. */
export interface RewardGrant {
  ruleId: string;
  itemIds: readonly ItemId[];
  message: string;
}

/**
 * A child's backpack: the set of item IDs owned. Deliberately a set rather
 * than a quantity map — an item is owned or it is not.
 *
 * That rules out duplicate-farming and "you need 47 more" grind by
 * construction. Phase 25's `COLLECT` quest primitive counts distinct items
 * in a set rather than stacks of one item, which is the same thing a child
 * actually experiences ("find all five shells") without the grind.
 */
export type Inventory = readonly ItemId[];
