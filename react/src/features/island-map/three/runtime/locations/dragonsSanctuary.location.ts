import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { capabilityRequestsFromManifest, defineLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER } from '@lai/game-engine/services';
import { DRAGONS_SANCTUARY_MANIFEST } from '../manifests/dragonsSanctuary';

/**
 * The Dragon's Sanctuary as an engine location definition (GE-075, batch 2).
 *
 * Declaration only: the live view still runs on `createLocationEngine` from the manifest until
 * GE-076 swaps the runtime. This is what the location already plays with, derived from the
 * manifest's own `movement` and `player` blocks (it authors neither, so it plays with the
 * engine defaults: walk, run, sprint, jump, the third-person camera and the child's avatar),
 * so the swap changes nothing a child can feel.
 *
 * - `id` is the manifest `regionId` (`dragons-sanctuary`, `DRAGONS_SANCTUARY_REGION_ID`).
 * - `requiredServices` are the ports this location uses today: the asset manager (it loads
 *   `npc-pip`, `wall-stone`, `roof`, `ground-tile` and `rock`) and the NPC manager (Ember is
 *   a `TALK_TO` NPC). It plays no sound of its own, records world changes through the host,
 *   and has no quests, questions, inventory or multiplayer.
 */
const adapted = capabilityRequestsFromManifest({
  movement: DRAGONS_SANCTUARY_MANIFEST.movement,
  player: DRAGONS_SANCTUARY_MANIFEST.player,
});

/** Anything the engine cannot express from this manifest; empty today. */
export const DRAGONS_SANCTUARY_ADAPTER_ISSUES = adapted.issues;

export const DRAGONS_SANCTUARY_LOCATION = defineLocation(
  {
    id: DRAGONS_SANCTUARY_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '^0.1.0',
    contentSource: 'MANIFEST',
    capabilities: adapted.requests,
    requiredServices: [ASSET_MANAGER.id, NPC_MANAGER.id],
  },
  createStandardCapabilityRegistry(),
);
