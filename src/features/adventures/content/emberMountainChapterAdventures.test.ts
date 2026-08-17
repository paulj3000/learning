import { describe, expect, it } from 'vitest';
import { EMBER_MOUNTAIN_CHAPTER_ADVENTURES } from './emberMountainChapterAdventures';

describe.each(EMBER_MOUNTAIN_CHAPTER_ADVENTURES)('$title ($slug)', (definition) => {
  const stepIds = new Set(definition.steps.map((step) => step.id));

  it('has a valid entry step', () => {
    expect(stepIds.has(definition.entryStepId)).toBe(true);
  });

  it('only transitions to step ids that exist', () => {
    for (const step of definition.steps) {
      for (const transition of step.transitions) {
        expect(stepIds.has(transition.nextStepId)).toBe(true);
      }
    }
  });

  it('has exactly one COMPLETE step with no outgoing transitions', () => {
    const completeSteps = definition.steps.filter((step) => step.type === 'COMPLETE');
    expect(completeSteps).toHaveLength(1);
    expect(completeSteps[0]?.transitions).toHaveLength(0);
  });

  it('every WORLD_CHANGE step always advances somewhere', () => {
    for (const step of definition.steps) {
      if (step.type === 'WORLD_CHANGE') {
        expect(step.transitions).toEqual([{ when: 'always', nextStepId: expect.any(String) }]);
      }
    }
  });

  it('can reach COMPLETE by always following the "correct"/"always" path', () => {
    const visited = new Set<string>();
    let currentId: string | undefined = definition.entryStepId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const step = definition.steps.find((candidate) => candidate.id === currentId);
      if (!step || step.type === 'COMPLETE') break;
      const rule =
        step.transitions.find((transition) => transition.when === 'correct') ??
        step.transitions.find((transition) => transition.when === 'always');
      currentId = rule?.nextStepId;
    }
    const finalStep = definition.steps.find((step) => step.id === currentId);
    expect(finalStep?.type).toBe('COMPLETE');
  });

  it('gives every answerable step a 5-level hint ladder', () => {
    const answerableTypes = new Set(['NUMBER_INPUT', 'CHOICE', 'ORDERING']);
    for (const step of definition.steps) {
      if (answerableTypes.has(step.type)) {
        expect(step.hintPolicy?.ladder).toHaveLength(5);
      }
    }
  });

  it('is scoped to Pathfinders only, and to the story-only ember-mountain location', () => {
    expect(definition.ageBands).toEqual(['PATHFINDER']);
    expect(definition.locationSlug).toBe('ember-mountain');
  });
});

describe('EMBER_MOUNTAIN_CHAPTER_ADVENTURES', () => {
  it('has four distinct chapter adventures', () => {
    const slugs = EMBER_MOUNTAIN_CHAPTER_ADVENTURES.map((definition) => definition.slug);
    expect(new Set(slugs).size).toBe(4);
  });
});
