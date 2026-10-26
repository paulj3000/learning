/**
 * Exploration state, through `react/src/api/discovery.ts` (LAI-0501B). Names
 * and signatures are the ones the app already used.
 */
import { discoveryApi } from '../../api/discovery';
import { ISLAND_DISCOVERIES } from './content';
import type { DiscoveryDefinition, DiscoveryId } from './types';

export type { ChildWorldStateRow, DiscoveryResult } from '../../api/discovery';

export type { FoundDiscovery } from '../../api/discovery';

export const {
  listDiscoveries,
  getWorldState,
  buildDiscoveryContext,
  recordDiscovery,
  recordCharacterMet,
  saveCheckpoint,
  clearWorldState,
} = discoveryApi;

/** Looks up an authored discovery by the id a `DISCOVER` world action names. */
export function getDiscoveryDefinition(discoveryId: DiscoveryId): DiscoveryDefinition | undefined {
  return ISLAND_DISCOVERIES.find((discovery) => discovery.id === discoveryId);
}
