import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { chooseCastleEvent, requestCastleFlavour } from './castleDirectorApi';

const GOOD = {
  eventId: 'quill-hums-in-hall',
  source: 'AI',
  lines: ['Keeper Quill hums a tune.'],
  npcId: 'keeper-quill',
  visual: { kind: 'quill-scratch' },
};

const clientReturning = (data: unknown) => {
  const request = vi.fn().mockResolvedValue({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
};

describe('chooseCastleEvent', () => {
  it('sends only the room and visit ids, and reads the authored event', async () => {
    const { client, request } = clientReturning(GOOD);
    expect(await chooseCastleEvent(client, 'child-1', 'story-hall', 'visit-1')).toEqual(GOOD);
    expect(request).toHaveBeenCalledWith('POST', 'children/child-1/castle/director/', {
      body: { roomId: 'story-hall', visitId: 'visit-1' },
    });
  });

  it('accepts an event with no NPC', async () => {
    const { client } = clientReturning({ ...GOOD, npcId: null, source: 'FALLBACK' });
    expect(await chooseCastleEvent(client, 'c', 'r', 'v')).toMatchObject({
      npcId: null,
      source: 'FALLBACK',
    });
  });

  it('refuses a response that is not the documented shape', async () => {
    for (const bad of [{}, null, { ...GOOD, source: 'MAYBE' }, { ...GOOD, lines: 'hi' }]) {
      const { client } = clientReturning(bad);
      await expect(chooseCastleEvent(client, 'c', 'r', 'v')).rejects.toBeInstanceOf(ApiError);
    }
  });

  it('refuses empty ids before any request', async () => {
    const { client, request } = clientReturning(GOOD);
    await expect(chooseCastleEvent(client, '', 'r', 'v')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(chooseCastleEvent(client, 'c', '', 'v')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(chooseCastleEvent(client, 'c', 'r', '')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('requestCastleFlavour', () => {
  const FLAVOUR = { eventId: 'quill-hums-in-hall', line: 'Quill hums.', source: 'AI' };

  it('sends only the event id and reads the line', async () => {
    const { client, request } = clientReturning(FLAVOUR);
    expect(await requestCastleFlavour(client, 'child-1', 'quill-hums-in-hall')).toEqual(FLAVOUR);
    expect(request).toHaveBeenCalledWith('POST', 'children/child-1/castle/flavour/', {
      body: { eventId: 'quill-hums-in-hall' },
    });
  });

  it('refuses a malformed answer and empty ids', async () => {
    for (const bad of [{}, null, { ...FLAVOUR, source: 'MAYBE' }, { ...FLAVOUR, line: 3 }]) {
      const { client } = clientReturning(bad);
      await expect(requestCastleFlavour(client, 'c', 'e')).rejects.toBeInstanceOf(ApiError);
    }
    const { client, request } = clientReturning(FLAVOUR);
    await expect(requestCastleFlavour(client, '', 'e')).rejects.toMatchObject({ kind: 'invalid_request' });
    await expect(requestCastleFlavour(client, 'c', '')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
  });
});
