/**
 * Skill progress, through `react/src/api/mastery.ts` (LAI-0501B). Names
 * and signatures are the ones the app already used.
 */
import { masteryApi } from '../../api/mastery';

export type { SkillProgress } from '../../api/mastery';

export const { listSkillProgress, upsertSkillProgress } = masteryApi;
