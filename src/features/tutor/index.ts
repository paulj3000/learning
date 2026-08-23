/**
 * AI Tutor Engine (docs/ROADMAP.md Phase 27). Pure domain first,
 * persistence last, same layout as `src/features/npc/` and
 * `src/features/quests/`. Content lives under `./content`.
 */
export * from './types';
export * from './strategy';
export * from './context';
export * from './schema';
export * from './fallback';
export * from './presentation';
export { requestTutorTurn, type RequestTutorTurnInput, type TutorTurnResult } from './api';
export { useTutorTurn, type TutorTurnState, type UseTutorTurn } from './useTutorTurn';
export { allowedVocabularyForSkill, CURRICULUM_TERMS, SKILL_VOCABULARY } from './content';
