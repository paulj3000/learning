import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import * as rewardsApi from './api';

const REWARDS = 'children/child-1/rewards/';
let api: FakeDjangoClient;

beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('the backpack on Django (AMP-03)', () => {
  it('reads owned items and granted rules, de-duplicating ids', async () => {
    api.on('GET', REWARDS, {
      ownedItemIds: ['shell', 'shell', 'hat'],
      grantedRuleIds: ['reward-quiet-places'],
    });
    await expect(rewardsApi.getInventory('child-1')).resolves.toEqual({
      ownedItemIds: ['shell', 'hat'],
      grantedRuleIds: ['reward-quiet-places'],
    });
  });

  it('rejects a response that does not match the contract', async () => {
    api.on('GET', REWARDS, { ownedItemIds: [] });
    await expect(rewardsApi.getInventory('child-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('a parent clears the backpack with one DELETE', async () => {
    api.on('DELETE', REWARDS, null);
    await rewardsApi.clearInventory('child-1');
    expect(api.calls).toEqual([{ method: 'DELETE', path: REWARDS }]);
  });

  it('has no way to grant from the client: the server grants what it decided was earned', () => {
    expect(Object.keys(rewardsApi)).not.toContain('grantRewards');
  });
});
