import { describe, expect, it, vi, beforeEach } from 'vitest';

const { list, create, submitAdventureAnswerMutation } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  submitAdventureAnswerMutation: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      AdventureSession: { list, create },
    },
    mutations: {
      submitAdventureAnswer: submitAdventureAnswerMutation,
    },
  },
}));

import { resumeOrStartSession, submitAdventureAnswer } from './api';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './content';

describe('resumeOrStartSession', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
  });

  it('reuses an existing active session for this child and template instead of creating a new one', async () => {
    const active = {
      id: 'session-1',
      childProfileId: 'child-1',
      templateSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
      status: 'ACTIVE',
    };
    list.mockResolvedValueOnce({ data: [active] });

    const result = await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(result).toBe(active);
    expect(create).not.toHaveBeenCalled();
  });

  it('starts a new session at the definition entry step when none is active', async () => {
    list.mockResolvedValueOnce({ data: [] });
    const created = { id: 'session-2', currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId };
    create.mockResolvedValueOnce({ data: created, errors: undefined });

    const result = await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(result).toBe(created);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        childProfileId: 'child-1',
        templateSlug: REPAIR_THE_MOONLIGHT_BRIDGE.slug,
        templateVersion: REPAIR_THE_MOONLIGHT_BRIDGE.version,
        currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
        status: 'ACTIVE',
      }),
    );
  });

  it('ignores another child or template active session when deciding whether to start a new one', async () => {
    list.mockResolvedValueOnce({
      data: [
        { id: 'other', childProfileId: 'child-2', templateSlug: 'other-slug', status: 'ACTIVE' },
      ],
    });
    create.mockResolvedValueOnce({ data: { id: 'session-3' }, errors: undefined });

    await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('submitAdventureAnswer', () => {
  beforeEach(() => {
    submitAdventureAnswerMutation.mockReset();
  });

  it('sends the raw answer object, not an encoded string', async () => {
    submitAdventureAnswerMutation.mockResolvedValueOnce({
      data: { correctness: 'CORRECT', supportLevel: 0, action: 'ADVANCE', nextStepId: 'step-2' },
      errors: undefined,
    });

    await submitAdventureAnswer('session-1', { kind: 'number-input', value: 4 }, 0);

    expect(submitAdventureAnswerMutation).toHaveBeenCalledWith({
      sessionId: 'session-1',
      answer: { kind: 'number-input', value: 4 },
      hintLevel: 0,
    });
  });

  it('maps a server ADVANCE result to the lowercase Correctness type', async () => {
    submitAdventureAnswerMutation.mockResolvedValueOnce({
      data: { correctness: 'PARTIAL', supportLevel: 1, action: 'ADVANCE', nextStepId: 'step-3' },
      errors: undefined,
    });

    const result = await submitAdventureAnswer('session-1', { kind: 'reflection' }, 1);

    expect(result).toEqual({
      correctness: 'partial',
      supportLevel: 1,
      action: 'ADVANCE',
      nextStepId: 'step-3',
    });
  });

  it('drops nextStepId when the server says to retry', async () => {
    submitAdventureAnswerMutation.mockResolvedValueOnce({
      data: { correctness: 'INCORRECT', supportLevel: 1, action: 'RETRY', nextStepId: 'step-1' },
      errors: undefined,
    });

    const result = await submitAdventureAnswer('session-1', { kind: 'number-input', value: 1 }, 0);

    expect(result).toEqual({
      correctness: 'incorrect',
      supportLevel: 1,
      action: 'RETRY',
      nextStepId: null,
    });
  });

  it('throws when the mutation returns no data', async () => {
    submitAdventureAnswerMutation.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'Not authorized for this adventure.' }],
    });

    await expect(
      submitAdventureAnswer('session-1', { kind: 'number-input', value: 1 }, 0),
    ).rejects.toThrow('Not authorized for this adventure.');
  });
});
