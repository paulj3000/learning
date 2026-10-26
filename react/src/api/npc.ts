import * as amplify from './amplify/npc';
import { selectApi } from './select';

export type { ChildNpcState, RecordDialogueResult } from './amplify/npc';

/**
 * NPC relationships and memory flags. Django has an `NpcRelationship` model
 * but no route (LAI-0605), so every operation is `npc_unavailable` there.
 */
export interface NpcApi {
  getNpcState: typeof amplify.getNpcState;
  listNpcStates: typeof amplify.listNpcStates;
  recordDialogueNode: typeof amplify.recordDialogueNode;
  setNpcMemoryFlagsForQuest: typeof amplify.setNpcMemoryFlagsForQuest;
  clearNpcState: typeof amplify.clearNpcState;
}

export const npcApi: NpcApi = selectApi<NpcApi>('npc', {
  amplify: {
    getNpcState: amplify.getNpcState,
    listNpcStates: amplify.listNpcStates,
    recordDialogueNode: amplify.recordDialogueNode,
    setNpcMemoryFlagsForQuest: amplify.setNpcMemoryFlagsForQuest,
    clearNpcState: amplify.clearNpcState,
  },
});
