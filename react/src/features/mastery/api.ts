import { childPath, djangoClient } from '../../api/djangoClient';
import { read, type Reader } from '../../api/parse';
import type { ErrorPattern, SkillStatus } from './types';

/**
 * Skill progress, read from Django (`GET children/<id>/skill-progress/`, AMP-03).
 *
 * Mastery is server-side only: Django derives every row from evidence it graded itself
 * (`apps/education/mastery.py`, a port of `counters.ts`, `status.ts` and `errorPattern.ts`
 * pinned by the golden vectors), so the client has no way to write mastery numbers. The pure
 * modules here stay for read-time rules (`resolveSkillStatuses`, review decay) and the tests.
 */
export interface SkillProgress {
  childProfileId: string;
  learningObjectiveCode: string;
  exposureCount: number;
  independentSuccessCount: number;
  supportedSuccessCount: number;
  consecutiveIndependentCorrect: number;
  recentLevel: SkillStatus | null;
  errorPattern: ErrorPattern | null;
  lastPracticedAt: string | null;
}

const SKILL_STATUSES = ['LOCKED', 'INTRODUCED', 'DEVELOPING', 'PROFICIENT', 'MASTERED'] as const;
const ERROR_PATTERNS = ['NONE', 'NEEDS_SUPPORT', 'INCONSISTENT', 'STALLED'] as const;

function readSkill(r: Reader, childProfileId: string): SkillProgress {
  return {
    childProfileId,
    learningObjectiveCode: r.field('learningObjectiveCode').string(),
    exposureCount: r.field('exposureCount').integer(),
    independentSuccessCount: r.field('independentSuccessCount').integer(),
    supportedSuccessCount: r.field('supportedSuccessCount').integer(),
    consecutiveIndependentCorrect: r.field('consecutiveIndependentCorrect').integer(),
    recentLevel: r.field('recentLevel').nullable((v) => v.oneOf(SKILL_STATUSES)),
    errorPattern: r.field('errorPattern').nullable((v) => v.oneOf(ERROR_PATTERNS)),
    lastPracticedAt: r.field('lastPracticedAt').nullable((v) => v.string()),
  };
}

/** One row per (child, skill) the child has ever practiced (parent dashboard), newest first. */
export async function listSkillProgress(childProfileId: string): Promise<SkillProgress[]> {
  const response = await djangoClient().request(
    'GET',
    childPath(childProfileId, 'skill-progress/'),
  );
  return read(response.data, (r) =>
    r.field('skills').array((skill) => readSkill(skill, childProfileId)),
  );
}
