import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  createCoopSession,
  getCoopSession,
  updateCoopSession,
  claimCoopSlotMutation,
  onUpdate,
  subscribe,
} = vi.hoisted(() => ({
  createCoopSession: vi.fn(),
  getCoopSession: vi.fn(),
  updateCoopSession: vi.fn(),
  claimCoopSlotMutation: vi.fn(),
  onUpdate: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      CoopSession: {
        create: createCoopSession,
        get: getCoopSession,
        update: updateCoopSession,
        onUpdate,
      },
    },
    mutations: {
      claimCoopSlot: claimCoopSlotMutation,
    },
  },
}));

import {
  claimCoopSlot,
  completeCoopSession,
  setCoopPresence,
  slotClaimedBy,
  startCoopSession,
  subscribeToCoopSession,
} from './api';
import type { CoopSession } from './api';

function baseSession(overrides: Partial<CoopSession> = {}): CoopSession {
  return {
    id: 'coop-1',
    hostParentProfileId: 'parent-sub-1',
    templateSlug: 'repair-the-moonlight-bridge',
    templateVersion: 1,
    participantChildProfileIds: ['child-a', 'child-b'],
    status: 'ACTIVE',
    sharedState: { slots: {}, presence: [] },
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as CoopSession;
}

describe('coop api', () => {
  beforeEach(() => {
    createCoopSession.mockReset();
    getCoopSession.mockReset();
    updateCoopSession.mockReset();
    claimCoopSlotMutation.mockReset();
    onUpdate.mockReset();
    subscribe.mockReset();
  });

  it('starts a coop session with both participants, an ACTIVE status, and empty shared state', async () => {
    createCoopSession.mockResolvedValueOnce({ data: baseSession(), errors: undefined });

    await startCoopSession('repair-the-moonlight-bridge', 1, ['child-a', 'child-b']);

    expect(createCoopSession).toHaveBeenCalledWith(
      expect.objectContaining({
        templateSlug: 'repair-the-moonlight-bridge',
        templateVersion: 1,
        participantChildProfileIds: ['child-a', 'child-b'],
        status: 'ACTIVE',
        sharedState: { slots: {}, presence: [] },
      }),
    );
  });

  it('throws a plain-language error when starting a session fails', async () => {
    createCoopSession.mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] });
    await expect(
      startCoopSession('repair-the-moonlight-bridge', 1, ['child-a', 'child-b']),
    ).rejects.toThrow('boom');
  });

  it('claims a coop slot via the claimCoopSlot mutation, not a plain model update', async () => {
    const claimed = baseSession({
      sharedState: { slots: { 'count-planks': 'child-a' }, presence: [] },
    });
    claimCoopSlotMutation.mockResolvedValueOnce({ data: claimed, errors: undefined });

    const result = await claimCoopSlot('coop-1', 'count-planks', 'child-a');

    expect(claimCoopSlotMutation).toHaveBeenCalledWith({
      coopSessionId: 'coop-1',
      slotKey: 'count-planks',
      childProfileId: 'child-a',
    });
    expect(updateCoopSession).not.toHaveBeenCalled();
    expect(slotClaimedBy(result, 'count-planks')).toBe('child-a');
    expect(slotClaimedBy(result, 'order-planks')).toBeNull();
  });

  it('adds a childProfileId to presence on join without disturbing existing slots', async () => {
    const existing = baseSession({
      sharedState: { slots: { 'count-planks': 'child-a' }, presence: ['child-a'] },
    });
    getCoopSession.mockResolvedValueOnce({ data: existing });
    updateCoopSession.mockResolvedValueOnce({ data: existing, errors: undefined });

    await setCoopPresence('coop-1', 'child-b', true);

    expect(updateCoopSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'coop-1',
        sharedState: { slots: { 'count-planks': 'child-a' }, presence: ['child-a', 'child-b'] },
      }),
    );
  });

  it('removes a childProfileId from presence on leave', async () => {
    const existing = baseSession({ sharedState: { slots: {}, presence: ['child-a', 'child-b'] } });
    getCoopSession.mockResolvedValueOnce({ data: existing });
    updateCoopSession.mockResolvedValueOnce({ data: existing, errors: undefined });

    await setCoopPresence('coop-1', 'child-b', false);

    expect(updateCoopSession).toHaveBeenCalledWith(
      expect.objectContaining({ sharedState: { slots: {}, presence: ['child-a'] } }),
    );
  });

  it('marks a coop session COMPLETED with a completedAt timestamp', async () => {
    updateCoopSession.mockResolvedValueOnce({
      data: baseSession({ status: 'COMPLETED' }),
      errors: undefined,
    });

    await completeCoopSession('coop-1');

    expect(updateCoopSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'coop-1',
        status: 'COMPLETED',
        completedAt: expect.any(String),
      }),
    );
  });

  it('subscribes to onUpdate filtered by id and returns an unsubscribe function', () => {
    onUpdate.mockReturnValue({ subscribe });
    subscribe.mockReturnValue({ unsubscribe: vi.fn() });

    const unsubscribe = subscribeToCoopSession('coop-1', () => undefined);

    expect(onUpdate).toHaveBeenCalledWith({ filter: { id: { eq: 'coop-1' } } });
    expect(typeof unsubscribe).toBe('function');
  });
});
