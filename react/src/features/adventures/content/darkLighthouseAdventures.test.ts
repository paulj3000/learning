import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../curriculum/content/index';
import { resolveAdventureForSkillLevel } from '../../adaptive/selection';
import { getQuestDefinition } from '../../quests/content';
import { allObjectives } from '../../quests/quest';
import { getNextStepId, getStep, validateStepAnswer } from '../engine';
import type { AdventureDefinition, AdventureStep, StepAnswer } from '../engine';
import { DARK_LIGHTHOUSE_ADVENTURES } from './darkLighthouseAdventures';
import { getAdventureTemplatesForLocation, resolveAdventureForAgeBand } from './index';

const SKILL_IDS = new Set(SKILLS.map((skill) => skill.id));

describe('The Dark Lighthouse variants', () => {
  it('tells one story beat, not three stories', () => {
    // Section 2.2: "the overall story remains the same regardless of the
    // player's learning level". Same title, same place, same world change.
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      expect(variant.title).toBe('The Dark Lighthouse');
      expect(variant.locationSlug).toBe('clockwork-harbor');
    }
  });

  it('records the same world change from every variant, so the harbor grows the same way', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      const keys = variant.steps
        .map((step) => step.presentation)
        .filter((presentation) => presentation.kind === 'world-change')
        .map((presentation) => presentation.payload.changeKey);

      expect(keys, variant.slug).toEqual(['CLOCKWORK_LIGHTHOUSE_FIXED']);
    }
  });

  it('gives every variant a distinct skill level in one domain', () => {
    const levels = DARK_LIGHTHOUSE_ADVENTURES.map((variant) => variant.skillLevel);
    expect(new Set(levels).size).toBe(levels.length);
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      expect(variant.skillDomain, variant.slug).toBe('math');
      expect(variant.skillLevel, variant.slug).toBeDefined();
    }
  });

  it('covers all three age bands between them', () => {
    const covered = new Set(DARK_LIGHTHOUSE_ADVENTURES.flatMap((variant) => variant.ageBands));
    expect([...covered].sort()).toEqual(['EXPLORER', 'PATHFINDER', 'SPROUT']);
  });

  it('names only curriculum skills that exist, so evidence is written against something', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        for (const objectiveId of step.objectiveIds) {
          expect(SKILL_IDS.has(objectiveId), `${variant.slug}/${step.id}: ${objectiveId}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('gives every graded step a hint ladder that ends by naming the answer', () => {
    // A stuck child needs an exit, not another nudge.
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        if (step.type !== 'NUMBER_INPUT' && step.type !== 'CHOICE') continue;
        const ladder = step.hintPolicy?.ladder ?? [];
        expect(ladder.length, `${variant.slug}/${step.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('lets a wrong answer retry rather than dropping the child out of the adventure', () => {
    for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
      for (const step of variant.steps) {
        if (step.type !== 'NUMBER_INPUT' && step.type !== 'CHOICE') continue;
        const onIncorrect = step.transitions.find((transition) => transition.when === 'incorrect');
        expect(onIncorrect, `${variant.slug}/${step.id}`).toBeDefined();
      }
    }
  });

  it('gets harder as the level rises, measured in graded steps', () => {
    const gradedSteps = (slug: string) =>
      DARK_LIGHTHOUSE_ADVENTURES.find((v) => v.slug === slug)!.steps.filter(
        (step) => step.type === 'NUMBER_INPUT' || step.type === 'CHOICE',
      ).length;

    expect(gradedSteps('the-dark-lighthouse-counting')).toBe(1);
    expect(gradedSteps('the-dark-lighthouse-two-step')).toBe(2);
  });
});

describe('adaptive selection at the lighthouse', () => {
  const variants = getAdventureTemplatesForLocation('clockwork-harbor');

  it('serves the counting variant to a child with no evidence', () => {
    expect(resolveAdventureForSkillLevel(variants, 1)?.slug).toBe('the-dark-lighthouse-counting');
  });

  it('serves the grouping variant to a level-3 child', () => {
    expect(resolveAdventureForSkillLevel(variants, 3)?.slug).toBe('the-dark-lighthouse-groups');
  });

  it('serves the two-step variant to a level-5 child', () => {
    expect(resolveAdventureForSkillLevel(variants, 5)?.slug).toBe('the-dark-lighthouse-two-step');
  });

  it('still resolves deterministically by age band, without a profile', () => {
    // Three variants now share bands at one location. The age-band resolver has
    // no profile to consult, so it must at least never be an accident of
    // authoring order - it takes the gentlest match.
    expect(resolveAdventureForAgeBand('clockwork-harbor', 'none', 'EXPLORER')?.slug).toBe(
      'the-dark-lighthouse-groups',
    );
    expect(resolveAdventureForAgeBand('clockwork-harbor', 'none', 'SPROUT')?.slug).toBe(
      'the-dark-lighthouse-counting',
    );
  });
});

describe('the light-the-harbor quest', () => {
  const quest = getQuestDefinition('light-the-harbor');

  it('is authored and given by the Harbor Master', () => {
    expect(quest).toBeDefined();
    expect(quest!.giverNpcId).toBe('harbor-master');
  });

  it('completes on the world change every variant records, not on one variant', () => {
    // A child served the counting variant must be able to finish the quest.
    const buildObjectives = allObjectives(quest!).filter((objective) => objective.kind === 'BUILD');
    expect(buildObjectives.map((objective) => objective.changeKey)).toContain(
      'CLOCKWORK_LIGHTHOUSE_FIXED',
    );
  });

  it('lets a child who already lit the lighthouse skip ahead rather than redo it', () => {
    const entry = quest!.stages.find((stage) => stage.id === quest!.entryStageId);
    const skip = entry?.branches?.find((branch) =>
      branch.conditions.some(
        (condition) =>
          condition.type === 'WORLD_CHANGE' && condition.changeKey === 'CLOCKWORK_LIGHTHOUSE_FIXED',
      ),
    );
    expect(skip).toBeDefined();
  });
});

/**
 * Drives a variant through the real Adventure Engine, answering each graded
 * step the way a child who gets it right would.
 *
 * Stronger than the reachability walk every other adventure's test does
 * (`repairTheMoonlightBridge.test.ts`): that one follows the authored
 * `correct` edges directly, while this hands real answers to
 * `validateStepAnswer` and lets `getNextStepId` decide where they lead. So it
 * covers the engine wiring as well as the graph - a step whose presentation
 * kind and transitions disagree fails here and passes there.
 *
 * What it deliberately does *not* prove is that an authored answer is the
 * right answer to its own prompt. It reads `correctValue` and hands it back,
 * so it is self-consistent by construction: a prompt edited from "9 units" to
 * "12 units" without touching `correctValue` sails through. That is what
 * "checks the arithmetic each prompt actually asks for" below is for, and the
 * two tests were confirmed to fail independently.
 */
function playThrough(
  definition: AdventureDefinition,
  answerFor: (step: AdventureStep) => StepAnswer,
): { visited: string[]; worldChangeKeys: string[] } {
  const visited: string[] = [];
  const worldChangeKeys: string[] = [];
  let currentId: string | undefined = definition.entryStepId;

  while (currentId) {
    // A revisit means the correct answer looped, which would strand a child.
    expect(visited, `${definition.slug} revisited ${currentId}`).not.toContain(currentId);
    visited.push(currentId);

    const step: AdventureStep = getStep(definition, currentId);
    if (step.presentation.kind === 'world-change') {
      worldChangeKeys.push(step.presentation.payload.changeKey);
    }
    if (step.type === 'COMPLETE') break;

    const correctness = validateStepAnswer(step, answerFor(step));
    expect(correctness, `${definition.slug}/${step.id}`).not.toBe('incorrect');
    currentId = getNextStepId(step, correctness);
  }

  return { visited, worldChangeKeys };
}

/** The answer a child who has worked it out would give. */
function correctAnswer(step: AdventureStep): StepAnswer {
  switch (step.presentation.kind) {
    case 'number-input':
      return { kind: 'number-input', value: step.presentation.correctValue };
    case 'choice':
      return { kind: 'choice', optionId: step.presentation.correctOptionId };
    case 'narrative':
      return { kind: 'narrative' };
    case 'world-change':
      return { kind: 'world-change' };
    default:
      throw new Error(`No answer authored for presentation "${step.presentation.kind}"`);
  }
}

describe('playing The Dark Lighthouse through the real engine', () => {
  for (const variant of DARK_LIGHTHOUSE_ADVENTURES) {
    describe(variant.slug, () => {
      it('reaches COMPLETE when every answer is right', () => {
        const { visited } = playThrough(variant, correctAnswer);
        expect(getStep(variant, visited[visited.length - 1]).type).toBe('COMPLETE');
      });

      it('records the lighthouse repair on the way, exactly once', () => {
        const { worldChangeKeys } = playThrough(variant, correctAnswer);
        expect(worldChangeKeys).toEqual(['CLOCKWORK_LIGHTHOUSE_FIXED']);
      });

      it('visits every authored step, so none is stranded', () => {
        const { visited } = playThrough(variant, correctAnswer);
        expect(new Set(visited).size).toBe(variant.steps.length);
      });

      it('sends a wrong answer somewhere that is not the end', () => {
        // The child gets another go rather than being pushed past the puzzle.
        for (const step of variant.steps) {
          if (step.presentation.kind === 'number-input') {
            const wrong = validateStepAnswer(step, {
              kind: 'number-input',
              value: step.presentation.correctValue + 1,
            });
            expect(wrong).toBe('incorrect');
            const next = getStep(variant, getNextStepId(step, wrong));
            expect(next.type, `${variant.slug}/${step.id}`).not.toBe('COMPLETE');
            expect(next.type, `${variant.slug}/${step.id}`).not.toBe('WORLD_CHANGE');
          }
          if (step.presentation.kind === 'choice') {
            // Bound to a local so the narrowing survives into the callback.
            const choice = step.presentation;
            const wrongOption = choice.options.find(
              (option) => option.id !== choice.correctOptionId,
            );
            const wrong = validateStepAnswer(step, {
              kind: 'choice',
              optionId: wrongOption!.id,
            });
            expect(wrong).toBe('incorrect');
            const next = getStep(variant, getNextStepId(step, wrong));
            expect(next.type, `${variant.slug}/${step.id}`).not.toBe('COMPLETE');
            expect(next.type, `${variant.slug}/${step.id}`).not.toBe('WORLD_CHANGE');
          }
        }
      });
    });
  }

  it('checks the arithmetic each prompt actually asks for', () => {
    // The prompts are the specification; these are the sums worked by hand.
    // If a prompt's numbers are edited without its `correctValue`, this fails.
    const answerIn = (slug: string, stepId: string) => {
      const step = getStep(
        DARK_LIGHTHOUSE_ADVENTURES.find((v) => v.slug === slug)!,
        stepId,
      );
      if (step.presentation.kind === 'number-input') return step.presentation.correctValue;
      if (step.presentation.kind === 'choice') return step.presentation.correctOptionId;
      throw new Error('not a graded step');
    };

    // Three empty slots, counted.
    expect(answerIn('the-dark-lighthouse-counting', 'count-the-slots')).toBe('three');
    // 9 units needed, 3 per crystal: 3 + 3 + 3.
    expect(answerIn('the-dark-lighthouse-groups', 'how-many-crystals')).toBe(9 / 3);
    // Needs 10, gauge reads 4: the gap is 6.
    expect(answerIn('the-dark-lighthouse-two-step', 'how-much-is-missing')).toBe(10 - 4);
    // Those 6 units at 3 per crystal: 2 crystals.
    expect(answerIn('the-dark-lighthouse-two-step', 'how-many-crystals')).toBe(6 / 3);
  });
});
