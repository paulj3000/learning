import * as amplify from './amplify/quests';
import { selectApi } from './select';

export type { ChildQuestStateRow, QuestProgressResult } from './amplify/quests';

/**
 * Step-adventure quest state (Phase 25). On Amplify the client advances
 * quests from its own records. On Django quests advance on the server; the
 * only quest routes are Treasure Rush's play API (`quests/{id}/accept/`,
 * `api/play/playApi.ts`), which is a different contract, so every operation
 * here is `quests_unavailable` (LAI-0605).
 */
export interface QuestsApi {
  listQuestStates: typeof amplify.listQuestStates;
  buildQuestContext: typeof amplify.buildQuestContext;
  startQuest: typeof amplify.startQuest;
  syncQuestProgress: typeof amplify.syncQuestProgress;
  clearQuestStates: typeof amplify.clearQuestStates;
}

export const questsApi: QuestsApi = selectApi<QuestsApi>('quests', {
  amplify: {
    listQuestStates: amplify.listQuestStates,
    buildQuestContext: amplify.buildQuestContext,
    startQuest: amplify.startQuest,
    syncQuestProgress: amplify.syncQuestProgress,
    clearQuestStates: amplify.clearQuestStates,
  },
});
