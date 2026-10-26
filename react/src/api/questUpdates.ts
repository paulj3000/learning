import type { Reader } from './parse';
import type { QuestStatus } from '../features/quests/types';

/**
 * The `questUpdates` field of Django responses (LAI-0605), in a module of its own so that the
 * adventure, NPC and discovery adapters can read it without importing the quest adapter (which
 * would close an import cycle through the Amplify quest code).
 */

/** What one server event did to a quest (`questUpdates` on Django responses). */
export interface QuestUpdateView {
  questId: string;
  status: QuestStatus;
  currentStageId: string;
  justCompleted: boolean;
  newlyCompletedObjectiveIds: string[];
}

const STATUSES: readonly QuestStatus[] = ['ACTIVE', 'COMPLETED'];

export function parseQuestUpdate(r: Reader): QuestUpdateView {
  return {
    questId: r.field('questId').string(),
    status: r.field('status').oneOf(STATUSES),
    currentStageId: r.field('currentStageId').string(),
    justCompleted: r.field('justCompleted').boolean(),
    newlyCompletedObjectiveIds: r.field('newlyCompletedObjectiveIds').array((x) => x.string()),
  };
}

/** An optional additive `questUpdates` field: parsed when the server sends it. */
export function optionalQuestUpdates(r: Reader): QuestUpdateView[] | undefined {
  const field = r.field('questUpdates');
  return field.value === undefined ? undefined : field.array(parseQuestUpdate);
}
