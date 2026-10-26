/**
 * NPC relationship state, through `react/src/api/npc.ts` (LAI-0501B). Names
 * and signatures are the ones the app already used.
 */
import { npcApi } from '../../api/npc';

export type { ChildNpcState, RecordDialogueResult } from '../../api/npc';

export const {
  getNpcState,
  listNpcStates,
  recordDialogueNode,
  setNpcMemoryFlagsForQuest,
  clearNpcState,
} = npcApi;

export { initialRelationshipState } from './relationship';
