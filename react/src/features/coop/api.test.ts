import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';

vi.mock('../../api/auth', () => ({ getAccessToken: vi.fn(async () => 'token') }));

import {
  claimCoopSlot,
  completeCoopSession,
  getCoopSession,
  setCoopPresence,
  slotClaimedBy,
  startCoopSession,
  subscribeToCoopSession,
} from './api';

function wireSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'coop-1',
    templateSlug: 'repair-the-moonlight-bridge',
    templateVersion: 1,
    participantChildProfileIds: ['child-a', 'child-b'],
    status: 'ACTIVE',
    sharedState: { slots: {}, presence: [] },
    startedAt: '2026-01-01T00:00:00+00:00',
    lastActivityAt: '2026-01-01T00:00:00+00:00',
    completedAt: null,
    ...overrides,
  };
}

function fakeClient(...responses: unknown[]) {
  const request = vi.fn();
  for (const data of responses) request.mockResolvedValueOnce({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
}

describe('coop api (Django, AMP-05)', () => {
  it('starts a session through the host child, naming only the partner and adventure', async () => {
    const { client, request } = fakeClient(wireSession());
    const session = await startCoopSession(
      'repair-the-moonlight-bridge',
      ['child-a', 'child-b'],
      client,
    );
    expect(request).toHaveBeenCalledWith('POST', 'children/child-a/coop-sessions/', {
      body: { adventureSlug: 'repair-the-moonlight-bridge', partnerChildId: 'child-b' },
    });
    expect(session.status).toBe('ACTIVE');
    expect(session.sharedState).toEqual({ slots: {}, presence: [] });
  });

  it('claims a slot on the child-scoped route and reads the resulting state', async () => {
    const { client, request } = fakeClient({
      outcome: 'claimed',
      session: wireSession({ sharedState: { slots: { 'count-planks': 'child-a' }, presence: [] } }),
    });
    const result = await claimCoopSlot('coop-1', 'count-planks', 'child-a', client);
    expect(request).toHaveBeenCalledWith('POST', 'children/child-a/coop-sessions/coop-1/slots/', {
      body: { slotKey: 'count-planks' },
    });
    expect(slotClaimedBy(result, 'count-planks')).toBe('child-a');
    expect(slotClaimedBy(result, 'order-planks')).toBeNull();
  });

  it('treats a slot the partner already holds as current state, not an error', async () => {
    const { client } = fakeClient({
      outcome: 'held_by_partner',
      session: wireSession({ sharedState: { slots: { 'count-planks': 'child-b' }, presence: [] } }),
    });
    const result = await claimCoopSlot('coop-1', 'count-planks', 'child-a', client);
    expect(slotClaimedBy(result, 'count-planks')).toBe('child-b');
  });

  it('sends join and leave as a single flag for the acting child', async () => {
    const { client, request } = fakeClient(wireSession(), wireSession());
    await setCoopPresence('coop-1', 'child-b', true, client);
    await setCoopPresence('coop-1', 'child-b', false, client);
    expect(request).toHaveBeenNthCalledWith(
      1,
      'POST',
      'children/child-b/coop-sessions/coop-1/presence/',
      { body: { present: true } },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'POST',
      'children/child-b/coop-sessions/coop-1/presence/',
      { body: { present: false } },
    );
  });

  it('completes through the acting child', async () => {
    const { client, request } = fakeClient(
      wireSession({ status: 'COMPLETED', completedAt: '2026-01-01T00:10:00+00:00' }),
    );
    const done = await completeCoopSession('coop-1', 'child-a', client);
    expect(request).toHaveBeenCalledWith('POST', 'children/child-a/coop-sessions/coop-1/complete/');
    expect(done.completedAt).toBe('2026-01-01T00:10:00+00:00');
  });

  it('refuses empty ids before any request and malformed responses after', async () => {
    const { client, request } = fakeClient({ id: 'coop-1' });
    await expect(getCoopSession('', 'coop-1', client)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(claimCoopSlot('coop-1', '', 'child-a', client)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(request).not.toHaveBeenCalled();
    await expect(getCoopSession('child-a', 'coop-1', client)).rejects.toBeInstanceOf(ApiError);
  });

  it('reads a malformed shared state as empty rather than trusting it', async () => {
    const { client } = fakeClient(wireSession({ sharedState: 'not json' }));
    const session = await getCoopSession('child-a', 'coop-1', client);
    expect(session.sharedState).toEqual({ slots: {}, presence: [] });
  });
});

describe('subscribeToCoopSession (polling replaces the AppSync subscription)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls the GET route at the interval and stops on unsubscribe', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: wireSession() });
    const client = { request } as unknown as ApiClient;
    const onChange = vi.fn();

    const stop = subscribeToCoopSession('coop-1', 'child-a', onChange, {
      intervalMs: 1000,
      client,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('GET', 'children/child-a/coop-sessions/coop-1/');
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2500);
    expect(request).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('keeps polling after a failed request and never calls back after stopping', async () => {
    let resolveSlow: (value: unknown) => void = () => undefined;
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      );
    const client = { request } as unknown as ApiClient;
    const onChange = vi.fn();

    const stop = subscribeToCoopSession('coop-1', 'child-a', onChange, {
      intervalMs: 1000,
      client,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2);
    stop();
    resolveSlow({ status: 200, data: wireSession() });
    await vi.advanceTimersByTimeAsync(5000);
    expect(onChange).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
