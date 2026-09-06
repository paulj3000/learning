/**
 * The map from a Storykeeper Castle world entity to the adventure option id
 * that entity *is* (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` SC-0, and the
 * storyboard's "binding rule").
 *
 * This is the file that keeps the Adventure Engine untouched by the
 * first-person castle. Walking up to a portrait and lighting it must drive
 * the very same `choose-hero` step, with the very same option id, that the
 * card-based route already drives:
 *
 *   ObjectInteracted { entityId: 'gallery-portrait-fox' }
 *     -> resolveCastleChoiceBinding  ->  optionId 'hero-fox'
 *     -> useAdventureSession.selectOption('hero-fox')
 *     -> THE_STORYKEEPERS_TALE step 'choose-hero'          [unchanged]
 *
 * Three rules this file exists to enforce, all asserted in
 * `castleChoiceBindings.test.ts`:
 *
 * 1. **The scene never decides correctness.** A binding produces an option
 *    id and stops. Whether that option is right is the engine's business.
 * 2. **A binding that does not resolve is a test failure, not a runtime
 *    fallback.** Every `optionId` below must exist on the step it names, and
 *    every option of a bound step must have exactly one entity bound to it -
 *    otherwise a room offers two of three heroes and nothing complains. Same
 *    authoring-check spirit as `assets/manifest.test.ts`.
 * 3. **Every entity id is one the region actually places**
 *    (`storykeeperCastleRegion.ts`'s `ALL_ENTITY_IDS`), so a renamed prop
 *    cannot silently orphan a learning step.
 *
 * Only the steps whose *answer is a thing in the room* are bound. The
 * comprehension check, `read-the-note`, `count-the-stars`, the pattern
 * choice, and the "ajar" vocabulary check all stay HUD cards on purpose -
 * see the storyboard's beat 5 for why turning a reading-comprehension check
 * into a spatial search would be the wrong trade.
 *
 * Pure data and pure lookups: no `three` import, no React, unit tested.
 */

import { ALL_ENTITY_IDS } from './storykeeperCastleRegion';

export interface CastleChoiceBinding {
  /** The world entity the child interacts with. Must be in `ALL_ENTITY_IDS`. */
  entityId: string;
  /** The adventure template that owns the step. */
  templateSlug: string;
  /** The step whose option this entity stands for. */
  stepId: string;
  /** The option id that step already declares. Never invented here. */
  optionId: string;
}

export const THE_STORYKEEPERS_TALE_SLUG = 'the-storykeepers-tale';
export const SECRET_DOOR_CHAPTER_1_SLUG = 'secret-door-chapter-1-three-clues';
export const SECRET_DOOR_CHAPTER_2_SLUG = 'secret-door-chapter-2-pattern-lock';

export const CASTLE_CHOICE_BINDINGS: readonly CastleChoiceBinding[] = [
  // Beat 3 - the Character Gallery. A portrait is the hero choice.
  {
    entityId: 'gallery-portrait-puppy',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-hero',
    optionId: 'hero-puppy',
  },
  {
    entityId: 'gallery-portrait-dragon',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-hero',
    optionId: 'hero-dragon',
  },
  {
    entityId: 'gallery-portrait-fox',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-hero',
    optionId: 'hero-fox',
  },

  // Beat 4 - the Setting Tower. Standing at a window is the setting choice.
  {
    entityId: 'tower-window-island',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-setting',
    optionId: 'setting-island',
  },
  {
    entityId: 'tower-window-mountain',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-setting',
    optionId: 'setting-mountain',
  },
  {
    entityId: 'tower-window-cave',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'choose-setting',
    optionId: 'setting-cave',
  },

  // Beat 6 - the binding lectern. Seating a plate submits one position of
  // the ordering; the ORDERING step still grades the order.
  {
    entityId: 'story-plate-problem',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'order-the-story',
    optionId: 'beat-problem',
  },
  {
    entityId: 'story-plate-choice',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'order-the-story',
    optionId: 'beat-choice',
  },
  {
    entityId: 'story-plate-ending',
    templateSlug: THE_STORYKEEPERS_TALE_SLUG,
    stepId: 'order-the-story',
    optionId: 'beat-ending',
  },

  // Beat 9 - the three clues, pinned in the order they were written.
  {
    entityId: 'library-clue-diary',
    templateSlug: SECRET_DOOR_CHAPTER_1_SLUG,
    stepId: 'order-the-clues',
    optionId: 'clue-diary',
  },
  {
    entityId: 'library-clue-map',
    templateSlug: SECRET_DOOR_CHAPTER_1_SLUG,
    stepId: 'order-the-clues',
    optionId: 'clue-map',
  },
  {
    entityId: 'library-clue-note',
    templateSlug: SECRET_DOOR_CHAPTER_1_SLUG,
    stepId: 'order-the-clues',
    optionId: 'clue-note',
  },

  // Beat 10 - the pattern lock's three rods, seated shortest to longest.
  // The material names the model, the length names the option.
  {
    entityId: 'lock-rod-silver',
    templateSlug: SECRET_DOOR_CHAPTER_2_SLUG,
    stepId: 'order-the-keys',
    optionId: 'short-rod',
  },
  {
    entityId: 'lock-rod-iron',
    templateSlug: SECRET_DOOR_CHAPTER_2_SLUG,
    stepId: 'order-the-keys',
    optionId: 'medium-rod',
  },
  {
    entityId: 'lock-rod-brass',
    templateSlug: SECRET_DOOR_CHAPTER_2_SLUG,
    stepId: 'order-the-keys',
    optionId: 'long-rod',
  },
];

/** The distinct (template, step) pairs this region drives from world objects. */
export const BOUND_STEPS: readonly { templateSlug: string; stepId: string }[] = [
  ...new Map(
    CASTLE_CHOICE_BINDINGS.map((binding) => [
      `${binding.templateSlug}:${binding.stepId}`,
      { templateSlug: binding.templateSlug, stepId: binding.stepId },
    ]),
  ).values(),
];

/**
 * The option id this entity stands for, or `undefined` if it is not a
 * choice at all (a tapestry, a costume rack, the hearth). Callers treat
 * `undefined` as "this entity is not a learning choice", never as an error
 * to recover from - an entity that *should* have bound and does not is
 * caught by the test, not at runtime.
 */
export function resolveCastleChoiceBinding(entityId: string): CastleChoiceBinding | undefined {
  return CASTLE_CHOICE_BINDINGS.find((binding) => binding.entityId === entityId);
}

/** Every entity bound to one step, in authored order. */
export function getCastleChoiceBindingsForStep(
  templateSlug: string,
  stepId: string,
): CastleChoiceBinding[] {
  return CASTLE_CHOICE_BINDINGS.filter(
    (binding) => binding.templateSlug === templateSlug && binding.stepId === stepId,
  );
}

/**
 * The entity that stands for one option, the reverse of
 * `resolveCastleChoiceBinding`. SC-4 needs this direction as well as the
 * forward one: a child who chose their hero from the HUD card, or who chose
 * it yesterday and has just walked back in, has an option id recorded
 * against the session and no entity - and the gallery still has to know
 * which portrait to light.
 */
export function resolveCastleChoiceEntity(
  templateSlug: string,
  stepId: string,
  optionId: string | null | undefined,
): string | undefined {
  if (!optionId) return undefined;
  return CASTLE_CHOICE_BINDINGS.find(
    (binding) =>
      binding.templateSlug === templateSlug &&
      binding.stepId === stepId &&
      binding.optionId === optionId,
  )?.entityId;
}

/**
 * The ordering answer a row of seated entities stands for, or `null` when
 * the row is not an answer at all.
 *
 * Two beats in this castle are the same puzzle wearing different clothes:
 * three story plates seated in a lectern (beat 6) and three clues pinned to
 * a wall (beat 9). Both turn *an arrangement of things in a room* into the
 * `{ kind: 'ordering', order }` the HUD list would have submitted, and both
 * must do it identically or one of them grades differently from its own
 * card. So the translation lives here once, beside the bindings it reads.
 *
 * `null` rather than a partial order for the cases that are a caller's
 * mistake rather than a child's: the wrong number of things, the same thing
 * twice, or an entity that is not bound to this step. Each is an authoring
 * error caught by a test, so returning `null` keeps a malformed row from
 * reaching `submitAnswer` and being recorded as a wrong answer against the
 * child.
 *
 * It decides nothing about correctness. A wrong order comes back happily;
 * whether it is wrong is the Adventure Engine's business.
 */
export function seatedEntitiesToOrder(
  templateSlug: string,
  stepId: string,
  seated: readonly string[],
): string[] | null {
  const bound = getCastleChoiceBindingsForStep(templateSlug, stepId);
  if (seated.length !== bound.length) return null;
  if (new Set(seated).size !== seated.length) return null;

  const order: string[] = [];
  for (const entityId of seated) {
    const binding = bound.find((candidate) => candidate.entityId === entityId);
    if (!binding) return null;
    order.push(binding.optionId);
  }
  return order;
}

/** Whether this entity is one the region places at all. Used by the test; exported so SC-2's scene can assert it too. */
export function isKnownCastleEntity(entityId: string): boolean {
  return ALL_ENTITY_IDS.includes(entityId);
}
