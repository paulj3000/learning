import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { getStorybook, storybookApiFor } from './storybookApi';

const body = {
  band: 'PATHFINDER',
  pages: [
    {
      id: 'page-first-story',
      title: 'The First Story',
      required: true,
      restored: false,
      roomId: 'story-hall',
      text: 'Tell a story with Keeper Quill in the Story Hall.',
    },
  ],
  restoredRequired: 0,
  totalRequired: 1,
  restoredBonus: 0,
  complete: false,
  quest: { questId: 'restore-the-great-storybook-pathfinders', status: 'NOT_STARTED' },
};

const clientReturning = (data: unknown) => {
  const request = vi.fn().mockResolvedValue({ status: 200, data });
  return { client: { request } as unknown as ApiClient, request };
};

describe('getStorybook', () => {
  it('reads the book from the child-scoped route, sending nothing', async () => {
    const { client, request } = clientReturning(body);
    expect(await getStorybook(client, 'child-1')).toEqual(body);
    expect(request).toHaveBeenCalledWith('GET', 'children/child-1/castle/storybook/');
  });

  it('reads a quest that has no id yet', async () => {
    const { client } = clientReturning({
      ...body,
      quest: { questId: null, status: 'NOT_STARTED' },
    });
    expect((await getStorybook(client, 'c')).quest.questId).toBeNull();
  });

  it('refuses a response that is not the documented shape, naming where', async () => {
    const broken = [
      {},
      { ...body, pages: 'x' },
      { ...body, pages: [{ ...body.pages[0], restored: 'yes' }] },
      { ...body, complete: 1 },
      { ...body, quest: {} },
      null,
    ];
    for (const bad of broken) {
      const { client } = clientReturning(bad);
      await expect(getStorybook(client, 'c')).rejects.toMatchObject({ kind: 'invalid_response' });
    }
  });

  it('escapes the child id, and refuses an empty one before any request', async () => {
    const { client, request } = clientReturning(body);
    await getStorybook(client, 'a/b?c');
    expect(request).toHaveBeenCalledWith('GET', 'children/a%2Fb%3Fc/castle/storybook/');
    request.mockClear();
    await expect(getStorybook(client, '')).rejects.toBeInstanceOf(ApiError);
    expect(request).not.toHaveBeenCalled();
  });

  it('passes a server refusal straight through', async () => {
    const refusal = new ApiError('not_found');
    const request = vi.fn().mockRejectedValue(refusal);
    await expect(getStorybook({ request } as unknown as ApiClient, 'c')).rejects.toBe(refusal);
  });
});

describe('storybookApiFor', () => {
  it('is undefined without the Django API, and has a getter with it', () => {
    expect(storybookApiFor('c', { enabled: false })).toBeUndefined();
    expect(typeof storybookApiFor('c', { enabled: true, baseUrl: '' })?.get).toBe('function');
  });
});
