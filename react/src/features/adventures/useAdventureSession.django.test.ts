import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  advanceSession: vi.fn(),
  completeSession: vi.fn(),
  recordAction: vi.fn(),
  recordSkillEvidence: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  resumeOrStartSession: vi.fn(),
  saveStoryArtifact: vi.fn(),
  submitAdventureAnswer: vi.fn(),
}));
const upsertSkillProgress = vi.hoisted(() => vi.fn());

vi.mock('./api', () => api);
vi.mock('../mastery/api', () => ({ upsertSkillProgress }));
// A backend that owns the session (Django): none of the client-side writes exist.
vi.mock('../../api/select', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/select')>()),
  supports: () => false,
}));
vi.mock('../quests/api', () => ({ syncQuestProgress: vi.fn(async () => undefined) }));
vi.mock('../companion/useCompanionTurn', () => ({
  useCompanionTurn: () => ({ state: { status: 'idle' }, request: vi.fn(async () => null) }),
}));
vi.mock('../tutor/useTutorTurn', () => ({
  useTutorTurn: () => ({ state: { status: 'idle' }, request: vi.fn(async () => null) }),
}));
vi.mock('../child-profile/api', () => ({ ensureChildProfileOwnerSub: vi.fn(async () => {}) }));
vi.mock('../coop/api', () => ({ claimCoopSlot: vi.fn(), completeCoopSession: vi.fn() }));
vi.mock('../coop/useCoopPresence', () => ({ useCoopPresence: () => ({ sharedState: null }) }));

import type { AdventureDefinition } from './engine/types';
import { useAdventureSession } from './useAdventureSession';

const DEFINITION = {
  slug: 'bridge',
  version: 1,
  title: 'Bridge',
  locationSlug: 'pirate-builder-bay',
  ageBands: ['PATHFINDER'],
  entryStepId: 'count',
  steps: [
    {
      id: 'count',
      type: 'NUMBER_INPUT',
      objectiveIds: ['count-10'],
      presentation: { kind: 'number-input', prompt: 'How many?', correctValue: 3 },
      transitions: [{ when: 'correct', nextStepId: 'fix' }],
      fallback: { text: 'Count' },
    },
    {
      id: 'fix',
      type: 'WORLD_CHANGE',
      objectiveIds: [],
      presentation: {
        kind: 'world-change',
        text: 'Fixed',
        payload: { locationSlug: 'pirate-builder-bay', changeType: 'REPAIR', changeKey: 'BRIDGE' },
      },
      transitions: [{ when: 'always', nextStepId: 'done' }],
      fallback: { text: 'Fixed' },
    },
    {
      id: 'done',
      type: 'COMPLETE',
      objectiveIds: [],
      presentation: { kind: 'complete', text: 'Done' },
      transitions: [],
      fallback: { text: 'Done' },
    },
  ],
} as unknown as AdventureDefinition;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    childProfileId: 'child-1',
    templateSlug: 'bridge',
    templateVersion: 1,
    status: 'ACTIVE',
    currentStepId: 'count',
    startedAt: '2026-10-26T10:00:00Z',
    lastActivityAt: '2026-10-26T10:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.resumeOrStartSession.mockResolvedValue(session());
});

describe('useAdventureSession on a backend that owns the session (LAI-0608)', () => {
  it('plays through with the server alone: answers, world change, then completion', async () => {
    api.submitAdventureAnswer
      .mockResolvedValueOnce({
        correctness: 'correct',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'fix',
      })
      .mockResolvedValueOnce({
        correctness: 'not_applicable',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'done',
      });
    api.completeSession.mockResolvedValue(session({ status: 'COMPLETED', currentStepId: 'done' }));

    const { result } = renderHook(() =>
      useAdventureSession('child-1', DEFINITION, 'PATHFINDER', false),
    );
    await waitFor(() => expect(result.current.loadState).toBe('ready'));

    await act(async () => {
      await result.current.submitAnswer({ kind: 'number-input', value: 3 });
    });

    // The world-change step goes through the answer route, then the COMPLETE step finalises.
    await waitFor(() => expect(result.current.session?.status).toBe('COMPLETED'));
    expect(api.submitAdventureAnswer).toHaveBeenNthCalledWith(
      1,
      'session-1',
      { kind: 'number-input', value: 3 },
      0,
      { childProfileId: 'child-1', stepId: 'count' },
    );
    expect(api.submitAdventureAnswer).toHaveBeenNthCalledWith(
      2,
      'session-1',
      { kind: 'world-change' },
      0,
      { childProfileId: 'child-1', stepId: 'fix' },
    );
    expect(api.completeSession).toHaveBeenCalledWith('session-1', {
      childProfileId: 'child-1',
      adventureSlug: 'bridge',
    });
    expect(result.current.error).toBeNull();

    // None of the Amplify client-side ledger writes happened.
    expect(api.recordAction).not.toHaveBeenCalled();
    expect(api.recordSkillEvidence).not.toHaveBeenCalled();
    expect(upsertSkillProgress).not.toHaveBeenCalled();
    expect(api.recordWorldChangeOnce).not.toHaveBeenCalled();
    expect(api.advanceSession).not.toHaveBeenCalled();
    expect(api.saveStoryArtifact).not.toHaveBeenCalled();
  });
});
