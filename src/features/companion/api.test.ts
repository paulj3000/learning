import { describe, expect, it, vi, beforeEach } from 'vitest';

const { generateCompanionTurn, createAudit, createSafetyEvent } = vi.hoisted(() => ({
  generateCompanionTurn: vi.fn(),
  createAudit: vi.fn(),
  createSafetyEvent: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    generations: { generateCompanionTurn },
    models: {
      AIInteractionAudit: { create: createAudit },
      SafetyEvent: { create: createSafetyEvent },
    },
  },
}));

import { requestCompanionTurn } from './api';

describe('requestCompanionTurn', () => {
  beforeEach(() => {
    generateCompanionTurn.mockReset();
    createAudit.mockReset();
    createSafetyEvent.mockReset();
  });

  it('never calls the AI route or writes an audit row when aiEnabled is false', async () => {
    const result = await requestCompanionTurn({
      childProfileId: 'child-1',
      ageBand: 'PATHFINDER',
      intent: 'HINT',
      stepSummary: 'counting missing planks',
      authoredBaseText: 'Count the planks again.',
      aiEnabled: false,
    });

    expect(result.source).toBe('FALLBACK');
    expect(result.turn.spokenText).toBe('Count the planks again.');
    expect(generateCompanionTurn).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
    expect(createSafetyEvent).not.toHaveBeenCalled();
  });

  it('calls the AI route as normal when aiEnabled is omitted', async () => {
    generateCompanionTurn.mockResolvedValueOnce({
      data: {
        spokenText: 'Great counting!',
        emotion: 'CHEERFUL',
        intent: 'CELEBRATE',
        safetyDisposition: 'ALLOW',
      },
      errors: undefined,
    });
    createAudit.mockResolvedValueOnce({});

    const result = await requestCompanionTurn({
      childProfileId: 'child-1',
      ageBand: 'PATHFINDER',
      intent: 'CELEBRATE',
      stepSummary: 'counting missing planks',
    });

    expect(generateCompanionTurn).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('AI');
    expect(result.turn.spokenText).toBe('Great counting!');
  });

  it('calls the AI route as normal when aiEnabled is explicitly true', async () => {
    generateCompanionTurn.mockResolvedValueOnce({
      data: null,
      errors: [{ message: 'boom' }],
    });
    createAudit.mockResolvedValueOnce({});

    const result = await requestCompanionTurn({
      childProfileId: 'child-1',
      ageBand: 'PATHFINDER',
      intent: 'CELEBRATE',
      stepSummary: 'counting missing planks',
      aiEnabled: true,
    });

    expect(generateCompanionTurn).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('FALLBACK');
  });
});
