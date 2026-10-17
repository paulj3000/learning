import { describe, expect, it } from 'vitest';
import { BUZZ_AND_THE_WAGGLE_DANCE } from './buzzAndTheWaggleDance';
import { WONDER_WALL_ANSWERED_QUESTION_ID, WONDER_WALL_QUESTIONS } from './wonderWallQuestions';

describe('BUZZ_AND_THE_WAGGLE_DANCE', () => {
  const stepIds = new Set(BUZZ_AND_THE_WAGGLE_DANCE.steps.map((step) => step.id));

  it('has a valid entry step', () => {
    expect(stepIds.has(BUZZ_AND_THE_WAGGLE_DANCE.entryStepId)).toBe(true);
  });

  it('only transitions to step ids that exist', () => {
    for (const step of BUZZ_AND_THE_WAGGLE_DANCE.steps) {
      for (const transition of step.transitions) {
        expect(stepIds.has(transition.nextStepId)).toBe(true);
      }
    }
  });

  it('has exactly one COMPLETE step with no outgoing transitions', () => {
    const completeSteps = BUZZ_AND_THE_WAGGLE_DANCE.steps.filter(
      (step) => step.type === 'COMPLETE',
    );
    expect(completeSteps).toHaveLength(1);
    expect(completeSteps[0]?.transitions).toHaveLength(0);
  });

  it('has exactly one WORLD_CHANGE step that always advances to COMPLETE', () => {
    const worldChangeSteps = BUZZ_AND_THE_WAGGLE_DANCE.steps.filter(
      (step) => step.type === 'WORLD_CHANGE',
    );
    expect(worldChangeSteps).toHaveLength(1);
    const [worldChangeStep] = worldChangeSteps;
    const completeStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find((step) => step.type === 'COMPLETE');
    expect(worldChangeStep?.transitions).toEqual([
      { when: 'always', nextStepId: completeStep?.id },
    ]);
  });

  it('can reach COMPLETE by always following the "correct"/"always" path', () => {
    const visited = new Set<string>();
    let currentId: string | undefined = BUZZ_AND_THE_WAGGLE_DANCE.entryStepId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const step = BUZZ_AND_THE_WAGGLE_DANCE.steps.find((candidate) => candidate.id === currentId);
      if (!step || step.type === 'COMPLETE') break;
      const rule =
        step.transitions.find((transition) => transition.when === 'correct') ??
        step.transitions.find((transition) => transition.when === 'always');
      currentId = rule?.nextStepId;
    }
    const finalStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find((step) => step.id === currentId);
    expect(finalStep?.type).toBe('COMPLETE');
  });

  it('gives every answerable step other than the Wonder Wall a 5-level hint ladder', () => {
    // "wonder-wall" deliberately has no hint ladder: it is a curated
    // question pick that routes to either the adventure or a safe
    // fallback, not a quiz to retry (see the step's doc comment).
    const answerableTypes = new Set(['NUMBER_INPUT', 'CHOICE', 'ORDERING']);
    for (const step of BUZZ_AND_THE_WAGGLE_DANCE.steps) {
      if (answerableTypes.has(step.type) && step.id !== 'wonder-wall') {
        expect(step.hintPolicy?.ladder).toHaveLength(5);
      }
    }
  });

  it('offers every curated Wonder Wall question, with the bee question marked correct', () => {
    const wonderWallStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find(
      (step) => step.id === 'wonder-wall',
    );
    expect(wonderWallStep?.presentation.kind).toBe('choice');
    if (wonderWallStep?.presentation.kind === 'choice') {
      expect(wonderWallStep.presentation.options.map((option) => option.id)).toEqual(
        WONDER_WALL_QUESTIONS.map((entry) => entry.id),
      );
      expect(wonderWallStep.presentation.correctOptionId).toBe(WONDER_WALL_ANSWERED_QUESTION_ID);
    }
  });

  it('routes an out-of-scope Wonder Wall question through a safe fallback, not a dead end', () => {
    const wonderWallStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find(
      (step) => step.id === 'wonder-wall',
    );
    const incorrectTransition = wonderWallStep?.transitions.find(
      (transition) => transition.when === 'incorrect',
    );
    expect(incorrectTransition).toBeDefined();
    const fallbackStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find(
      (step) => step.id === incorrectTransition?.nextStepId,
    );
    expect(fallbackStep?.type).toBe('NARRATIVE');
    expect(fallbackStep?.transitions).toEqual([{ when: 'always', nextStepId: 'shrink-into-hive' }]);
  });

  it('marks exactly one narrative step for AI narration, grounded in its own authored text', () => {
    const aiNarratedSteps = BUZZ_AND_THE_WAGGLE_DANCE.steps.filter(
      (step) => step.presentation.kind === 'narrative' && step.presentation.aiNarrated,
    );
    expect(aiNarratedSteps).toHaveLength(1);
    expect(aiNarratedSteps[0]?.id).toBe('shrink-into-hive');
  });

  it('anchors the comprehension check to the authored fact, not to any AI narration', () => {
    const comprehensionStep = BUZZ_AND_THE_WAGGLE_DANCE.steps.find(
      (step) => step.id === 'science-comprehension-check',
    );
    expect(comprehensionStep?.objectiveIds).toEqual(['science-comprehension']);
    expect(comprehensionStep?.presentation.kind).toBe('choice');
    if (comprehensionStep?.presentation.kind === 'choice') {
      expect(comprehensionStep.presentation.correctOptionId).toBe('opt-tell-flowers');
    }
  });

  it('is scoped to Pathfinders only', () => {
    expect(BUZZ_AND_THE_WAGGLE_DANCE.ageBands).toEqual(['PATHFINDER']);
  });

  it('is registered for wonderwild-forest', () => {
    expect(BUZZ_AND_THE_WAGGLE_DANCE.locationSlug).toBe('wonderwild-forest');
  });
});
