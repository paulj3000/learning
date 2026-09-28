import { describe, expect, it, vi, beforeEach } from 'vitest';

const { list, create, submitAdventureAnswerMutation, islandList, adventureList } = vi.hoisted(
  () => ({
    list: vi.fn(),
    create: vi.fn(),
    submitAdventureAnswerMutation: vi.fn(),
    islandList: vi.fn(),
    adventureList: vi.fn(),
  }),
);

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      AdventureSession: { list, create },
      Island: { list: islandList },
      Adventure: { list: adventureList },
    },
    mutations: {
      submitAdventureAnswer: submitAdventureAnswerMutation,
    },
  },
}));

import { resumeOrStartSession, submitAdventureAnswer } from './api';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from './content';
import { AdventureUnavailableError } from '../catalog/availabilityApi';

beforeEach(() => {
  islandList.mockReset().mockResolvedValue({ data: [] });
  adventureList.mockReset().mockResolvedValue({ data: [] });
});

describe('resumeOrStartSession and the admin catalog (ADR-024)', () => {
  beforeEach(() => {
    list.mockReset();
    create.mockReset();
  });

  const PIRATE_BAY = { id: 'island-1', slug: 'pirate-builder-bay', active: true };
  const BRIDGE = { slug: REPAIR_THE_MOONLIGHT_BRIDGE.slug, islandId: 'island-1', active: true };

  it.each([
    ['the adventure is inactive', { ...PIRATE_BAY }, { ...BRIDGE, active: false }],
    ['its island is inactive', { ...PIRATE_BAY, active: false }, { ...BRIDGE }],
    ['its island is inactive and it has no row of its own', { ...PIRATE_BAY, active: false }, null],
  ])(
    'refuses to start or resume when %s, leaving sessions untouched',
    async (_, islandRow, adventureRow) => {
      islandList.mockResolvedValue({ data: [islandRow] });
      adventureList.mockResolvedValue({ data: adventureRow ? [adventureRow] : [] });

      await expect(
        resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE),
      ).rejects.toBeInstanceOf(AdventureUnavailableError);
      expect(list).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('starts normally when both the island and the adventure are active', async () => {
    islandList.mockResolvedValue({ data: [PIRATE_BAY] });
    adventureList.mockResolvedValue({ data: [BRIDGE] });
    list.mockResolvedValueOnce({ data: [] });
    create.mockResolvedValueOnce({ data: { id: 'session-3' }, errors: undefined });

    await expect(resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE)).resolves.toEqual({
      id: 'session-3',
    });
  });

  it('reads only the availability fields, never the admin-only audit fields', async () => {
    list.mockResolvedValueOnce({ data: [] });
    create.mockResolvedValueOnce({ data: { id: 'session-4' }, errors: undefined });
    await resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    expect(islandList).toHaveBeenCalledWith(
      expect.objectContaining({ selectionSet: ['id', 'slug', 'active'] }),
    );
    expect(adventureList).toHaveBeenCalledWith(
      expect.objectContaining({ selectionSet: ['slug', 'islandId', 'active'] }),
    );
  });

  it('fails open when the catalog cannot be read', async () => {
    islandList.mockRejectedValue(new Error('network'));
    list.mockResolvedValueOnce({ data: [] });
    create.mockResolvedValueOnce({ data: { id: 'session-5' }, errors: undefined });
    await expect(resumeOrStartSession('child-1', REPAIR_THE_MOONLIGHT_BRIDGE)).resolves.toEqual({
      id: 'session-5',
    });
  });
});

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
