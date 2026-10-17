import { describe, expect, it } from 'vitest';
import {
  BOUND_STEPS,
  CASTLE_CHOICE_BINDINGS,
  getCastleChoiceBindingsForStep,
  isKnownCastleEntity,
  resolveCastleChoiceBinding,
} from './castleChoiceBindings';
import { ALL_ENTITY_IDS } from './storykeeperCastleRegion';
import { getAdventureTemplate } from '../../adventures/content';
import { getStep } from '../../adventures/engine/types';
import type { AdventureStep } from '../../adventures/engine/types';

/** The option ids a step actually declares, whatever shape its presentation takes. */
function optionIdsOf(step: AdventureStep): string[] {
  const { presentation } = step;
  switch (presentation.kind) {
    case 'choice':
    case 'creative-choice':
    case 'short-response':
      return presentation.options.map((option) => option.id);
    case 'ordering':
      return presentation.items.map((item) => item.id);
    default:
      return [];
  }
}

describe('castleChoiceBindings authoring', () => {
  it('binds no entity twice', () => {
    const ids = CASTLE_CHOICE_BINDINGS.map((binding) => binding.entityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds only entities the region actually places', () => {
    for (const binding of CASTLE_CHOICE_BINDINGS) {
      expect(
        ALL_ENTITY_IDS.includes(binding.entityId),
        `"${binding.entityId}" is bound but never placed by storykeeperCastleRegion.ts`,
      ).toBe(true);
    }
  });

  it('names an adventure template that exists', () => {
    for (const binding of CASTLE_CHOICE_BINDINGS) {
      expect(
        getAdventureTemplate(binding.templateSlug),
        `unknown template "${binding.templateSlug}"`,
      ).toBeDefined();
    }
  });

  /**
   * The authoring check this file exists for: an unresolvable binding is a
   * test failure, never a runtime fallback. If someone renames an option in
   * `theStorykeepersTale.ts`, this fails rather than the castle quietly
   * offering a portrait that advances nothing.
   */
  it('resolves every binding to an option the step really declares', () => {
    for (const binding of CASTLE_CHOICE_BINDINGS) {
      const template = getAdventureTemplate(binding.templateSlug)!;
      const step = getStep(template, binding.stepId);
      expect(
        optionIdsOf(step),
        `"${binding.entityId}" -> "${binding.optionId}" on ${binding.templateSlug}/${binding.stepId}`,
      ).toContain(binding.optionId);
    }
  });

  /**
   * The other direction, which the first check cannot catch: every option of
   * a bound step needs an entity, or the Character Gallery offers two heroes
   * out of three and nothing complains.
   */
  it('binds exactly one entity to every option of every bound step', () => {
    for (const { templateSlug, stepId } of BOUND_STEPS) {
      const template = getAdventureTemplate(templateSlug)!;
      const step = getStep(template, stepId);
      const bound = getCastleChoiceBindingsForStep(templateSlug, stepId).map(
        (binding) => binding.optionId,
      );

      expect(
        [...bound].sort(),
        `${templateSlug}/${stepId} does not bind each option exactly once`,
      ).toEqual([...optionIdsOf(step)].sort());
    }
  });

  it('covers the five steps the storyboard stages as world objects', () => {
    expect(
      BOUND_STEPS.map(({ templateSlug, stepId }) => `${templateSlug}/${stepId}`).sort(),
    ).toEqual([
      'secret-door-chapter-1-three-clues/order-the-clues',
      'secret-door-chapter-2-pattern-lock/order-the-keys',
      'the-storykeepers-tale/choose-hero',
      'the-storykeepers-tale/choose-setting',
      'the-storykeepers-tale/order-the-story',
    ]);
  });

  /**
   * Steps deliberately left on a HUD card. `comprehension-check` tests what
   * Keeper Quill said, and hiding its answer in the room would turn a
   * reading-comprehension check into a spatial search (storyboard, beat 5).
   */
  it('leaves the card-answered steps unbound', () => {
    const boundStepIds = new Set(BOUND_STEPS.map(({ stepId }) => stepId));
    for (const stepId of [
      'comprehension-check',
      'read-the-note',
      'count-the-stars',
      'continue-the-pattern',
      'what-does-ajar-mean',
    ]) {
      expect(boundStepIds.has(stepId), `"${stepId}" should stay a HUD card`).toBe(false);
    }
  });
});

describe('resolveCastleChoiceBinding', () => {
  it('resolves a placed, bound entity to its option id', () => {
    expect(resolveCastleChoiceBinding('gallery-portrait-fox')?.optionId).toBe('hero-fox');
    expect(resolveCastleChoiceBinding('tower-window-cave')?.optionId).toBe('setting-cave');
    expect(resolveCastleChoiceBinding('lock-rod-silver')?.optionId).toBe('short-rod');
  });

  it('returns undefined for a placed entity that is not a choice', () => {
    expect(isKnownCastleEntity('castle-tapestry-stair')).toBe(true);
    expect(resolveCastleChoiceBinding('castle-tapestry-stair')).toBeUndefined();
  });

  it('returns undefined for an entity the region does not place at all', () => {
    expect(isKnownCastleEntity('not-a-real-entity')).toBe(false);
    expect(resolveCastleChoiceBinding('not-a-real-entity')).toBeUndefined();
  });
});

describe('getCastleChoiceBindingsForStep', () => {
  it('returns the three portraits for choose-hero, in authored order', () => {
    expect(
      getCastleChoiceBindingsForStep('the-storykeepers-tale', 'choose-hero').map(
        (binding) => binding.entityId,
      ),
    ).toEqual(['gallery-portrait-puppy', 'gallery-portrait-dragon', 'gallery-portrait-fox']);
  });

  it('returns nothing for a step this region does not stage', () => {
    expect(getCastleChoiceBindingsForStep('the-storykeepers-tale', 'story-reflection')).toEqual([]);
  });
});
