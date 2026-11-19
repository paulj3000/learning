/**
 * NPC Manager port. The engine reads NPC definitions by id and refers to approach and
 * interaction lines **by reference only** (a `lineRef` the host resolves to authored or
 * server-chosen dialogue). No literal dialogue text, and no outcome, ever passes through the
 * engine (NPC standard: the server chooses dialogue and owns progress).
 */

import { defineService } from '../core/services';

export interface NpcDefinition {
  npcId: string;
  displayNameKey: string;
  /** Voice profile id, or null when the NPC is silent. */
  voiceProfile: string | null;
  ageBands: string[];
  /** Model asset reference resolved through the Asset Manager. */
  modelAssetId: string;
  /** Reference to the line the NPC shows when the child approaches. */
  approachLineRef: string | null;
  /** interactionId -> line reference. */
  interactionLineRefs: Readonly<Record<string, string>>;
}

export interface NpcManagerPort {
  get(npcId: string): NpcDefinition | undefined;
  list(): readonly NpcDefinition[];
}

export const NPC_MANAGER = defineService<NpcManagerPort>('lai.npcManager');

export function createFakeNpcManager(npcs: readonly NpcDefinition[] = []): NpcManagerPort {
  const byId = new Map(npcs.map((npc) => [npc.npcId, npc] as const));
  return {
    get: (npcId) => byId.get(npcId),
    list: () => [...byId.values()],
  };
}
