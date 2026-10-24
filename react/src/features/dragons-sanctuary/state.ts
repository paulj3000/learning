import {
  DRAGON_SCALE_IDS,
  dragonScaleChangeKey,
  FIRE_RUNE_IDS,
  fireRuneChangeKey,
  SANCTUARY_CHANGE_KEYS,
  type DragonsSanctuaryState,
  type SanctuaryRestorationStage,
} from './types';

/**
 * Projects a child's `WorldChange` history into the sanctuary's state
 * (`docs/regions/dragons-sanctuary-roadmap.md` Phase 9).
 *
 * Pure and total: change keys in, a full snapshot out, so there is no
 * partially-loaded sanctuary and no `undefined` for a scene to guard against.
 * A child with no history gets every flag `false` and both collections empty,
 * which is exactly the Stage 0 sanctuary Phase 9 describes as "Forgotten".
 */
export function deriveDragonsSanctuaryState(
  worldChangeKeys: readonly string[],
): DragonsSanctuaryState {
  const keys = new Set(worldChangeKeys);
  const forgeLit = keys.has(SANCTUARY_CHANGE_KEYS.FORGE_LIT);

  return {
    forgeLit,
    runesFound: FIRE_RUNE_IDS.filter((id) => keys.has(fireRuneChangeKey(id))),
    scalesFound: DRAGON_SCALE_IDS.filter((id) => keys.has(dragonScaleChangeKey(id))),
    crystalCavernUnlocked: keys.has(SANCTUARY_CHANGE_KEYS.CRYSTAL_CAVERN_UNLOCKED),
    hatcheryUnlocked: keys.has(SANCTUARY_CHANGE_KEYS.HATCHERY_UNLOCKED),
    restorationStage: deriveRestorationStage(worldChangeKeys),
  };
}

/**
 * Phase 9's restoration stage, derived from the same history.
 *
 * Only the first two rungs are reachable in this phase, and that is stated in
 * code rather than left implicit: nothing yet records the dragons returning,
 * so `DRAGONS_RETURN` and above are unreachable until Phase 4 authors the
 * quests that would earn them. Returning a stage the sanctuary cannot render
 * would be worse than stopping honestly at the one it can.
 *
 * Note that this ladder never moves backward - it reads history, and history
 * only grows. A child cannot un-light the forge, and the sanctuary they
 * changed stays changed (ADR-005).
 */
export function deriveRestorationStage(
  worldChangeKeys: readonly string[],
): SanctuaryRestorationStage {
  const keys = new Set(worldChangeKeys);
  if (keys.has(SANCTUARY_CHANGE_KEYS.HATCHERY_UNLOCKED)) return 'HATCHERY_RESTORED';
  if (keys.has(SANCTUARY_CHANGE_KEYS.CRYSTAL_CAVERN_UNLOCKED)) return 'DRAGONS_RETURN';
  if (keys.has(SANCTUARY_CHANGE_KEYS.FORGE_LIT)) return 'EMBER_RETURNS';
  return 'FORGOTTEN';
}

/**
 * Whether every fire rune has been found, which is what lets a child light
 * the hearth.
 *
 * A gate on the *quest*, not on correctness: the Adventure Engine still
 * grades the challenge at the hearth. This only answers "has the child
 * gathered what the quest asked for", which is a question about their
 * history and belongs here rather than in a component.
 */
export function hasAllFireRunes(worldChangeKeys: readonly string[]): boolean {
  const keys = new Set(worldChangeKeys);
  return FIRE_RUNE_IDS.every((id) => keys.has(fireRuneChangeKey(id)));
}
