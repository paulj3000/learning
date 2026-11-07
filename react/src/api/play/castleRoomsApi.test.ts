import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { castleRoomsApiFor, discoverRoom, getDiscoveredRooms } from './castleRoomsApi';

const clientReturning = (data: unknown) => {
  const request = vi.fn().mockResolvedValue({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
};

describe('getDiscoveredRooms', () => {
  it('reads the room ids from the child-scoped route', async () => {
    const { client, request } = clientReturning({ rooms: ['entry-hall', 'story-hall'] });
    expect(await getDiscoveredRooms(client, 'child-1')).toEqual(['entry-hall', 'story-hall']);
    expect(request).toHaveBeenCalledWith('GET', 'children/child-1/castle/rooms/');
  });

  it('refuses a response that is not the documented shape, naming where', async () => {
    for (const bad of [{}, { rooms: 'story-hall' }, { rooms: [1] }, null]) {
      const { client } = clientReturning(bad);
      await expect(getDiscoveredRooms(client, 'c')).rejects.toBeInstanceOf(ApiError);
    }
    const { client } = clientReturning({ rooms: [1] });
    await expect(getDiscoveredRooms(client, 'c')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('escapes the child id in the path and refuses an empty one before any request', async () => {
    const { client, request } = clientReturning({ rooms: [] });
    await getDiscoveredRooms(client, 'a/b?c');
    expect(request).toHaveBeenCalledWith('GET', 'children/a%2Fb%3Fc/castle/rooms/');
    request.mockClear();
    await expect(getDiscoveredRooms(client, '')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('discoverRoom', () => {
  it('sends only the room id, and reads whether it was new', async () => {
    const { client, request } = clientReturning({ roomId: 'story-hall', newlyDiscovered: true });
    expect(await discoverRoom(client, 'child-1', 'story-hall')).toEqual({
      roomId: 'story-hall',
      newlyDiscovered: true,
    });
    // The body is closed on the server: nothing but the room id may be sent.
    expect(request).toHaveBeenCalledWith('POST', 'children/child-1/castle/rooms/', {
      body: { roomId: 'story-hall' },
    });
  });

  it('refuses empty ids before any request, and a malformed outcome', async () => {
    const { client, request } = clientReturning({ roomId: 'x' });
    await expect(discoverRoom(client, '', 'story-hall')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(discoverRoom(client, 'c', '')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
    await expect(discoverRoom(client, 'c', 'x')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('passes a server refusal straight through, for the caller to treat as not saved', async () => {
    const refusal = new ApiError('not_found');
    const request = vi.fn().mockRejectedValue(refusal);
    await expect(
      discoverRoom({ request } as unknown as ApiClient, 'c', 'secret-chamber'),
    ).rejects.toBe(refusal);
  });
});

describe('castleRoomsApiFor', () => {
  it('is undefined in a build without the Django API, so nothing is saved and nothing fails', () => {
    expect(castleRoomsApiFor('child-1', { enabled: false })).toBeUndefined();
  });

  it('is an API with the two calls when the Django API is on', () => {
    const api = castleRoomsApiFor('child-1', { enabled: true, baseUrl: '' });
    expect(typeof api?.list).toBe('function');
    expect(typeof api?.record).toBe('function');
  });
});
