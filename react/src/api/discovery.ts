import * as amplify from './amplify/discovery';
import { selectApi } from './select';

export type { ChildWorldStateRow, DiscoveryResult } from './amplify/discovery';

/**
 * Exploration state: discoveries, characters met, the last checkpoint, and
 * the rewards a discovery grants. Django has a `WorldState` model but no route
 * (LAI-0605), so every operation is `discovery_unavailable` there; the
 * client never grants itself a discovery reward on Django.
 */
export interface DiscoveryApi {
  getWorldState: typeof amplify.getWorldState;
  buildDiscoveryContext: typeof amplify.buildDiscoveryContext;
  recordDiscovery: typeof amplify.recordDiscovery;
  recordCharacterMet: typeof amplify.recordCharacterMet;
  saveCheckpoint: typeof amplify.saveCheckpoint;
  clearWorldState: typeof amplify.clearWorldState;
}

export const discoveryApi: DiscoveryApi = selectApi<DiscoveryApi>('discovery', {
  amplify: {
    getWorldState: amplify.getWorldState,
    buildDiscoveryContext: amplify.buildDiscoveryContext,
    recordDiscovery: amplify.recordDiscovery,
    recordCharacterMet: amplify.recordCharacterMet,
    saveCheckpoint: amplify.saveCheckpoint,
    clearWorldState: amplify.clearWorldState,
  },
});
