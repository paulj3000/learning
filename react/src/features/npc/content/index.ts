import type { NpcDefinition } from '../types';
import { CLOCKWORK_HARBOR_NPCS } from './clockworkHarborNpcs';
import { ISLAND_NPCS } from './islandNpcs';

export * from './islandNpcs';
export * from './clockworkHarborNpcs';

/**
 * Every authored NPC, across every region.
 *
 * `findNpc` used to live in `islandNpcs.ts` and search only that file's cast,
 * which was fine while there was one. Clockwork Harbor's cast is authored
 * separately (regions own their content, per the world content-pack rule), and
 * a lookup that could not see it would have let `NpcConversation` open a panel
 * for the Harbor Master and find nobody home. The registry belongs here, above
 * both files, for the same reason `ADVENTURE_TEMPLATES` does.
 */
export const ALL_NPCS: NpcDefinition[] = [...ISLAND_NPCS, ...CLOCKWORK_HARBOR_NPCS];

export function findNpc(npcId: string): NpcDefinition | null {
  return ALL_NPCS.find((npc) => npc.id === npcId) ?? null;
}
