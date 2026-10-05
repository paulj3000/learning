/**
 * The declarative binding layer between a thing standing in a 3D room and a
 * step of an existing Adventure (`docs/engine/04_ADVENTURE_AND_STORY_INTEGRATION.md`'s
 * `AdventureBinding`, `docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 8,
 * ADR-025 part H).
 *
 * Two regions already author exactly this relationship, in two near-identical
 * modules the duplication audit flagged: `castleChoiceBindings.ts` (a
 * portrait *is* the `choose-hero` option `hero-fox`) and
 * `wonderWallBindings.ts` (a carved stone *is* the `wonder-wall` option
 * `wonder-bees`). The tables are authored content; the lookups over them
 * were copied. This module owns the lookups once, and
 * `ThreeLocationManifest.adventureBindings` is where the tables themselves
 * move as each region migrates (Phase 9), with no change in meaning.
 *
 * Three rules this layer keeps, which is why it is data rather than code:
 *
 * 1. **The world never decides correctness.** A binding resolves to an
 *    option id the step already declares and stops. Whether that option is
 *    right, what it unlocks, and what comes next stay with the Adventure
 *    Engine (`src/features/adventures/engine/`). Nothing here transitions,
 *    grades, hints or scores.
 * 2. **An unresolvable binding is an authoring failure, not a runtime
 *    fallback.** `findAdventureBindingIssues` is the check, run against the
 *    real adventure content, so a renamed option or a room that offers three
 *    of four choices fails a test rather than quietly losing a child's
 *    fourth choice.
 * 3. **A binding is always qualified by its adventure.** The same portrait
 *    stands for `hero-fox` in the Pathfinder tale and `picture-fox` in the
 *    Sprouts one, so an unqualified lookup would submit an option id the
 *    open step has never heard of.
 *
 * Plain JSON and pure functions: no `three`, no React, no engine imports, so
 * a binding survives the trip through an Admin draft and a published
 * snapshot unchanged.
 */

/** One thing in the world standing for one option of one adventure step. */
export interface AdventureStepBinding {
  /** The world entity the child interacts with. Must be one the region places. */
  entityId: string;
  /** The adventure template that owns the step (`AdventureDefinition.slug`). */
  templateSlug: string;
  /** The step whose option this entity stands for (`AdventureStep.id`). */
  stepId: string;
  /** The option id that step already declares. Never invented by a binding. */
  optionId: string;
}

/** A (template, step) pair some entity in the region answers. */
export interface BoundStep {
  templateSlug: string;
  stepId: string;
}

/**
 * The shape of an `AdventureStep` this module needs, declared structurally
 * so the checker takes registries as input the way `validateLocationManifest`
 * does: a test hands in a two-line fixture, and a future Admin publish step
 * hands in the published catalog. A real `AdventureStep` satisfies it.
 */
export interface BindableStep {
  id: string;
  presentation: {
    kind: string;
    options?: readonly { id: string }[];
    items?: readonly { id: string }[];
  };
}

export interface BindableAdventure {
  slug: string;
  /** Absent means "this registry carries no steps for it", so any binding to it fails. */
  steps?: readonly BindableStep[];
}

/**
 * The option ids a step declares, whatever shape its presentation takes:
 * CHOICE, CREATIVE_CHOICE and SHORT_RESPONSE carry `options`, ORDERING
 * carries `items`, and a NARRATIVE step carries neither.
 */
export function stepOptionIds(step: BindableStep): readonly string[] {
  const { presentation } = step;
  const declared = presentation.options ?? presentation.items ?? [];
  return declared.map((option) => option.id);
}

/**
 * The binding this entity has, or `undefined` when it is not a learning
 * choice at all (a tapestry, the frog, a night stone). Callers treat
 * `undefined` as "this is not a choice", never as an error to recover from:
 * an entity that *should* bind and does not is caught by the authoring
 * check, not at runtime.
 *
 * **Pass `templateSlug` whenever the caller knows which adventure is being
 * played**, which is every caller about to answer a step (rule 3 above).
 */
export function resolveEntityBinding(
  bindings: readonly AdventureStepBinding[],
  entityId: string,
  templateSlug?: string,
): AdventureStepBinding | undefined {
  return bindings.find(
    (binding) =>
      binding.entityId === entityId &&
      (templateSlug === undefined || binding.templateSlug === templateSlug),
  );
}

/** Every entity bound to one step, in authored order. */
export function bindingsForStep(
  bindings: readonly AdventureStepBinding[],
  templateSlug: string,
  stepId: string,
): AdventureStepBinding[] {
  return bindings.filter(
    (binding) => binding.templateSlug === templateSlug && binding.stepId === stepId,
  );
}

/**
 * The entity standing for one option, the reverse direction.
 *
 * Needed as often as the forward one: a child who chose their hero from the
 * HUD card, or chose it yesterday and has just walked back in, has an option
 * id recorded against the session and no entity, and the room still has to
 * know which portrait to light.
 */
export function entityForOption(
  bindings: readonly AdventureStepBinding[],
  templateSlug: string,
  stepId: string,
  optionId: string | null | undefined,
): string | undefined {
  if (!optionId) return undefined;
  return bindings.find(
    (binding) =>
      binding.templateSlug === templateSlug &&
      binding.stepId === stepId &&
      binding.optionId === optionId,
  )?.entityId;
}

/** The distinct (template, step) pairs these bindings drive, in authored order. */
export function boundSteps(bindings: readonly AdventureStepBinding[]): BoundStep[] {
  return [
    ...new Map(
      bindings.map((binding) => [
        `${binding.templateSlug}:${binding.stepId}`,
        { templateSlug: binding.templateSlug, stepId: binding.stepId },
      ]),
    ).values(),
  ];
}

/**
 * The ordering answer a row of seated entities stands for, or `null` when
 * the row is not an answer at all.
 *
 * Several beats across the island are the same puzzle wearing different
 * clothes: story plates seated in a lectern, clues pinned to a wall, rods
 * dropped into a lock. Each turns *an arrangement of things in a room* into
 * the `{ kind: 'ordering', order }` the HUD list would have submitted, and
 * they must do it identically or one grades differently from its own card.
 *
 * `null` rather than a partial order for the cases that are a caller's
 * mistake rather than a child's: the wrong number of things, the same thing
 * twice, or an entity not bound to this step. Each is an authoring error
 * caught by a test, so `null` keeps a malformed row from reaching
 * `submitAnswer` and being recorded as a wrong answer against the child.
 *
 * It decides nothing about correctness. A wrong order comes back happily;
 * whether it is wrong is the Adventure Engine's business.
 */
export function seatedEntitiesToOrder(
  bindings: readonly AdventureStepBinding[],
  templateSlug: string,
  stepId: string,
  seated: readonly string[],
): string[] | null {
  const bound = bindingsForStep(bindings, templateSlug, stepId);
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

export type AdventureBindingIssueKind =
  | 'UNKNOWN_ADVENTURE'
  | 'UNKNOWN_ADVENTURE_STEP'
  | 'UNKNOWN_STEP_OPTION'
  | 'UNBOUND_STEP_OPTION'
  | 'DUPLICATE_BINDING'
  | 'UNPLACED_ENTITY';

/** One thing wrong with a set of bindings. Author-facing; never shown to a child. */
export interface AdventureBindingIssue {
  kind: AdventureBindingIssueKind;
  /** A dotted path into whatever carries the bindings, e.g. `adventureBindings[2]`. */
  path: string;
  detail: string;
}

export interface AdventureBindingRegistries {
  adventures: readonly BindableAdventure[];
  /**
   * Entity ids the region actually places. Omitted skips that check, for a
   * caller that has no placement list to check against.
   */
  placedEntityIds?: readonly string[];
}

/**
 * Every authoring error in a set of bindings, as a list rather than a throw,
 * so an author sees all of them at once. An empty array means publishable.
 *
 * The checks are the ones the castle's and the forest's own tests each wrote
 * separately, kept here once:
 *
 * - the adventure, the step and the option all exist;
 * - every option of a bound step has exactly one entity, so a room cannot
 *   offer three of four choices and have nothing complain;
 * - within one adventure an entity means exactly one thing (across
 *   adventures it may mean one thing each, which is how one set of rooms
 *   serves two age bands);
 * - every bound entity is one the region places.
 */
export function findAdventureBindingIssues(
  bindings: readonly AdventureStepBinding[],
  registries: AdventureBindingRegistries,
  basePath = 'adventureBindings',
): AdventureBindingIssue[] {
  const issues: AdventureBindingIssue[] = [];
  const report = (kind: AdventureBindingIssueKind, path: string, detail: string) => {
    issues.push({ kind, path, detail });
  };
  const adventureBySlug = new Map(
    registries.adventures.map((adventure) => [adventure.slug, adventure]),
  );
  const seen = new Set<string>();

  bindings.forEach((binding, index) => {
    const path = `${basePath}[${index}]`;
    const key = `${binding.templateSlug}:${binding.entityId}`;
    if (seen.has(key)) {
      report(
        'DUPLICATE_BINDING',
        path,
        `"${binding.entityId}" already answers a step of "${binding.templateSlug}"`,
      );
    }
    seen.add(key);

    if (
      registries.placedEntityIds !== undefined &&
      !registries.placedEntityIds.includes(binding.entityId)
    ) {
      report('UNPLACED_ENTITY', `${path}.entityId`, `"${binding.entityId}" is not placed here`);
    }

    const adventure = adventureBySlug.get(binding.templateSlug);
    if (!adventure) {
      report('UNKNOWN_ADVENTURE', `${path}.templateSlug`, `no adventure "${binding.templateSlug}"`);
      return;
    }
    const step = adventure.steps?.find((candidate) => candidate.id === binding.stepId);
    if (!step) {
      report(
        'UNKNOWN_ADVENTURE_STEP',
        `${path}.stepId`,
        `"${adventure.slug}" has no step "${binding.stepId}"`,
      );
      return;
    }
    if (!stepOptionIds(step).includes(binding.optionId)) {
      report(
        'UNKNOWN_STEP_OPTION',
        `${path}.optionId`,
        `step "${step.id}" declares no option "${binding.optionId}"`,
      );
    }
  });

  // Every option of a bound step needs exactly one entity standing for it.
  for (const { templateSlug, stepId } of boundSteps(bindings)) {
    const step = adventureBySlug
      .get(templateSlug)
      ?.steps?.find((candidate) => candidate.id === stepId);
    if (!step) continue; // Already reported above.
    const bound = bindingsForStep(bindings, templateSlug, stepId);
    for (const optionId of stepOptionIds(step)) {
      const matches = bound.filter((binding) => binding.optionId === optionId);
      if (matches.length !== 1) {
        report(
          'UNBOUND_STEP_OPTION',
          basePath,
          `option "${optionId}" of "${templateSlug}" step "${stepId}" has ${matches.length} entities, expected 1`,
        );
      }
    }
  }

  return issues;
}
