import { describe, expect, it } from 'vitest';
import { buildInteractionEvidence, evidenceHintLevel } from './evidence';

describe('buildInteractionEvidence', () => {
  it('assembles evidence with a computed duration', () => {
    const evidence = buildInteractionEvidence({
      interactionId: 'count-the-planks',
      objectiveIds: ['counting-sets'],
      correctness: 'correct',
      attemptNumber: 1,
      scaffoldingLevel: undefined,
      startedAtMs: 1_000,
      nowMs: 4_500,
    });

    expect(evidence).toEqual({
      interactionId: 'count-the-planks',
      objectiveIds: ['counting-sets'],
      correctness: 'correct',
      attemptNumber: 1,
      scaffoldingLevel: undefined,
      durationMs: 3_500,
    });
  });

  it('never returns a negative duration, even with a clock going backwards', () => {
    const evidence = buildInteractionEvidence({
      interactionId: 'x',
      objectiveIds: [],
      correctness: 'incorrect',
      attemptNumber: 1,
      scaffoldingLevel: undefined,
      startedAtMs: 5_000,
      nowMs: 1_000,
    });
    expect(evidence.durationMs).toBe(0);
  });

  it('defaults nowMs to the current time when omitted', () => {
    const before = Date.now();
    const evidence = buildInteractionEvidence({
      interactionId: 'x',
      objectiveIds: [],
      correctness: 'correct',
      attemptNumber: 1,
      scaffoldingLevel: undefined,
      startedAtMs: before,
    });
    expect(evidence.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('evidenceHintLevel', () => {
  it('is 0 when no scaffold was used', () => {
    const evidence = buildInteractionEvidence({
      interactionId: 'x',
      objectiveIds: [],
      correctness: 'correct',
      attemptNumber: 1,
      scaffoldingLevel: undefined,
      startedAtMs: 0,
      nowMs: 0,
    });
    expect(evidenceHintLevel(evidence)).toBe(0);
  });

  it('translates a named scaffolding level back to its 1-based integer', () => {
    const evidence = buildInteractionEvidence({
      interactionId: 'x',
      objectiveIds: [],
      correctness: 'correct',
      attemptNumber: 2,
      scaffoldingLevel: 'GUIDED_DEMONSTRATION',
      startedAtMs: 0,
      nowMs: 0,
    });
    expect(evidenceHintLevel(evidence)).toBe(4);
  });
});
