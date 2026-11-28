import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { capabilityRequestsFromManifest, defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER, SOUND_MANAGER } from '@lai/game-engine/services';
import { STORYKEEPER_CASTLE_MANIFEST } from '../manifests/storykeeperCastle';

/**
 * Storykeeper Castle as validated engine data (GE-072). It declares what the castle plays with
 * today, as capability requests derived from its manifest's movement and player blocks (which
 * read `castleEngineProfile.ts`): walking and the gentler indoor run and sprint, the optional
 * 0.9 m jump, the indoor third-person camera held under the 3.1 m ceiling with collision
 * avoidance, and the child's avatar with animation. The runtime swap (GE-076) then changes
 * nothing a child can feel.
 *
 * Jumping is a shared capability here, tuned for the castle and never required: no learning
 * step, door, page or exit needs it (owner, 2026-11-18; `CASTLE_MOVEMENT_BY_BAND`).
 *
 * Gameplay, collision, rooms, doors, NPC placement, adventures and the Great Storybook stay in
 * the manifest and the `castle-tale` extension until GE-076 (LAI-0805: shipped layouts stay in
 * manifests).
 *
 * requiredServices: Asset Manager (castle models and kit), NPC Manager (Keeper Quill, Professor
 * Orion, Ember), Sound Manager (room ambience, cues and narration, SC-R06).
 */
const { requests, issues } = capabilityRequestsFromManifest({
  movement: STORYKEEPER_CASTLE_MANIFEST.movement,
  player: STORYKEEPER_CASTLE_MANIFEST.player,
});

/** Anything the manifest set that the engine cannot express. Empty today; a parity test pins it. */
export const STORYKEEPER_CASTLE_ADAPTER_ISSUES = issues;

export const STORYKEEPER_CASTLE_LOCATION = defineLocation(
  {
    id: STORYKEEPER_CASTLE_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '>=0.1.0 <1.0.0',
    contentSource: 'MANIFEST',
    capabilities: requests,
    requiredServices: [ASSET_MANAGER.id, NPC_MANAGER.id, SOUND_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
