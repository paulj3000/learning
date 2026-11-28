import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { capabilityRequestsFromManifest, defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER } from '@lai/game-engine/services';
import { FOSSIL_RIDGE_CAMP_MANIFEST } from '../manifests/fossilRidgeCamp';

/**
 * Fossil Ridge Camp as an engine location definition (LAI-2206).
 *
 * Declaration only, like the other GE-075 definitions: the live view runs on
 * `createLocationEngine` from the manifest. The manifest authors no
 * `movement` or `player` block, so the camp plays with the engine defaults.
 * It authors no platforming and no jumpable collider, so nothing in it needs
 * a jump (LAI-JMP-01b: the camp does not use jumping).
 *
 * - `id` is the manifest `regionId` (`fossil-ridge-camp`).
 * - `requiredServices`: only the asset manager (`toolbox`, `rock`, `signpost`).
 *   There are no NPCs, sounds, quests or questions here.
 * - `engineApi` is a range that admits the 0.x line, so the definition keeps
 *   validating when the engine API minor version moves.
 */
const adapted = capabilityRequestsFromManifest({
  movement: FOSSIL_RIDGE_CAMP_MANIFEST.movement,
  player: FOSSIL_RIDGE_CAMP_MANIFEST.player,
});

/** Anything the engine cannot express from this manifest; empty today. */
export const FOSSIL_RIDGE_CAMP_ADAPTER_ISSUES = adapted.issues;

export const FOSSIL_RIDGE_CAMP_LOCATION = defineLocation(
  {
    id: FOSSIL_RIDGE_CAMP_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '>=0.1.0 <1.0.0',
    contentSource: 'MANIFEST',
    capabilities: adapted.requests,
    requiredServices: [ASSET_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
