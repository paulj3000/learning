import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { getAdventureTemplate } from '../adventures/content';
import { isTutorableSkill } from './context';
import { toCompanionTurn, toCompanionTurnState } from './presentation';
import { FALLBACK_TUTOR_TURNS } from './fallback';

/**
 * Phase 26.5's lesson, applied to this phase: an engine that no live screen
 * can reach is not shipped. `useAdventureSession.requestHint` routes a hint
 * to the tutor exactly when the step's first objective `isTutorableSkill`,
 * so these assertions are what make that route non-hypothetical.
 */
describe('tutor reachability from authored adventures', () => {
  it('is reachable from a hinted step in the flagship adventure', () => {
    const bridge = getAdventureTemplate('repair-the-moonlight-bridge');
    expect(bridge).toBeDefined();

    const tutoredSteps = (bridge?.steps ?? []).filter(
      (step) => step.hintPolicy && step.objectiveIds[0] && isTutorableSkill(step.objectiveIds[0]),
    );
    expect(tutoredSteps.length).toBeGreaterThan(0);
  });

  it('leaves every other authored step on the Phase 4 companion path', () => {
    // Not a defect: the seed curriculum is one vertical slice (Phase 19), so
    // literacy and science steps have no skill graph or vocabulary to bound
    // a tutoring prompt with. This asserts the split is real rather than
    // accidental - if a later phase authors those skills, this count moves
    // and the test should be updated deliberately.
    const hintedSteps = ADVENTURE_TEMPLATES.flatMap((template) =>
      template.steps.filter((step) => step.hintPolicy),
    );
    const tutored = hintedSteps.filter(
      (step) => step.objectiveIds[0] && isTutorableSkill(step.objectiveIds[0]),
    );
    expect(tutored.length).toBeGreaterThan(0);
    expect(tutored.length).toBeLessThan(hintedSteps.length);
  });
});

describe('tutor presentation', () => {
  it('speaks through the one companion bubble the child already knows', () => {
    expect(toCompanionTurn(FALLBACK_TUTOR_TURNS.ASK_GUIDING_QUESTION).intent).toBe('ASK');
    expect(toCompanionTurn(FALLBACK_TUTOR_TURNS.GIVE_HINT).intent).toBe('HINT');
    expect(toCompanionTurn(FALLBACK_TUTOR_TURNS.SWITCH_REPRESENTATION).intent).toBe('HINT');
    expect(toCompanionTurn(FALLBACK_TUTOR_TURNS.ENCOURAGE).intent).toBe('NARRATE');
  });

  it('passes non-ready states straight through', () => {
    expect(toCompanionTurnState({ status: 'idle' })).toEqual({ status: 'idle' });
    expect(toCompanionTurnState({ status: 'loading' })).toEqual({ status: 'loading' });
    expect(toCompanionTurnState({ status: 'error' })).toEqual({ status: 'error' });
  });

  it('keeps the fallback source visible to parent-facing surfaces', () => {
    const state = toCompanionTurnState({
      status: 'ready',
      turn: FALLBACK_TUTOR_TURNS.EXPLAIN,
      source: 'FALLBACK',
    });
    expect(state).toMatchObject({ status: 'ready', source: 'FALLBACK' });
  });
});
