import { describe, expect, it } from 'vitest';
import { THE_STORYKEEPERS_TALE } from './theStorykeepersTale';

describe('THE_STORYKEEPERS_TALE', () => {
  const stepIds = new Set(THE_STORYKEEPERS_TALE.steps.map((step) => step.id));

  it('has a valid entry step', () => {
    expect(stepIds.has(THE_STORYKEEPERS_TALE.entryStepId)).toBe(true);
  });

  it('only transitions to step ids that exist', () => {
    for (const step of THE_STORYKEEPERS_TALE.steps) {
      for (const transition of step.transitions) {
        expect(stepIds.has(transition.nextStepId)).toBe(true);
      }
    }
  });

  it('has exactly one COMPLETE step with no outgoing transitions', () => {
    const completeSteps = THE_STORYKEEPERS_TALE.steps.filter((step) => step.type === 'COMPLETE');
    expect(completeSteps).toHaveLength(1);
    expect(completeSteps[0]?.transitions).toHaveLength(0);
  });

  it('has exactly one WORLD_CHANGE step that always advances to COMPLETE', () => {
    const worldChangeSteps = THE_STORYKEEPERS_TALE.steps.filter(
      (step) => step.type === 'WORLD_CHANGE',
    );
    expect(worldChangeSteps).toHaveLength(1);
    const [worldChangeStep] = worldChangeSteps;
    const completeStep = THE_STORYKEEPERS_TALE.steps.find((step) => step.type === 'COMPLETE');
    expect(worldChangeStep?.transitions).toEqual([
      { when: 'always', nextStepId: completeStep?.id },
    ]);
  });

  it('can reach COMPLETE by always following the "correct"/"always" path', () => {
    const visited = new Set<string>();
    let currentId: string | undefined = THE_STORYKEEPERS_TALE.entryStepId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const step = THE_STORYKEEPERS_TALE.steps.find((candidate) => candidate.id === currentId);
      if (!step || step.type === 'COMPLETE') break;
      const rule =
        step.transitions.find((transition) => transition.when === 'correct') ??
        step.transitions.find((transition) => transition.when === 'always');
      currentId = rule?.nextStepId;
    }
    const finalStep = THE_STORYKEEPERS_TALE.steps.find((step) => step.id === currentId);
    expect(finalStep?.type).toBe('COMPLETE');
  });

  it('gives every answerable step a 5-level hint ladder', () => {
    const answerableTypes = new Set(['NUMBER_INPUT', 'CHOICE', 'ORDERING']);
    for (const step of THE_STORYKEEPERS_TALE.steps) {
      if (answerableTypes.has(step.type)) {
        expect(step.hintPolicy?.ladder).toHaveLength(5);
      }
    }
  });

  it('gives creative-choice steps curated options with no free text', () => {
    const creativeChoiceSteps = THE_STORYKEEPERS_TALE.steps.filter(
      (step) => step.type === 'CREATIVE_CHOICE',
    );
    expect(creativeChoiceSteps.length).toBeGreaterThan(0);
    for (const step of creativeChoiceSteps) {
      expect(step.presentation.kind).toBe('creative-choice');
      if (step.presentation.kind === 'creative-choice') {
        expect(step.presentation.options.length).toBeGreaterThan(1);
      }
    }
  });

  it('anchors the comprehension check to the authored narrative, not a creative choice', () => {
    const comprehensionStep = THE_STORYKEEPERS_TALE.steps.find(
      (step) => step.id === 'comprehension-check',
    );
    expect(comprehensionStep?.objectiveIds).toEqual(['reading-comprehension']);
    expect(comprehensionStep?.presentation.kind).toBe('choice');
    if (comprehensionStep?.presentation.kind === 'choice') {
      expect(comprehensionStep.presentation.correctOptionId).toBe('opt-three-things');
    }
  });

  it('is scoped to Pathfinders only', () => {
    expect(THE_STORYKEEPERS_TALE.ageBands).toEqual(['PATHFINDER']);
  });

  it('is registered for storykeeper-castle', () => {
    expect(THE_STORYKEEPERS_TALE.locationSlug).toBe('storykeeper-castle');
  });
});
