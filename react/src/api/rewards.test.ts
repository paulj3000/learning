import { describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  getInventory: vi.fn(),
  grantRewards: vi.fn(),
  clearInventory: vi.fn(),
}));
vi.mock('./amplify/rewards', () => amplify);

import { createDjangoRewards, type RewardsApi } from './rewards';
import { selectApi } from './select';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, doubloonJson, errorJson, jsonResponse } from '../test/playFixtures';

describe('Django inventory read', () => {
  it('reads the backpack from the child-scoped inventory route', async () => {
    const { client, call } = djangoTestClient(
      jsonResponse(200, {
        items: [
          { item: doubloonJson, grantedAt: '2026-10-25T10:05:00Z' },
          { item: doubloonJson, grantedAt: '2026-10-25T10:04:00Z' },
        ],
        truncated: false,
      }),
    );
    const api = createDjangoRewards(client) as Required<Pick<RewardsApi, 'getInventory'>>;
    await expect(api.getInventory(CHILD_A)).resolves.toEqual({
      ownedItemIds: ['golden-doubloon'],
      grantedRuleIds: [],
    });
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/inventory/`,
      method: 'GET',
    });
  });

  it('refuses a truncated backpack rather than showing part of it as all of it', async () => {
    const { client } = djangoTestClient(jsonResponse(200, { items: [], truncated: true }));
    await expect(createDjangoRewards(client).getInventory?.(CHILD_A)).rejects.toMatchObject({
      kind: 'unsupported',
      code: 'inventory_truncated',
    });
  });

  it('reports another family’s child as not found', async () => {
    const { client } = djangoTestClient(jsonResponse(404, errorJson('not_found')));
    await expect(createDjangoRewards(client).getInventory?.(CHILD_A)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });
});

describe('reward authorization boundary', () => {
  it('never lets a Django build grant or clear rewards from the client', async () => {
    const api = selectApi<RewardsApi>(
      'rewards',
      { amplify, django: (client) => createDjangoRewards(client) },
      { backend: 'django', baseUrl: 'https://lai.example' },
    );
    await expect(
      api.grantRewards(CHILD_A, { type: 'QUEST_COMPLETED', questId: 'q' }, [], [], []),
    ).rejects.toMatchObject({ kind: 'unsupported', code: 'rewards_unavailable' });
    await expect(api.clearInventory(CHILD_A)).rejects.toMatchObject({ kind: 'unsupported' });
    expect(amplify.grantRewards).not.toHaveBeenCalled();
    expect(amplify.clearInventory).not.toHaveBeenCalled();
  });

  it('keeps the Amplify reward engine on an Amplify build', () => {
    const api = selectApi<RewardsApi>('rewards', { amplify }, { backend: 'amplify' });
    expect(api).toBe(amplify);
  });
});
