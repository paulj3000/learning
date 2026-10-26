import * as amplify from './amplify/rewards';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read } from './parse';
import { selectApi } from './select';
import type { ChildInventoryState } from '../features/rewards/inventoryState';

export type { ChildInventoryRow } from './amplify/rewards';

/**
 * The child's backpack and reward grants (Phase 24).
 *
 * - Amplify: the client resolves reward rules and writes the backpack
 *   (`grantRewards`), idempotent by rule.
 * - Django: the server is the only one that grants anything, inside the
 *   answer that earns it (Treasure Rush's reward rule; docs/PLAY_API.md).
 *   So `grantRewards` and `clearInventory` are `rewards_unavailable`: the
 *   client can never grant itself a reward or keep a ledger. `getInventory`
 *   reads `GET /children/{id}/inventory/`. Its `grantedRuleIds` is always
 *   empty there: that list is the Amplify client's grant ledger, which the
 *   Django server keeps to itself.
 */
export interface RewardsApi {
  getInventory(childProfileId: string): Promise<ChildInventoryState>;
  grantRewards: typeof amplify.grantRewards;
  clearInventory: typeof amplify.clearInventory;
}

export function createDjangoRewards(client: ApiClient): Partial<RewardsApi> {
  return {
    async getInventory(childProfileId) {
      if (!childProfileId) throw new ApiError('invalid_request', { code: 'empty_id' });
      const response = await client.request(
        'GET',
        `children/${encodeURIComponent(childProfileId)}/inventory/`,
      );
      const { itemIds, truncated } = read(response.data, (r) => ({
        itemIds: r.field('items').array((entry) => entry.field('item').field('itemId').string()),
        truncated: r.field('truncated').boolean(),
      }));
      // A partial backpack would read as "this child does not own that".
      if (truncated) throw new ApiError('unsupported', { code: 'inventory_truncated' });
      return { ownedItemIds: Object.freeze([...new Set(itemIds)]), grantedRuleIds: [] };
    },
  };
}

export const rewardsApi: RewardsApi = selectApi<RewardsApi>('rewards', {
  amplify: {
    getInventory: amplify.getInventory,
    grantRewards: amplify.grantRewards,
    clearInventory: amplify.clearInventory,
  },
  django: (client) => createDjangoRewards(client),
});
