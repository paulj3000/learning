/**
 * Quest Service port. Quest state is read-only to the engine; the only write is a step
 * completion **claim**, which the server confirms or refuses (Django owns quest progress).
 * The resolved state comes back so the engine presents what the server decided.
 */

import { defineService } from '../core/services';

export type QuestStatus = 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED';

export interface QuestState {
  questId: string;
  status: QuestStatus;
  activeStepId: string | null;
  completedStepIds: readonly string[];
}

export interface QuestServicePort {
  /** Current server-confirmed state, or undefined when the quest is unknown. */
  getQuest(questId: string): QuestState | undefined;
  /** Claims a step done. Resolves with the server's resulting state (which may be unchanged). */
  claimStepComplete(questId: string, stepId: string): Promise<QuestState>;
  subscribe(listener: (state: QuestState) => void): () => void;
}

export const QUEST_SERVICE = defineService<QuestServicePort>('lai.questService');

export interface FakeQuestService extends QuestServicePort {
  readonly claims: { questId: string; stepId: string }[];
}

/** The fake confirms a claim when the step is the active one, like a well-behaved server. */
export function createFakeQuestService(
  quests: readonly (QuestState & { stepOrder?: readonly string[] })[] = [],
): FakeQuestService {
  const states = new Map(quests.map((q) => [q.questId, { ...q }] as const));
  const order = new Map(quests.map((q) => [q.questId, q.stepOrder ?? []] as const));
  const listeners = new Set<(state: QuestState) => void>();
  const claims: FakeQuestService['claims'] = [];
  return {
    claims,
    getQuest: (questId) => states.get(questId),
    async claimStepComplete(questId, stepId) {
      claims.push({ questId, stepId });
      const state = states.get(questId);
      if (!state) {
        throw new Error(`Unknown quest "${questId}"`);
      }
      if (state.activeStepId === stepId && state.status === 'ACTIVE') {
        const steps = order.get(questId) ?? [];
        const next = steps[steps.indexOf(stepId) + 1] ?? null;
        const updated: QuestState = {
          questId,
          status: next === null ? 'COMPLETED' : 'ACTIVE',
          activeStepId: next,
          completedStepIds: [...state.completedStepIds, stepId],
        };
        states.set(questId, updated);
        for (const listener of [...listeners]) {
          listener(updated);
        }
        return updated;
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
