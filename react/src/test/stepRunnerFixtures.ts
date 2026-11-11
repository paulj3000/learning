/** Step runner API fixtures (LAI-0816): the JSON Django sends. */

export const SESSION_ID = '0c1d2e3f-4a5b-4c6d-8e7f-1a2b3c4d5e6f';

export function sessionJson(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    adventureSlug: 'mend-bridge',
    templateVersion: 1,
    status: 'ACTIVE',
    currentStepId: 'count',
    hintLevel: 0,
    startedAt: '2026-11-03T10:00:00Z',
    lastActivityAt: '2026-11-03T10:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

export function viewJson(overrides: Record<string, unknown> = {}) {
  return {
    session: sessionJson(),
    step: {
      id: 'count',
      type: 'NUMBER_INPUT',
      objectiveIds: ['count-10'],
      presentation: { kind: 'number-input', prompt: 'How many planks?' },
      hasHints: true,
    },
    stepRevision: { id: 'rev-step', number: 1 },
    adventureRevision: { id: 'rev-adv', number: 3 },
    doneStepIds: [],
    hintLevel: 0,
    created: true,
    ...overrides,
  };
}
