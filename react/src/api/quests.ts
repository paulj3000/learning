import * as amplify from './amplify/quests';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { selectApi } from './select';
import type { QuestState } from '../features/quests/types';

export { optionalQuestUpdates, parseQuestUpdate, type QuestUpdateView } from './questUpdates';

export type { ChildQuestStateRow, QuestProgressResult } from './amplify/quests';

/**
 * Quest state (Phase 25).
 *
 * - Amplify: the client advances quests from its own records (`syncQuestProgress`).
 * - Django (LAI-0605): quests advance on the server, inside the event that earns progress
 *   (a step answer, a completion, a conversation, a discovery). Those responses carry
 *   `questUpdates`. `listQuestStates` reads `GET /children/{id}/quests/`, and `startQuest`
 *   is `POST /children/{id}/quests/{questId}/accept/`, which checks prerequisites and age band
 *   on the server. `buildQuestContext`, `syncQuestProgress` and `clearQuestStates` are
 *   `quests_unavailable`: the client neither computes nor writes quest progress there.
 */
export interface QuestsApi {
  listQuestStates(childProfileId: string): Promise<QuestState[]>;
  buildQuestContext: typeof amplify.buildQuestContext;
  startQuest: typeof amplify.startQuest;
  syncQuestProgress: typeof amplify.syncQuestProgress;
  clearQuestStates: typeof amplify.clearQuestStates;
}

/** A Django quest entry with progress, as the quest state the app already keeps. */
export function parseQuestState(r: Reader): QuestState | null {
  const status = r.field('status').string();
  if (status !== 'ACTIVE' && status !== 'COMPLETED') return null; // AVAILABLE or LOCKED
  const completedAt = r.field('completedAt').nullable((x) => x.string());
  return {
    questId: r.field('questId').string(),
    status,
    currentStageId: r.field('currentStageId').string(),
    completedStageIds: r.field('completedStageIds').array((x) => x.string()),
    completedObjectiveIds: r.field('completedObjectiveIds').array((x) => x.string()),
    startedAt: r.field('startedAt').string(),
    ...(completedAt ? { completedAt } : {}),
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoQuests(client: ApiClient): Partial<QuestsApi> {
  return {
    async listQuestStates(childProfileId) {
      const response = await client.request('GET', `children/${segment(childProfileId)}/quests/`);
      const states = read(response.data, (r) => r.field('quests').array(parseQuestState));
      return states.filter((state): state is QuestState => state !== null);
    },
    async startQuest(childProfileId, definition) {
      const response = await client.request(
        'POST',
        `children/${segment(childProfileId)}/quests/${segment(definition.id)}/accept/`,
      );
      const state = read(response.data, parseQuestState);
      if (!state) throw new ApiError('invalid_response', { code: 'quest_not_started' });
      return state;
    },
  };
}

export const questsApi: QuestsApi = selectApi<QuestsApi>('quests', {
  amplify: {
    listQuestStates: amplify.listQuestStates,
    buildQuestContext: amplify.buildQuestContext,
    startQuest: amplify.startQuest,
    syncQuestProgress: amplify.syncQuestProgress,
    clearQuestStates: amplify.clearQuestStates,
  },
  django: (client) => createDjangoQuests(client),
});
