/**
 * Data-Driven Quest Engine (docs/ROADMAP.md Phase 25).
 *
 * Public surface, mirroring how `src/features/npc/` and
 * `src/features/rewards/` expose themselves: pure domain first, persistence
 * last. Content lives under `./content`.
 */
export * from './types';
export * from './objectives';
export * from './quest';
export * from './journal';
export {
  buildQuestContext,
  clearQuestStates,
  listQuestStates,
  startQuest,
  syncQuestProgress,
  type ChildQuestStateRow,
  type QuestProgressResult,
} from './api';
export { QUEST_DEFINITIONS, getQuestDefinition, getQuestsOfferedBy } from './content';
