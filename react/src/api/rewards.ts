import * as amplify from './amplify/rewards';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { selectApi } from './select';
import type { ChildInventoryState } from '../features/rewards/inventoryState';
import { ALL_ITEMS, ALL_REWARD_RULES } from '../features/rewards/content';

export type { ChildInventoryRow } from './amplify/rewards';

/**
 * The child's backpack and reward grants (Phase 24).
 *
 * - Amplify: the client resolves reward rules and writes the backpack
 *   (`grantRewards`), idempotent by rule.
 * - Django: the server is the only one that grants anything, inside the
 *   answer or completion that earns it (LAI-0604; Treasure Rush's chest;
 *   docs/PLAY_API.md, "Rewards"). What an event earned comes back on its
 *   own response (`RewardOutcome`); the history is `GET .../rewards/`.
 *   So `grantRewards` and `clearInventory` are `rewards_unavailable`: the
 *   client can never grant itself a reward or keep a ledger. `getInventory`
 *   reads `GET /children/{id}/inventory/`. Its `grantedRuleIds` is always
 *   empty there: that list is the Amplify client's grant ledger, which the
 *   Django server keeps to itself.
 */
/** An item as both backends describe it to a child (the play API's item shape). */
export interface RewardItem {
  itemId: string;
  displayName: string;
  description: string;
  category: string;
  /** An asset id for the resolver, or empty: draw a placeholder (ADR-030). */
  assetId: string;
}

/** One reward rule that fired for the child (LAI-0604). */
export interface RewardGrantView {
  /** Django: the grant's UUID. Amplify, which keeps no grant rows: the rule id. */
  grantId: string;
  ruleId: string;
  /** The trigger type that fired it, e.g. `ADVENTURE_COMPLETED` or `WORLD_CHANGE`. */
  source: string;
  /** The authored line to celebrate with. */
  message: string;
  /** Every item the rule gives, whether or not the child already owned it. */
  items: RewardItem[];
  /** Null on Amplify, which keeps no grant time. */
  grantedAt: string | null;
}

/**
 * What one gameplay event earned, on Django answer and completion responses (`rewards`).
 * `newItems` is what to show as just found; it is empty on a replayed request, whose grants
 * all have `newlyGranted: false`.
 */
export interface RewardOutcome {
  grants: Array<RewardGrantView & { newlyGranted: boolean }>;
  newItems: RewardItem[];
}

export const NO_REWARDS: RewardOutcome = { grants: [], newItems: [] };

function parseItem(r: Reader): RewardItem {
  return {
    itemId: r.field('itemId').string(),
    displayName: r.field('displayName').string(),
    description: r.field('description').string(),
    category: r.field('category').string(),
    assetId: r.field('assetId').string(),
  };
}

function parseGrant(r: Reader): RewardGrantView {
  return {
    grantId: r.field('grantId').string(),
    ruleId: r.field('ruleId').string(),
    source: r.field('source').string(),
    message: r.field('message').string(),
    items: r.field('items').array(parseItem),
    grantedAt: r.field('grantedAt').nullable((x) => x.string()),
  };
}

/** The `rewards` object of a Django answer or completion response. */
export function parseRewardOutcome(r: Reader): RewardOutcome {
  return {
    grants: r.field('grants').array((g) => ({
      ...parseGrant(g),
      newlyGranted: g.field('newlyGranted').boolean(),
    })),
    newItems: r.field('newItems').array(parseItem),
  };
}

export interface RewardsApi {
  getInventory(childProfileId: string): Promise<ChildInventoryState>;
  /** Every reward rule that has fired for this child; newest first where the backend knows. */
  listRewardGrants(childProfileId: string): Promise<RewardGrantView[]>;
  /** One grant, or null when it is unknown or not this child's. */
  getRewardGrant(childProfileId: string, grantId: string): Promise<RewardGrantView | null>;
  grantRewards: typeof amplify.grantRewards;
  clearInventory: typeof amplify.clearInventory;
}

// Amplify keeps only the fired rule ids; the authored rule and items are bundled content.
function amplifyGrantView(ruleId: string): RewardGrantView | null {
  const rule = ALL_REWARD_RULES.find((candidate) => candidate.id === ruleId);
  if (!rule) return null;
  const items = rule.itemIds
    .map((itemId) => ALL_ITEMS.find((item) => item.id === itemId))
    .filter((item) => item !== undefined)
    .map((item) => ({
      itemId: item.id,
      displayName: item.displayName,
      description: item.description,
      category: item.category,
      assetId: '',
    }));
  return {
    grantId: rule.id,
    ruleId: rule.id,
    source: rule.trigger.type,
    message: rule.message,
    items,
    grantedAt: null,
  };
}

async function amplifyListRewardGrants(childProfileId: string): Promise<RewardGrantView[]> {
  const { grantedRuleIds } = await amplify.getInventory(childProfileId);
  return grantedRuleIds
    .map(amplifyGrantView)
    .filter((grant): grant is RewardGrantView => grant !== null);
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoRewards(client: ApiClient): Partial<RewardsApi> {
  return {
    async listRewardGrants(childProfileId) {
      const response = await client.request('GET', `children/${segment(childProfileId)}/rewards/`);
      return read(response.data, (r) => r.field('rewards').array(parseGrant));
    },

    async getRewardGrant(childProfileId, grantId) {
      try {
        const response = await client.request(
          'GET',
          `children/${segment(childProfileId)}/rewards/${segment(grantId)}/`,
        );
        return read(response.data, parseGrant);
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'not_found') return null;
        throw error;
      }
    },

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
    listRewardGrants: amplifyListRewardGrants,
    getRewardGrant: async (childProfileId, grantId) =>
      (await amplifyListRewardGrants(childProfileId)).find((g) => g.grantId === grantId) ?? null,
    grantRewards: amplify.grantRewards,
    clearInventory: amplify.clearInventory,
  },
  django: (client) => createDjangoRewards(client),
});
