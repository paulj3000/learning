/**
 * Skill progress, through `react/src/api/mastery.ts` (LAI-0501B, LAI-0603).
 * Names and signatures are the ones the app already used, plus the
 * server-evaluated reads `listMastery` and `getMastery`.
 */
import { masteryApi } from '../../api/mastery';

export type { MasteryEntry, SkillProgress } from '../../api/mastery';

export const { listSkillProgress, upsertSkillProgress, listMastery, getMastery } = masteryApi;
