/**
 * The map from a Wonderwild Forest world entity to the adventure option id
 * that entity *is* (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-0, and the
 * storyboard's "binding rule").
 *
 * This is the file that keeps the Adventure Engine untouched by the
 * first-person forest. Walking to a carved stone, or looking at it and
 * pressing E, must drive the very same `wonder-wall` step, with the very same
 * option id, that the card-based route already drives:
 *
 *   ObjectInteracted { entityId: 'wonder-stone-bee' }
 *     -> resolveWonderWallBinding  ->  optionId 'wonder-bees'
 *     -> useAdventureSession.submitAnswer('wonder-bees')
 *     -> BUZZ_AND_THE_WAGGLE_DANCE step 'wonder-wall'      [unchanged]
 *
 * **Only one step is bound, and that is the design rather than a shortcut.**
 * The castle's thesis was that choices become places, and it binds five
 * steps. Wonderwild's steps are mostly not choices - they are observations.
 * `count-the-waggles` asks a child to count something, and
 * `observe-the-dance` and `science-comprehension-check` ask them to reason
 * from what they saw. Binding those to things in the room would convert
 * reasoning into a spatial search, which is the trade the castle's beat 5
 * already refused. The forest's job is to make the evidence real and leave
 * the questions where they are, so the room's contribution to those three
 * steps is a dance that actually happens, not an answer hidden in the comb.
 *
 * `wonder-wall` is bound because it is genuinely a choice, and because the
 * forest currently asks it in the wrong place: walking into the hive's zone
 * starts the adventure, whose first step then asks which of four things the
 * child is curious about, three of which redirect straight back to the bees
 * they are already standing in front of.
 *
 * Three rules this file exists to enforce, all asserted in
 * `wonderWallBindings.test.ts`:
 *
 * 1. **The scene never decides correctness.** A binding produces an option id
 *    and stops. Whether that option is the one with an adventure behind it is
 *    the engine's business, and the three that are not get the authored
 *    `wonder-wall-fallback` rather than a dead end.
 * 2. **A binding that does not resolve is a test failure, not a runtime
 *    fallback.** Every `optionId` below must exist on the step it names, and
 *    every option of that step must have exactly one entity bound to it -
 *    otherwise the clearing offers three of four questions and nothing
 *    complains. Same authoring-check spirit as `assets/manifest.test.ts`.
 * 3. **Every entity id is one the region actually places**
 *    (`wonderwildForestRegion.ts`'s `ALL_ENTITY_IDS`), so a renamed stone
 *    cannot silently orphan a learning step.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

import { ALL_ENTITY_IDS } from './wonderwildForestRegion';

export interface WonderWallBinding {
  /** The world entity the child interacts with. Must be in `ALL_ENTITY_IDS`. */
  entityId: string;
  /** The adventure template that owns the step. */
  templateSlug: string;
  /** The step whose option this entity stands for. */
  stepId: string;
  /** The option id that step already declares. Never invented here. */
  optionId: string;
}

export const BUZZ_AND_THE_WAGGLE_DANCE_SLUG = 'buzz-and-the-waggle-dance';
export const WONDER_WALL_STEP_ID = 'wonder-wall';

/**
 * Beat 2 - the Wonder Wall. A carved stone is a curated question.
 *
 * The order here is the order `wonderWallQuestions.ts` declares, which is
 * also the order `WONDER_STONE_SPOTS` places the stones left to right, so a
 * child who uses the HUD card and a child who walks the arc are never asked
 * to map one onto the other.
 */
export const WONDER_WALL_BINDINGS: readonly WonderWallBinding[] = [
  {
    entityId: 'wonder-stone-bee',
    templateSlug: BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
    stepId: WONDER_WALL_STEP_ID,
    optionId: 'wonder-bees',
  },
  {
    entityId: 'wonder-stone-seed',
    templateSlug: BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
    stepId: WONDER_WALL_STEP_ID,
    optionId: 'wonder-seeds',
  },
  {
    entityId: 'wonder-stone-sun',
    templateSlug: BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
    stepId: WONDER_WALL_STEP_ID,
    optionId: 'wonder-sky',
  },
  {
    entityId: 'wonder-stone-chrysalis',
    templateSlug: BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
    stepId: WONDER_WALL_STEP_ID,
    optionId: 'wonder-butterfly',
  },
];

/** The distinct (template, step) pairs this region drives from world objects. */
export const BOUND_STEPS: readonly { templateSlug: string; stepId: string }[] = [
  ...new Map(
    WONDER_WALL_BINDINGS.map((binding) => [
      `${binding.templateSlug}:${binding.stepId}`,
      { templateSlug: binding.templateSlug, stepId: binding.stepId },
    ]),
  ).values(),
];

/**
 * The option id this entity stands for, or `undefined` if it is not a choice
 * at all (the frog, a night stone, the leaf pile). Callers treat `undefined`
 * as "this entity is not a learning choice", never as an error to recover
 * from - an entity that *should* have bound and does not is caught by the
 * test, not at runtime.
 */
export function resolveWonderWallBinding(entityId: string): WonderWallBinding | undefined {
  return WONDER_WALL_BINDINGS.find((binding) => binding.entityId === entityId);
}

/** Every entity bound to one step, in authored order. */
export function getWonderWallBindingsForStep(
  templateSlug: string,
  stepId: string,
): WonderWallBinding[] {
  return WONDER_WALL_BINDINGS.filter(
    (binding) => binding.templateSlug === templateSlug && binding.stepId === stepId,
  );
}

/**
 * The entity that stands for one option, the reverse of
 * `resolveWonderWallBinding`. WF-6 needs this direction as well as the
 * forward one: a child who chose their question from the HUD card, or who
 * told the tale yesterday and has just walked back in, has an option id
 * recorded against the session and no entity - and the clearing still has to
 * know which stone to light.
 */
export function resolveWonderWallEntity(
  templateSlug: string,
  stepId: string,
  optionId: string | null | undefined,
): string | undefined {
  if (!optionId) return undefined;
  return WONDER_WALL_BINDINGS.find(
    (binding) =>
      binding.templateSlug === templateSlug &&
      binding.stepId === stepId &&
      binding.optionId === optionId,
  )?.entityId;
}

/** Whether this entity is one of the region's bound learning choices at all. */
export function isBoundEntity(entityId: string): boolean {
  return ALL_ENTITY_IDS.includes(entityId) && resolveWonderWallBinding(entityId) !== undefined;
}
