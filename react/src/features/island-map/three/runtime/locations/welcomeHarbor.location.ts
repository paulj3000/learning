import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { capabilityRequestsFromManifest, defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER } from '@lai/game-engine/services';
import { WELCOME_HARBOR_MANIFEST } from '../manifests/welcomeHarbor';

/**
 * welcomeHarbor as validated engine data (GE-075, batch 1). It declares what the location plays with
 * today (the movement and player blocks of its manifest, as capability requests), so the runtime
 * swap (GE-076) changes nothing a child can feel. Gameplay, collision, NPCs, audio and assets
 * stay in the manifest and its extensions.
 *
 * requiredServices: Asset Manager (every model is an asset id) and NPC Manager (Pip). No Sound Manager: no audio in the manifest or an extension.
 */
const { requests, issues } = capabilityRequestsFromManifest({
  movement: WELCOME_HARBOR_MANIFEST.movement,
  player: WELCOME_HARBOR_MANIFEST.player,
});

/** Anything the manifest set that the engine cannot express. Empty today; a parity test pins it. */
export const WELCOME_HARBOR_ADAPTER_ISSUES = issues;

export const WELCOME_HARBOR_LOCATION = defineLocation(
  {
    id: WELCOME_HARBOR_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '^0.1.0',
    contentSource: 'MANIFEST',
    capabilities: requests,
    requiredServices: [ASSET_MANAGER.id, NPC_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
