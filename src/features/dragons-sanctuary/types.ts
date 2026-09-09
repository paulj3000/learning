/**
 * Dragon's Sanctuary region state (`docs/regions/dragons-sanctuary-
 * roadmap.md` Phase 0.3, "Region state contract", and Phase 9, "Sanctuary
 * Restoration System").
 *
 * Phase 0.3 proposes six new persistence models (`DragonSanctuaryProgress`,
 * `DragonProgress`, `SanctuaryQuestProgress`, `SanctuaryUnlock`,
 * `DragonEggProgress`, `SanctuaryCollectible`). None is created here, for the
 * reason `docs/regions/dragons-sanctuary-reconciliation.md` section 4.5 sets
 * out and Clockwork Harbor already settled one milestone earlier: this
 * codebase records durable "this happened" facts as `WorldChange` rows keyed
 * by `changeKey`, and the parent dashboard, quest conditions, and
 * `isLocationUnlocked` all read them. A private store would give the
 * sanctuary a history none of those could see.
 *
 * So the sanctuary's state is a **projection**: authored change keys in, a
 * typed snapshot out, computed by pure functions in `state.ts`.
 *
 * Phase 0.3's warning against "one opaque progress blob" is answered by this
 * rather than sidestepped. The keys are individually recorded and
 * individually queryable; what is derived is the *summary*, which is the part
 * that would have gone stale if it were stored.
 */

/**
 * The restoration ladder, Phase 9's stages 0-5.
 *
 * Only stages 0 and 1 are reachable in this phase: Phase 2's forge is the
 * only quest authored, so nothing yet records the dragons returning or the
 * hatchery being restored. The later stages are named here anyway, because a
 * ladder that stops at the last thing built teaches the next author that the
 * ladder is the thing to extend rather than the content.
 */
export type SanctuaryRestorationStage =
  | 'FORGOTTEN'
  | 'EMBER_RETURNS'
  | 'DRAGONS_RETURN'
  | 'HATCHERY_RESTORED'
  | 'SANCTUARY_REBORN'
  | 'DRAGON_KEEPER';

/** The same ladder as an ordered list, so callers compare two stages without hardcoding the order. Mirrors `SKILL_STATUS_ORDER` in the Mastery Engine. */
export const SANCTUARY_RESTORATION_ORDER: readonly SanctuaryRestorationStage[] = [
  'FORGOTTEN',
  'EMBER_RETURNS',
  'DRAGONS_RETURN',
  'HATCHERY_RESTORED',
  'SANCTUARY_REBORN',
  'DRAGON_KEEPER',
];

/**
 * What the Three.js scene needs to know to draw the right sanctuary, as a
 * derived snapshot. Phase 9's own example state, in this codebase's
 * vocabulary.
 */
export interface DragonsSanctuaryState {
  /** Whether "Rekindle the Forge" is finished. Phase 2's persistent result. */
  forgeLit: boolean;
  /** Prop ids from `FIRE_RUNE_IDS`, in authored order rather than the order they were found. */
  runesFound: readonly string[];
  /** Prop ids from `DRAGON_SCALE_IDS`, in authored order. Phase 10's first collectible family. */
  scalesFound: readonly string[];
  crystalCavernUnlocked: boolean;
  hatcheryUnlocked: boolean;
  restorationStage: SanctuaryRestorationStage;
}

/**
 * The authored `WorldChange.changeKey` vocabulary for the sanctuary.
 *
 * Screaming case with a region prefix, matching the island's existing keys
 * (`BRIDGE_REPAIRED`, `CLOCKWORK_LIGHTHOUSE_FIXED`). The prefix matters:
 * these keys share one flat per-child namespace with every other region, so
 * an unprefixed `FORGE_LIT` would collide the first time another region grows
 * a forge.
 *
 * `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` is deliberately *not* in this list. It
 * belongs to the Story Engine, it already gates the location, and re-declaring
 * it here would create a second owner for one fact.
 */
export const SANCTUARY_CHANGE_KEYS = {
  ARRIVED: 'DRAGONS_SANCTUARY_ARRIVED',
  FORGE_LIT: 'DRAGONS_SANCTUARY_FORGE_LIT',
  CRYSTAL_CAVERN_UNLOCKED: 'DRAGONS_SANCTUARY_CRYSTAL_CAVERN_UNLOCKED',
  HATCHERY_UNLOCKED: 'DRAGONS_SANCTUARY_HATCHERY_UNLOCKED',
} as const;

/**
 * The three fire runes, by prop id.
 *
 * These are the region module's own ids rather than a second list: a rune
 * that exists in the world and not in this vocabulary could be picked up and
 * never recorded, and one that exists here and not in the world could be
 * required and never found. Importing keeps that impossible.
 */
export const FIRE_RUNE_IDS = [
  'dragons-sanctuary:prop:rune-stone',
  'dragons-sanctuary:prop:rune-ember',
  'dragons-sanctuary:prop:rune-sky',
] as const;

export type FireRuneId = (typeof FIRE_RUNE_IDS)[number];

/**
 * The change key recorded when one fire rune is found.
 *
 * The prop id's `region:prop:` namespace and its own `rune-` prefix are both
 * dropped, so `dragons-sanctuary:prop:rune-stone` becomes
 * `DRAGONS_SANCTUARY_RUNE_STONE_FOUND` rather than the `RUNE_RUNE_STONE` a
 * naive replace produces.
 */
export function fireRuneChangeKey(id: string): string {
  const name = id
    .split(':')
    .pop()!
    .replace(/^rune-/, '');
  return `DRAGONS_SANCTUARY_RUNE_${name.replace(/-/g, '_').toUpperCase()}_FOUND`;
}

/** Phase 10's dragon scales. Three in this phase; the family grows with the region. */
export const DRAGON_SCALE_IDS = ['dragon-scale-01', 'dragon-scale-02', 'dragon-scale-03'] as const;

/** The change key recorded when one dragon scale is found. */
export function dragonScaleChangeKey(id: string): string {
  return `DRAGONS_SANCTUARY_SCALE_${id.replace(/-/g, '_').toUpperCase()}_FOUND`;
}
