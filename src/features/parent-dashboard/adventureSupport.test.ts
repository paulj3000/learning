import { describe, expect, it } from 'vitest';
import { summarizeSupportByTemplate, summarizeSupportBySession } from './adventureSupport';
import type { AdventureAction } from '../adventures/api';

function action(overrides: Partial<AdventureAction> = {}): AdventureAction {
  return {
    id: 'a1',
    sessionId: 's1',
    stepId: 'step-1',
    actionType: 'ANSWER',
    normalizedAnswer: null,
    correctness: 'CORRECT',
    hintLevel: 0,
    attemptNumber: 1,
    durationMs: null,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
    ...overrides,
  } as AdventureAction;
}

describe('summarizeSupportBySession', () => {
  it('counts a correct, unhinted action as independent', () => {
    const bySession = summarizeSupportBySession([action()]);
    expect(bySession.get('s1')).toEqual({ independentCount: 1, hintedCount: 0 });
  });

  it('counts a correct, hinted action as hinted', () => {
    const bySession = summarizeSupportBySession([action({ hintLevel: 2 })]);
    expect(bySession.get('s1')).toEqual({ independentCount: 0, hintedCount: 1 });
  });

  it('ignores incorrect actions', () => {
    const bySession = summarizeSupportBySession([action({ correctness: 'INCORRECT' })]);
    expect(bySession.has('s1')).toBe(false);
  });

  it('keeps separate sessions separate', () => {
    const bySession = summarizeSupportBySession([
      action({ sessionId: 's1' }),
      action({ sessionId: 's2', hintLevel: 1 }),
    ]);
    expect(bySession.get('s1')).toEqual({ independentCount: 1, hintedCount: 0 });
    expect(bySession.get('s2')).toEqual({ independentCount: 0, hintedCount: 1 });
  });
});

describe('summarizeSupportByTemplate', () => {
  it('rolls up multiple sessions of the same template', () => {
    const bySession = summarizeSupportBySession([
      action({ sessionId: 's1' }),
      action({ sessionId: 's2', hintLevel: 1 }),
    ]);
    const byTemplate = summarizeSupportByTemplate(
      [
        { id: 's1', templateSlug: 'repair-the-moonlight-bridge' },
        { id: 's2', templateSlug: 'repair-the-moonlight-bridge' },
      ],
      bySession,
    );
    expect(byTemplate).toEqual([
      {
        templateSlug: 'repair-the-moonlight-bridge',
        independentCount: 1,
        hintedCount: 1,
      },
    ]);
  });

  it('sorts by templateSlug and skips sessions with no counted actions', () => {
    const bySession = summarizeSupportBySession([action({ sessionId: 's2' })]);
    const byTemplate = summarizeSupportByTemplate(
      [
        { id: 's1', templateSlug: 'zzz-adventure' },
        { id: 's2', templateSlug: 'aaa-adventure' },
      ],
      bySession,
    );
    expect(byTemplate).toEqual([
      { templateSlug: 'aaa-adventure', independentCount: 1, hintedCount: 0 },
    ]);
  });
});
