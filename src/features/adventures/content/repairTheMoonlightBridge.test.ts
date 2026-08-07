import { describe, expect, it } from 'vitest';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './repairTheMoonlightBridge';

describe('REPAIR_THE_MOONLIGHT_BRIDGE', () => {
  const stepIds = new Set(REPAIR_THE_MOONLIGHT_BRIDGE.steps.map((step) => step.id));

  it('has a valid entry step', () => {
    expect(stepIds.has(REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId)).toBe(true);
  });

  it('only transitions to step ids that exist', () => {
    for (const step of REPAIR_THE_MOONLIGHT_BRIDGE.steps) {
      for (const transition of step.transitions) {
        expect(stepIds.has(transition.nextStepId)).toBe(true);
      }
    }
  });

  it('has exactly one COMPLETE step with no outgoing transitions', () => {
    const completeSteps = REPAIR_THE_MOONLIGHT_BRIDGE.steps.filter(
      (step) => step.type === 'COMPLETE',
    );
    expect(completeSteps).toHaveLength(1);
    expect(completeSteps[0]?.transitions).toHaveLength(0);
  });

  it('has exactly one WORLD_CHANGE step that always advances to COMPLETE', () => {
    const worldChangeSteps = REPAIR_THE_MOONLIGHT_BRIDGE.steps.filter(
      (step) => step.type === 'WORLD_CHANGE',
    );
    expect(worldChangeSteps).toHaveLength(1);
    const [worldChangeStep] = worldChangeSteps;
    const completeStep = REPAIR_THE_MOONLIGHT_BRIDGE.steps.find((step) => step.type === 'COMPLETE');
    expect(worldChangeStep?.transitions).toEqual([
      { when: 'always', nextStepId: completeStep?.id },
    ]);
  });

  it('can reach COMPLETE by always following the "correct"/"always" path', () => {
    const visited = new Set<string>();
    let currentId: string | undefined = REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const step = REPAIR_THE_MOONLIGHT_BRIDGE.steps.find(
        (candidate) => candidate.id === currentId,
      );
      if (!step || step.type === 'COMPLETE') break;
      const rule =
        step.transitions.find((transition) => transition.when === 'correct') ??
        step.transitions.find((transition) => transition.when === 'always');
      currentId = rule?.nextStepId;
    }
    const finalStep = REPAIR_THE_MOONLIGHT_BRIDGE.steps.find((step) => step.id === currentId);
    expect(finalStep?.type).toBe('COMPLETE');
  });

  it('gives every answerable step a 5-level hint ladder', () => {
    const answerableTypes = new Set(['NUMBER_INPUT', 'CHOICE', 'ORDERING']);
    for (const step of REPAIR_THE_MOONLIGHT_BRIDGE.steps) {
      if (answerableTypes.has(step.type)) {
        expect(step.hintPolicy?.ladder).toHaveLength(5);
      }
    }
  });

  it('is scoped to Pathfinders only', () => {
    expect(REPAIR_THE_MOONLIGHT_BRIDGE.ageBands).toEqual(['PATHFINDER']);
  });
});
