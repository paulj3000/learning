import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { discoveriesApiFor, getDiscoveries, recordDiscoveryOnServer } from './discoveriesApi';

const clientReturning = (data: unknown) => {
  const request = vi.fn().mockResolvedValue({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
};

describe('getDiscoveries', () => {
  it('reads the ids from the child-scoped route', async () => {
    const { client, request } = clientReturning({ discoveries: ['castle-tapestry-stair'] });
    expect(await getDiscoveries(client, 'child-1')).toEqual(['castle-tapestry-stair']);
    expect(request).toHaveBeenCalledWith('GET', 'children/child-1/discoveries/');
  });

  it('refuses a malformed response, naming where, and an empty child id before any request', async () => {
    for (const bad of [{}, { discoveries: 'x' }, { discoveries: [1] }, null]) {
      const { client } = clientReturning(bad);
      await expect(getDiscoveries(client, 'c')).rejects.toBeInstanceOf(ApiError);
    }
    const { client, request } = clientReturning({ discoveries: [] });
    await expect(getDiscoveries(client, '')).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('recordDiscoveryOnServer', () => {
  it('sends only the discovery id, and reads a first find with what it granted', async () => {
    const { client, request } = clientReturning({
      discoveryId: 'castle-tapestry-stair',
      status: 'FOUND_NOW',
      rewardMessages: ['You carry the book.'],
      newItemIds: ['blank-page-storybook'],
    });
    expect(await recordDiscoveryOnServer(client, 'child-1', 'castle-tapestry-stair')).toEqual({
      discoveryId: 'castle-tapestry-stair',
      status: 'FOUND_NOW',
      rewardMessages: ['You carry the book.'],
      newItemIds: ['blank-page-storybook'],
    });
    // The body is closed on the server: nothing but the id may be sent.
    expect(request).toHaveBeenCalledWith('POST', 'children/child-1/discoveries/', {
      body: { discoveryId: 'castle-tapestry-stair' },
    });
  });

  it('reads a replay with nothing granted, and a locked find with its authored line', async () => {
    const replay = clientReturning({ discoveryId: 'x', status: 'ALREADY_FOUND' });
    expect(await recordDiscoveryOnServer(replay.client, 'c', 'x')).toMatchObject({
      status: 'ALREADY_FOUND',
      rewardMessages: [],
      newItemIds: [],
    });
    const locked = clientReturning({ discoveryId: 'x', status: 'LOCKED', message: 'Not yet.' });
    expect(await recordDiscoveryOnServer(locked.client, 'c', 'x')).toMatchObject({
      status: 'LOCKED',
      message: 'Not yet.',
    });
  });

  it('refuses an unknown status and empty ids', async () => {
    const odd = clientReturning({ discoveryId: 'x', status: 'OPENED' });
    await expect(recordDiscoveryOnServer(odd.client, 'c', 'x')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
    const { client, request } = clientReturning({});
    await expect(recordDiscoveryOnServer(client, '', 'x')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    await expect(recordDiscoveryOnServer(client, 'c', '')).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('passes a server refusal straight through', async () => {
    const refusal = new ApiError('not_found');
    const request = vi.fn().mockRejectedValue(refusal);
    await expect(
      recordDiscoveryOnServer({ request } as unknown as ApiClient, 'c', 'x'),
    ).rejects.toBe(refusal);
  });
});

describe('discoveriesApiFor', () => {
  it('is undefined in a build without the Django API, so the Amplify path is untouched', () => {
    expect(discoveriesApiFor('c', { enabled: false })).toBeUndefined();
  });

  it('has the two calls when the Django API is on', () => {
    const api = discoveriesApiFor('c', { enabled: true, baseUrl: '' });
    expect(typeof api?.list).toBe('function');
    expect(typeof api?.record).toBe('function');
  });
});
