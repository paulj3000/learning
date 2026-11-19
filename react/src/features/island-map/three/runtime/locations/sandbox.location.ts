import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER } from '@lai/game-engine/services';

/**
 * The Phase 31 sandbox as validated engine data (GE-075). Unlike the manifest locations, the
 * sandbox has no manifest: `sandboxScene.ts` builds its own `FirstPersonController` with the
 * defaults (no jump, locomotion or footprint tuning) and a first-person camera, and draws no
 * avatar. So its capabilities are declared here rather than derived from a manifest: default
 * walking and jumping, first-person view only. The runtime swap (GE-076) must keep exactly this.
 *
 * requiredServices: Asset Manager (the NPC model is an asset). It places one NPC directly from a
 * constant, not through the NPC Manager.
 */
export const SANDBOX_REGION_ID = 'phase31-sandbox';

export const SANDBOX_LOCATION = defineLocation(
  {
    id: SANDBOX_REGION_ID,
    version: '1.0.0',
    engineApi: '^0.1.0',
    contentSource: 'MANIFEST',
    capabilities: [
      { id: 'movement.locomotion', config: {} },
      { id: 'movement.jump', config: {} },
      { id: 'camera.firstPerson', config: {} },
    ],
    requiredServices: [ASSET_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
