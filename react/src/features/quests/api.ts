/**
 * Quest state, through `react/src/api/quests.ts` (LAI-0501B). Names and
 * signatures are the ones the app already used.
 */
import { questsApi } from '../../api/quests';

export type {
  ChildQuestStateRow,
  QuestProgressResult,
  QuestUpdateView,
} from '../../api/quests';

export const {
  listQuestStates,
  buildQuestContext,
  startQuest,
  syncQuestProgress,
  clearQuestStates,
} = questsApi;
