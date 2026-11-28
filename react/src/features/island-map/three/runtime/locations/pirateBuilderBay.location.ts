import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { capabilityRequestsFromManifest, defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER } from '@lai/game-engine/services';
import { PIRATE_BUILDER_BAY_MANIFEST } from '../manifests/pirateBuilderBay';

/**
 * pirateBuilderBay as validated engine data (GE-075, batch 1). It declares what the location plays with
 * today (the movement and player blocks of its manifest, as capability requests), so the runtime
 * swap (GE-076) changes nothing a child can feel. Gameplay, collision, NPCs, audio and assets
 * stay in the manifest and its extensions.
 *
 * requiredServices: Asset Manager (asset ids) and NPC Manager (placed NPC). The Tide Trial extension uses no Sound Manager.
 */
const { requests, issues } = capabilityRequestsFromManifest({
  movement: PIRATE_BUILDER_BAY_MANIFEST.movement,
  player: PIRATE_BUILDER_BAY_MANIFEST.player,
});

/** Anything the manifest set that the engine cannot express. Empty today; a parity test pins it. */
export const PIRATE_BUILDER_BAY_ADAPTER_ISSUES = issues;

export const PIRATE_BUILDER_BAY_LOCATION = defineLocation(
  {
    id: PIRATE_BUILDER_BAY_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '>=0.1.0 <1.0.0',
    contentSource: 'MANIFEST',
    capabilities: requests,
    requiredServices: [ASSET_MANAGER.id, NPC_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
