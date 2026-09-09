/**
 * Clockwork Harbor region state (`docs/regions/clockwork.md` section 6,
 * "Phase 0 - Technical Foundation").
 *
 * Two things the roadmap asks for live here, and one thing it does not.
 *
 * **Region progress** (section 6, "Player Region Progress") is the coarse
 * `NOT_STARTED -> MASTERED` ladder, which the roadmap explicitly says to
 * "store separately from learning skill". It is stored separately here in the
 * strongest sense available: it is not stored at all, but derived, so it
 * cannot drift out of step with the facts it summarizes.
 *
 * **Harbor world state** (section 6, "World State") is the flag set that
 * "determines what the Three.js world displays".
 *
 * What is deliberately *not* here is a new persistence model. The roadmap's
 * JSON is written as a document, but this codebase already records durable
 * "this happened" facts as `WorldChange` rows keyed by `changeKey`
 * (`recordWorldChangeOnce`), which every other region on the island uses and
 * which the parent dashboard, quest conditions, and `isLocationUnlocked`
 * already read. Adding a second store would give the harbor its own private
 * history that none of those could see, and would put two sources of truth
 * behind questions like "has this child repaired the lighthouse?".
 *
 * So the harbor's state is a **projection**: authored change keys in, a typed
 * snapshot out, computed by pure functions in `state.ts`. That keeps
 * CLAUDE.md section 13's "keep domain logic independent from React
 * components" and gives the whole thing tests that need no database.
 */

/**
 * Section 6's progress ladder, in increasing order.
 *
 * `DISCOVERED` means the child has stood in the harbor; `IN_PROGRESS` means
 * at least one chapter is behind them; `COMPLETED` means the Heart of the
 * Harbor is running; `MASTERED` adds the optional collection the roadmap
 * hangs its replay value on (section 21's twelve Golden Gears).
 */
export type ClockworkRegionProgress =
  'NOT_STARTED' | 'DISCOVERED' | 'IN_PROGRESS' | 'COMPLETED' | 'MASTERED';

/** The same ladder as an ordered list, so callers can compare two states without hardcoding the order. Mirrors `SKILL_STATUS_ORDER` in the Mastery Engine. */
export const CLOCKWORK_REGION_PROGRESS_ORDER: readonly ClockworkRegionProgress[] = [
  'NOT_STARTED',
  'DISCOVERED',
  'IN_PROGRESS',
  'COMPLETED',
  'MASTERED',
];

/**
 * Section 6's world-state document, as a derived snapshot.
 *
 * Field names are the roadmap's own, so a content designer reading section 6
 * and a developer reading this file are looking at the same vocabulary.
 * `companionCogUnlocked` is added from section 11's completion block, which
 * sets it alongside `marketMysterySolved`.
 */
export interface ClockworkHarborState {
  lighthouseFixed: boolean;
  marketMysterySolved: boolean;
  companionCogUnlocked: boolean;
  drawbridgeFixed: boolean;
  /** Ids from `MECHANICAL_CREATURE_IDS`, in authored order rather than the order they were found. */
  animalsRecovered: readonly string[];
  workshopUnlocked: boolean;
  undergroundUnlocked: boolean;
  heartRestored: boolean;
  /** Ids from `GOLDEN_GEAR_IDS`, in authored order. Section 21: twelve of them. */
  goldenGearsFound: readonly string[];
}

/**
 * The authored `WorldChange.changeKey` vocabulary for the harbor.
 *
 * Screaming case with a region prefix, matching the island's existing keys
 * (`BRIDGE_REPAIRED`, `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE`). The prefix
 * matters: these keys share one flat per-child namespace with every other
 * region, so an unprefixed `LIGHTHOUSE_FIXED` would collide the first time
 * another region grows a lighthouse.
 */
export const CLOCKWORK_CHANGE_KEYS = {
  ARRIVED: 'CLOCKWORK_HARBOR_ARRIVED',
  LIGHTHOUSE_FIXED: 'CLOCKWORK_LIGHTHOUSE_FIXED',
  MARKET_MYSTERY_SOLVED: 'CLOCKWORK_MARKET_MYSTERY_SOLVED',
  DRAWBRIDGE_FIXED: 'CLOCKWORK_DRAWBRIDGE_FIXED',
  WORKSHOP_UNLOCKED: 'CLOCKWORK_WORKSHOP_UNLOCKED',
  UNDERGROUND_UNLOCKED: 'CLOCKWORK_UNDERGROUND_UNLOCKED',
  HEART_RESTORED: 'CLOCKWORK_HEART_RESTORED',
} as const;

/** Section 13's five mechanical creatures, in the order Professor Ticktock lists them. */
export const MECHANICAL_CREATURE_IDS = [
  'clockwork-fox',
  'brass-turtle',
  'gearwing-owl',
  'springtail-rabbit',
  'copper-crab',
] as const;

export type MechanicalCreatureId = (typeof MECHANICAL_CREATURE_IDS)[number];

/** The change key recorded when one mechanical creature comes home. */
export function creatureChangeKey(id: MechanicalCreatureId): string {
  return `CLOCKWORK_CREATURE_${id.toUpperCase().replace(/-/g, '_')}_RECOVERED`;
}

/** Section 21: twelve Golden Gears hidden across the harbor. */
export const GOLDEN_GEAR_COUNT = 12;

export const GOLDEN_GEAR_IDS: readonly string[] = Array.from(
  { length: GOLDEN_GEAR_COUNT },
  (_, index) => `golden-gear-${String(index + 1).padStart(2, '0')}`,
);

/** The change key recorded when one Golden Gear is found. */
export function goldenGearChangeKey(id: string): string {
  return `CLOCKWORK_GOLDEN_GEAR_${id.replace(/-/g, '_').toUpperCase()}_FOUND`;
}
