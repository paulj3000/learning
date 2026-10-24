import { describe, expect, it } from 'vitest';
import { BUZZ_AND_THE_WAGGLE_DANCE } from '../../adventures/content/buzzAndTheWaggleDance';
import {
  WONDER_WALL_ANSWERED_QUESTION_ID,
  WONDER_WALL_QUESTIONS,
} from '../../adventures/content/wonderWallQuestions';
import { ALL_ENTITY_IDS, WONDER_STONE_SPOTS } from './wonderwildForestRegion';
import {
  BOUND_STEPS,
  BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
  WONDER_WALL_BINDINGS,
  WONDER_WALL_STEP_ID,
  getWonderWallBindingsForStep,
  isBoundEntity,
  resolveWonderWallBinding,
  resolveWonderWallEntity,
} from './wonderWallBindings';

/** The option ids one step of the adventure actually declares. */
function optionIdsFor(stepId: string): string[] {
  const step = BUZZ_AND_THE_WAGGLE_DANCE.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`no step "${stepId}" in ${BUZZ_AND_THE_WAGGLE_DANCE.slug}`);
  const presentation = step.presentation as { kind: string; options?: { id: string }[] };
  return (presentation.options ?? []).map((option) => option.id);
}

describe('wonderWallBindings authoring check', () => {
  it('binds only steps the adventure actually has', () => {
    const stepIds = new Set(BUZZ_AND_THE_WAGGLE_DANCE.steps.map((step) => step.id));
    for (const { templateSlug, stepId } of BOUND_STEPS) {
      expect(templateSlug).toBe(BUZZ_AND_THE_WAGGLE_DANCE.slug);
      expect(stepIds.has(stepId), `no step "${stepId}"`).toBe(true);
    }
  });

  it('resolves every binding to an option id the step already declares', () => {
    // The rule this whole file exists for: an unresolvable binding is a test
    // failure, never a runtime fallback.
    for (const binding of WONDER_WALL_BINDINGS) {
      const options = optionIdsFor(binding.stepId);
      expect(options, `${binding.entityId} -> ${binding.optionId}`).toContain(binding.optionId);
    }
  });

  it('binds exactly one entity to every option of every bound step', () => {
    // Otherwise the clearing offers three of four questions and nothing
    // complains: the child simply never finds the fourth stone.
    for (const { templateSlug, stepId } of BOUND_STEPS) {
      const options = optionIdsFor(stepId);
      const bound = getWonderWallBindingsForStep(templateSlug, stepId);
      expect(bound).toHaveLength(options.length);
      for (const optionId of options) {
        const matches = bound.filter((binding) => binding.optionId === optionId);
        expect(matches, `option "${optionId}" has ${matches.length} entities`).toHaveLength(1);
      }
    }
  });

  it('binds one stone per curated Wonder Wall question', () => {
    expect(WONDER_WALL_BINDINGS).toHaveLength(WONDER_WALL_QUESTIONS.length);
    for (const question of WONDER_WALL_QUESTIONS) {
      const entity = resolveWonderWallEntity(
        BUZZ_AND_THE_WAGGLE_DANCE_SLUG,
        WONDER_WALL_STEP_ID,
        question.id,
      );
      expect(entity, `no stone for "${question.question}"`).toBeDefined();
    }
  });

  it('places every bound entity in the region', () => {
    for (const binding of WONDER_WALL_BINDINGS) {
      expect(ALL_ENTITY_IDS, `${binding.entityId} is not placed`).toContain(binding.entityId);
    }
  });

  it('has unique entity ids and no duplicate option ids', () => {
    const entityIds = WONDER_WALL_BINDINGS.map((binding) => binding.entityId);
    const optionIds = WONDER_WALL_BINDINGS.map((binding) => binding.optionId);
    expect(new Set(entityIds).size).toBe(entityIds.length);
    expect(new Set(optionIds).size).toBe(optionIds.length);
  });

  it('lists the stones in the order the questions are authored', () => {
    // So the arc reads left to right in the same order the HUD card lists
    // them, and a child using both routes never has to map one onto the other.
    expect(WONDER_WALL_BINDINGS.map((binding) => binding.optionId)).toEqual(
      WONDER_WALL_QUESTIONS.map((question) => question.id),
    );
    expect(WONDER_WALL_BINDINGS.map((binding) => binding.entityId)).toEqual(
      WONDER_STONE_SPOTS.map((spot) => spot.entityId),
    );
  });

  it('binds the three questions with no adventure behind them, not just the answered one', () => {
    // They are not dead ends: `wonder-wall-fallback` is authored for exactly
    // this, and a stone that emitted nothing would be a stone that does
    // nothing when a child walks up to it.
    const unanswered = WONDER_WALL_QUESTIONS.filter(
      (question) => question.id !== WONDER_WALL_ANSWERED_QUESTION_ID,
    );
    expect(unanswered.length).toBeGreaterThan(0);
    for (const question of unanswered) {
      expect(
        resolveWonderWallEntity(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, WONDER_WALL_STEP_ID, question.id),
      ).toBeDefined();
    }
    const fallback = BUZZ_AND_THE_WAGGLE_DANCE.steps.find(
      (step) => step.id === 'wonder-wall-fallback',
    );
    expect(fallback, 'the fallback these stones rely on is gone').toBeDefined();
  });

  it('leaves the observation steps unbound, on purpose', () => {
    // Wonderwild's thesis is that the evidence becomes real, not that the
    // answer moves into the room. Binding these would turn reasoning into a
    // spatial search - the trade the castle's beat 5 already refused.
    for (const stepId of [
      'observe-the-dance',
      'count-the-waggles',
      'science-comprehension-check',
    ]) {
      expect(
        getWonderWallBindingsForStep(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, stepId),
        `${stepId} should stay a HUD card`,
      ).toHaveLength(0);
    }
  });
});

describe('resolveWonderWallBinding', () => {
  it('resolves a stone to its question', () => {
    expect(resolveWonderWallBinding('wonder-stone-bee')?.optionId).toBe(
      WONDER_WALL_ANSWERED_QUESTION_ID,
    );
  });

  it('returns undefined for an entity that is not a choice', () => {
    // The frog and the night stones are not learning choices, and asking is
    // not an error to recover from.
    expect(resolveWonderWallBinding('wonderwild-pond-frog')).toBeUndefined();
    expect(resolveWonderWallBinding('night-stone-1')).toBeUndefined();
    expect(resolveWonderWallBinding('not-an-entity')).toBeUndefined();
  });
});

describe('resolveWonderWallEntity', () => {
  it('finds the stone to light for an option already recorded on the session', () => {
    expect(
      resolveWonderWallEntity(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, WONDER_WALL_STEP_ID, 'wonder-bees'),
    ).toBe('wonder-stone-bee');
  });

  it('returns undefined for no answer yet, or for another step', () => {
    expect(
      resolveWonderWallEntity(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, WONDER_WALL_STEP_ID, null),
    ).toBeUndefined();
    expect(
      resolveWonderWallEntity(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, WONDER_WALL_STEP_ID, undefined),
    ).toBeUndefined();
    expect(
      resolveWonderWallEntity(BUZZ_AND_THE_WAGGLE_DANCE_SLUG, 'observe-the-dance', 'wonder-bees'),
    ).toBeUndefined();
  });
});

describe('isBoundEntity', () => {
  it('is true only for a placed entity that is also a choice', () => {
    expect(isBoundEntity('wonder-stone-sun')).toBe(true);
    expect(isBoundEntity('wonderwild-leaf-pile')).toBe(false);
    expect(isBoundEntity('not-an-entity')).toBe(false);
  });
});
