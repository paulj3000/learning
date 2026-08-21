/**
 * Exploration and Secrets (docs/ROADMAP.md Phase 26,
 * docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md sections 16 and
 * 17). Owns hidden caves, secret passages, locked doors, and the record of
 * what a child has found.
 *
 * A discovery is a *place or thing that keeps a secret*, not a challenge. It
 * grades nothing, teaches nothing directly, and can never be failed. The
 * roadmap is explicit that "not every interaction should launch a major
 * story" and that "some are purely playful" - so what a discovery does is
 * deliberately narrow: it says something, it may put treasure in the
 * backpack, it may change the island, and it may reveal a quest.
 *
 * Three properties hold across this engine, each asserted by tests rather
 * than left to convention:
 *
 * 1. **A locked secret is never a taunt.** Every gated discovery authors a
 *    `lockedMessage` that describes what the child can see and hints at what
 *    would open it, rather than saying no. A child who cannot open a door
 *    yet still gets something for walking up to it
 *    (docs/UX_AND_ACCESSIBILITY.md, calm engagement).
 * 2. **Nothing here is random.** A discovery's requirements and its rewards
 *    are authored constants, so the same secret always opens the same way
 *    for every child. "Rare-collectible spawning" means an item that only
 *    appears in one out-of-the-way place, never an item that appears with
 *    some probability - the Reward Engine's no-loot-box guarantee
 *    (src/features/rewards/types.ts) extends unchanged into exploration.
 * 3. **Only authored ids are ever stored.** A discovery id and an NPC id are
 *    closed vocabularies, so `ChildWorldState` cannot accumulate anything a
 *    child typed, said, or drew (CLAUDE.md section 13).
 *
 * Everything in this module except `api.ts` is pure and has no backend or
 * Phaser dependency, matching how `src/features/quests/` and
 * `src/features/npc/` are split.
 */

/** Stable authored identifier for a discovery. Never generated at runtime. */
export type DiscoveryId = string;

/**
 * What kind of secret this is. Drawn directly from Phase 26's own
 * deliverable list ("hidden caves, secret passages, locked doors"), plus
 * `HIDDEN_OBJECT` for the roadmap section 17 curiosities that are simply
 * somewhere out of the way rather than behind anything.
 *
 * Purely descriptive: nothing in this engine branches on it. It exists so a
 * content designer can see the shape of the island's secrets at a glance and
 * so telemetry can report them by kind.
 */
export type DiscoveryKind = 'HIDDEN_CAVE' | 'SECRET_PASSAGE' | 'LOCKED_DOOR' | 'HIDDEN_OBJECT';

/**
 * A guard on whether a discovery opens. A closed union for the same reason
 * `QuestCondition` and `NpcCondition` are closed: content stays
 * serializable, reviewable by a designer, and impossible to smuggle logic
 * into.
 */
export type DiscoveryRequirement =
  | { type: 'ALWAYS' }
  | { type: 'WORLD_CHANGE_PRESENT'; changeKey: string }
  | { type: 'ITEM_OWNED'; itemId: string }
  | { type: 'DISCOVERY_PRESENT'; discoveryId: DiscoveryId };

/** A change to the island recorded the first time this discovery opens. */
export interface DiscoveryWorldChange {
  locationSlug: string;
  changeType: string;
  changeKey: string;
}

/** An authored secret, independent of any child. */
export interface DiscoveryDefinition {
  /**
   * Also the `discoveryKey` a quest's `DISCOVER` objective names
   * (src/features/quests/types.ts). One id rather than two, so a designer
   * cannot author a quest against a key no discovery produces -
   * `islandDiscoveries.test.ts` asserts the pairing.
   */
  id: DiscoveryId;
  /** The `IslandLocation.slug` this secret is hidden in. */
  locationSlug: string;
  kind: DiscoveryKind;
  /** Child-facing name, shown once found. Readable aloud (CLAUDE.md section 13). */
  title: string;
  /** Child-facing line shown the moment it opens, and every time after. */
  revealMessage: string;
  /**
   * Child-facing line shown when the child reaches the spot but has not met
   * `requirements` yet. Never "you cannot" - it describes what is there and
   * leaves a thread to pull. Required even for `ALWAYS` discoveries, since
   * requirements can be added to a discovery later and a missing line would
   * then leave a child staring at nothing.
   */
  lockedMessage: string;
  requirements: DiscoveryRequirement[];
  /** Recorded the first time this opens, via the Adventure Engine's own write path. */
  worldChange?: DiscoveryWorldChange;
  /**
   * A quest this discovery starts when it opens - the secret itself is the
   * quest giver. This is how Phase 26 ships a playable optional quest chain
   * without an NPC conversation screen, which does not exist yet.
   */
  startsQuestId?: string;
}

/** Everything the pure discovery functions may see about one child. */
export interface DiscoveryContext {
  /** `WorldChange.changeKey` values recorded for this child. */
  worldChangeKeys: readonly string[];
  /** `ItemDefinition.id` values in the child's backpack (Phase 24). */
  ownedItemIds: readonly string[];
  /** `DiscoveryDefinition.id` values this child has already found. */
  discoveredIds: readonly DiscoveryId[];
}

export const EMPTY_DISCOVERY_CONTEXT: DiscoveryContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveredIds: [],
};

/**
 * A child's stored exploration record: the `ChildWorldState` row, parsed.
 *
 * Both arrays are sets of authored ids. Nothing is ever removed from them by
 * gameplay - a place a child found stays found - and `clearWorldState` is a
 * parent-facing retention action only.
 */
export interface WorldStateSnapshot {
  discoveredIds: readonly DiscoveryId[];
  metCharacterIds: readonly string[];
}

export const EMPTY_WORLD_STATE: WorldStateSnapshot = {
  discoveredIds: [],
  metCharacterIds: [],
};
