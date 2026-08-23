/**
 * Multiple Islands and Worlds (docs/ROADMAP.md Phase 29,
 * docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md sections 21, 22,
 * and 39).
 *
 * A **world** is a place a child sails to: its own islands, its own
 * locations, its own cast and treasure. It is emphatically *not* its own
 * engine. Every world runs on the same curriculum, mastery, adventure,
 * quest, inventory, discovery, and tutor engines built in Phases 3 through
 * 28; what a world owns is content, and nothing else. That is the whole
 * point of section 39's authoring principle: "the core application should
 * not need substantial changes every time a dragon, dinosaur, princess,
 * robot, scientist, pirate, or magical creature is introduced".
 *
 * Three rules hold across this module, each asserted by tests rather than
 * left to convention:
 *
 * 1. **The child is one child everywhere.** Travelling changes what is on
 *    screen, never who the child is. There is no per-world profile, no
 *    per-world backpack, and no per-world progress, because there is no
 *    per-world identity for them to hang off - a `ChildProfile` and a
 *    `ChildInventory` are child-scoped rows and stay that way. See
 *    `travelPack.ts`.
 * 2. **A world is a package, not a code path.** Everything a world owns is
 *    listed in its `WorldContentPack`, and `validateWorldContentPack`
 *    refuses a pack naming content that does not exist. Adding a world is
 *    adding content plus a manifest.
 * 3. **A locked world is never a taunt.** A route that has not opened yet
 *    authors a `lockedHint` describing what would open it, the same rule
 *    `DiscoveryDefinition.lockedMessage` follows (CLAUDE.md pillar 7).
 */
import type { AgeBandValue } from '../child-profile/constants';

/**
 * What must have happened before a child can sail somewhere.
 *
 * "Any of these keys" rather than "this key" because the same act is
 * authored per age band and records different keys: a Sprout and a
 * Pathfinder repair the harbour bridge (`BRIDGE_REPAIRED`), while an
 * Explorer at the same place sets the tide gate (`TIDE_GATE_SET`). A
 * single-key requirement would have locked Explorers out of travel entirely,
 * which is exactly the age-band gap the post-Phase-27 fix was written to
 * close.
 */
export interface WorldTravelRequirement {
  /** Any one of these `WorldChange.changeKey` values opens the route. */
  anyOfChangeKeys: readonly string[];
  /**
   * Child-facing line shown while the route is closed. Describes what would
   * open it; never reports a refusal, and never names a skill or a score.
   */
  lockedHint: string;
}

/**
 * What happens when a child steps off the boat.
 *
 * `changeKey` is recorded once, through the Adventure Engine's existing
 * `recordWorldChangeOnce`, so arriving somewhere is the same kind of fact as
 * repairing a bridge: it gives a quest a condition to hang on, it puts the
 * world's own location into `visitedLocationSlugs` before any adventure has
 * been played there, and it gives a parent an honest "they sailed to the
 * cove" line. No new model, no new write path.
 */
export interface WorldArrival {
  /** Where the boat lands. Must be one of this world's own locations. */
  locationSlug: string;
  /** One or two lines Chatty can read on arrival. Authored, never generated. */
  text: string;
  changeKey: string;
}

/** An authored world. Content, not a database row. */
export interface WorldDefinition {
  slug: string;
  /** Child-facing name, readable aloud (CLAUDE.md section 13). */
  title: string;
  tagline: string;
  description: string;
  /** The world every child starts in. Exactly one world may set this. */
  isHome?: boolean;
  /**
   * Bands this world is authored for. A world with no adventure a child's
   * band can play is not offered to them at all, rather than being offered
   * and then refusing at the door (CLAUDE.md section 3: "never show content
   * merely because it is available").
   */
  supportedAgeBands: AgeBandValue[];
  /**
   * Where a child lands, what they hear, and what the island remembers about
   * their arrival.
   *
   * Absent on the home world, and deliberately so: a child does not *arrive*
   * where they already live. Welcome Harbor is the home world's hub and has
   * been since Phase 2, so giving home an arrival record would invent a
   * journey that never happened and put a meaningless line on the parent
   * dashboard.
   */
  arrival?: WorldArrival;
  /** Absent on the home world, which is always reachable. */
  travelRequirement?: WorldTravelRequirement;
}

/** One row of the travel deck: a world, and whether it is open yet. */
export interface TravelDestination {
  world: WorldDefinition;
  isUnlocked: boolean;
  /** Present only while locked. The authored hint, never a refusal. */
  lockedHint?: string;
  /** True for the world the child is looking out from. */
  isCurrent: boolean;
}

/**
 * Everything one world owns (section 22's content pack manifest, in the
 * vocabulary this codebase actually uses).
 *
 * Ids rather than inlined content: the authored definitions already live in
 * each engine's own `content/` folder, and duplicating them here would
 * create two sources of truth for the same shell. A manifest says *who owns
 * what*, and `validateWorldContentPack` checks that every id resolves.
 *
 * Every list is exhaustive for its world. `packs.test.ts` asserts the union
 * of all packs covers every authored registry entry exactly once, so content
 * cannot ship belonging to no world, or to two.
 */
export interface WorldContentPack {
  worldSlug: string;
  /** Bumped by a content designer when the pack's content changes shape. */
  version: number;
  locationSlugs: readonly string[];
  adventureSlugs: readonly string[];
  questIds: readonly string[];
  itemIds: readonly string[];
  collectibleSetIds: readonly string[];
  npcIds: readonly string[];
  discoveryIds: readonly string[];
  storySlugs: readonly string[];
}

/** One thing wrong with a pack. Developer-facing; never shown to a child. */
export interface WorldPackIssue {
  worldSlug: string;
  kind:
    | 'UNKNOWN_LOCATION'
    | 'UNKNOWN_ADVENTURE'
    | 'UNKNOWN_QUEST'
    | 'UNKNOWN_ITEM'
    | 'UNKNOWN_SET'
    | 'UNKNOWN_NPC'
    | 'UNKNOWN_DISCOVERY'
    | 'UNKNOWN_STORY'
    | 'LOCATION_IN_WRONG_WORLD'
    | 'ADVENTURE_OUTSIDE_PACK_LOCATIONS';
  id: string;
  detail: string;
}

/** The registries a pack is validated against. Passed in, never imported here. */
export interface WorldContentRegistries {
  locations: readonly { slug: string; worldSlug: string }[];
  adventures: readonly { slug: string; locationSlug: string }[];
  quests: readonly { id: string }[];
  items: readonly { id: string }[];
  collectibleSets: readonly { id: string }[];
  npcs: readonly { id: string }[];
  discoveries: readonly { id: string }[];
  stories: readonly { slug: string }[];
}
