import * as amplify from './amplify/discovery';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read } from './parse';
import { optionalQuestUpdates } from './questUpdates';
import { parseRewardOutcome } from './rewards';
import { selectApi } from './select';
import { ISLAND_DISCOVERIES } from '../features/discovery/content';
import type { DiscoveryOutcomeStatus } from '../features/discovery/discovery';

export type { ChildWorldStateRow, DiscoveryResult } from './amplify/discovery';

/**
 * Exploration state: discoveries, characters met, the last checkpoint.
 *
 * - Amplify: the client resolves discoveries and writes the world state and their rewards.
 * - Django (LAI-0605): `recordDiscovery` is `POST /children/{id}/discoveries/{discoveryId}/`.
 *   The server checks the secret's requirements against its own records and records it once,
 *   with its world change, rewards and quest. `listDiscoveries` is the found secrets
 *   (`GET .../discoveries/`). There is no Django route for characters met or checkpoints yet,
 *   so `getWorldState`, `recordCharacterMet` and `saveCheckpoint` are `discovery_unavailable`,
 *   like the client-side context and clearing.
 */
export interface FoundDiscovery {
  discoveryId: string;
  title: string;
  kind: string;
  locationSlug: string;
}

export interface DiscoveryApi {
  getWorldState: typeof amplify.getWorldState;
  buildDiscoveryContext: typeof amplify.buildDiscoveryContext;
  recordDiscovery: typeof amplify.recordDiscovery;
  recordCharacterMet: typeof amplify.recordCharacterMet;
  saveCheckpoint: typeof amplify.saveCheckpoint;
  clearWorldState: typeof amplify.clearWorldState;
  listDiscoveries(childProfileId: string): Promise<FoundDiscovery[]>;
}

const STATUSES: readonly DiscoveryOutcomeStatus[] = ['FOUND_NOW', 'ALREADY_FOUND', 'LOCKED'];

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoDiscovery(client: ApiClient): Partial<DiscoveryApi> {
  return {
    async recordDiscovery(childProfileId, definition) {
      const response = await client.request(
        'POST',
        `children/${segment(childProfileId)}/discoveries/${segment(definition.id)}/`,
      );
      return read(response.data, (r) => {
        const rewards = parseRewardOutcome(r.field('rewards'));
        const startedQuestId = r.field('startedQuestId').nullable((x) => x.string());
        optionalQuestUpdates(r); // validated; the existing result shape has no field for it
        return {
          outcome: {
            discoveryId: r.field('discoveryId').string(),
            title: r.field('title').string(),
            status: r.field('status').oneOf(STATUSES),
            message: r.field('message').string(),
          },
          rewardMessages: rewards.grants.map((grant) => grant.message),
          newItemIds: rewards.newItems.map((item) => item.itemId),
          ...(startedQuestId ? { startedQuestId } : {}),
        };
      });
    },
    async listDiscoveries(childProfileId) {
      const response = await client.request('GET', `children/${segment(childProfileId)}/discoveries/`);
      return read(response.data, (r) =>
        r.field('discoveries').array((d) => ({
          discoveryId: d.field('discoveryId').string(),
          title: d.field('title').string(),
          kind: d.field('kind').string(),
          locationSlug: d.field('locationSlug').string(),
        })),
      );
    },
  };
}

/** Amplify: the found ids from the world state, described by the bundled content. */
async function amplifyListDiscoveries(childProfileId: string): Promise<FoundDiscovery[]> {
  const { discoveredIds } = await amplify.getWorldState(childProfileId);
  return discoveredIds
    .map((id) => ISLAND_DISCOVERIES.find((definition) => definition.id === id))
    .filter((definition) => definition !== undefined)
    .map((definition) => ({
      discoveryId: definition.id,
      title: definition.title,
      kind: definition.kind,
      locationSlug: definition.locationSlug,
    }));
}

export const discoveryApi: DiscoveryApi = selectApi<DiscoveryApi>('discovery', {
  amplify: {
    getWorldState: amplify.getWorldState,
    buildDiscoveryContext: amplify.buildDiscoveryContext,
    recordDiscovery: amplify.recordDiscovery,
    recordCharacterMet: amplify.recordCharacterMet,
    saveCheckpoint: amplify.saveCheckpoint,
    clearWorldState: amplify.clearWorldState,
    listDiscoveries: amplifyListDiscoveries,
  },
  django: (client) => createDjangoDiscovery(client),
});
