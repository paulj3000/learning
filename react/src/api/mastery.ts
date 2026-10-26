import * as amplify from './amplify/mastery';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { selectApi } from './select';
import { LEARNING_OBJECTIVES } from '../features/adventures/content/learningObjectives';
import { applyReviewDecay, computeSkillStatus } from '../features/mastery/status';
import { computeErrorPattern } from '../features/mastery/errorPattern';
import type { ErrorPattern, SkillStatus } from '../features/mastery/types';

/**
 * Per-skill mastery (DATA_MODEL.md SkillProgress, the Mastery Engine).
 *
 * - **Amplify:** the client computes and writes the rows (`upsertSkillProgress`).
 * - **Django (LAI-0603):** the server writes them while it grades a step's answer, and the
 *   client never writes (`upsertSkillProgress` is `mastery_unavailable`). Reads come from
 *   `GET /children/{id}/mastery/` and `GET /children/{id}/mastery/{objectiveId}/`:
 *   - `listSkillProgress` maps the server's rows onto the same row shape the screens
 *     already read;
 *   - `listMastery` and `getMastery` return the server's own status, review decay applied,
 *     which is what LAI-0505's dashboard and the Android app consume.
 *
 * The status rules are the golden-vector pair `features/mastery/status.ts` and
 * `lai/apps/education/mastery.py`, so both backends report the same status for the same
 * counters.
 */

/** One objective's counters, as either backend stores them. Amplify's records already fit. */
export interface SkillProgress {
  /** Amplify: the row id. Django: the objective code (unique per child). A display key. */
  id: string;
  learningObjectiveCode: string;
  exposureCount: number;
  independentSuccessCount: number;
  supportedSuccessCount: number;
  consecutiveIndependentCorrect: number;
  recentLevel?: SkillStatus | null;
  errorPattern?: ErrorPattern | null;
  lastPracticedAt?: string | null;
}

/** One objective's mastery as a parent's app shows it. `status` is null without evidence. */
export interface MasteryEntry {
  objectiveId: string;
  title: string;
  domain: string | null;
  hasEvidence: boolean;
  /** After review decay. */
  status: SkillStatus | null;
  /** As stored, before review decay. */
  rawStatus: SkillStatus | null;
  errorPattern: ErrorPattern | null;
  exposureCount: number;
  independentSuccessCount: number;
  supportedSuccessCount: number;
  consecutiveIndependentCorrect: number;
  lastPracticedAt: string | null;
}

export interface MasteryApi {
  listSkillProgress(childProfileId: string): Promise<SkillProgress[]>;
  upsertSkillProgress: typeof amplify.upsertSkillProgress;
  /** Every objective with evidence, most recently practised first. */
  listMastery(childProfileId: string): Promise<MasteryEntry[]>;
  /** One objective, also without evidence; null for an objective the catalog does not hold. */
  getMastery(childProfileId: string, objectiveId: string): Promise<MasteryEntry | null>;
}

// ---------------------------------------------------------------------------
// Amplify: the existing rows, evaluated with the existing rules

function amplifyEntry(code: string, row: SkillProgress | undefined, now: Date): MasteryEntry {
  const objective = LEARNING_OBJECTIVES.find((candidate) => candidate.code === code);
  const base = {
    objectiveId: code,
    title: objective?.title ?? code,
    domain: objective?.domain ?? null,
  };
  if (!row || row.exposureCount === 0) {
    return {
      ...base,
      hasEvidence: false,
      status: null,
      rawStatus: null,
      errorPattern: null,
      exposureCount: 0,
      independentSuccessCount: 0,
      supportedSuccessCount: 0,
      consecutiveIndependentCorrect: 0,
      lastPracticedAt: null,
    };
  }
  const counts = { ...row, lastPracticedAt: row.lastPracticedAt ?? null };
  const rawStatus = row.recentLevel ?? computeSkillStatus(counts, true);
  return {
    ...base,
    hasEvidence: true,
    status: applyReviewDecay(rawStatus, row.lastPracticedAt, now),
    rawStatus,
    errorPattern: row.errorPattern ?? computeErrorPattern(counts),
    exposureCount: row.exposureCount,
    independentSuccessCount: row.independentSuccessCount,
    supportedSuccessCount: row.supportedSuccessCount,
    consecutiveIndependentCorrect: row.consecutiveIndependentCorrect,
    lastPracticedAt: row.lastPracticedAt ?? null,
  };
}

const amplifyMastery: MasteryApi = {
  listSkillProgress: amplify.listSkillProgress,
  upsertSkillProgress: amplify.upsertSkillProgress,
  async listMastery(childProfileId) {
    const rows = await amplify.listSkillProgress(childProfileId);
    const now = new Date();
    return rows
      .filter((row) => row.exposureCount > 0)
      .map((row) => amplifyEntry(row.learningObjectiveCode, row, now));
  },
  async getMastery(childProfileId, objectiveId) {
    if (!LEARNING_OBJECTIVES.some((objective) => objective.code === objectiveId)) return null;
    const rows = await amplify.listSkillProgress(childProfileId);
    const row = rows.find((candidate) => candidate.learningObjectiveCode === objectiveId);
    return amplifyEntry(objectiveId, row, new Date());
  },
};

// ---------------------------------------------------------------------------
// Django

const STATUSES: readonly SkillStatus[] = [
  'LOCKED',
  'INTRODUCED',
  'DEVELOPING',
  'PROFICIENT',
  'MASTERED',
];
const PATTERNS: readonly ErrorPattern[] = ['NONE', 'NEEDS_SUPPORT', 'INCONSISTENT', 'STALLED'];

export function parseMasteryEntry(r: Reader): MasteryEntry {
  return {
    objectiveId: r.field('objectiveId').string(),
    title: r.field('title').string(),
    domain: r.field('domain').nullable((x) => x.string()),
    hasEvidence: r.field('hasEvidence').boolean(),
    status: r.field('status').nullable((x) => x.oneOf(STATUSES)),
    rawStatus: r.field('rawStatus').nullable((x) => x.oneOf(STATUSES)),
    errorPattern: r.field('errorPattern').nullable((x) => x.oneOf(PATTERNS)),
    exposureCount: r.field('exposureCount').integer(),
    independentSuccessCount: r.field('independentSuccessCount').integer(),
    supportedSuccessCount: r.field('supportedSuccessCount').integer(),
    consecutiveIndependentCorrect: r.field('consecutiveIndependentCorrect').integer(),
    lastPracticedAt: r.field('lastPracticedAt').nullable((x) => x.string()),
  };
}

/** The server's entry as the row shape the existing screens read. */
export function toSkillProgress(entry: MasteryEntry): SkillProgress {
  return {
    id: entry.objectiveId,
    learningObjectiveCode: entry.objectiveId,
    exposureCount: entry.exposureCount,
    independentSuccessCount: entry.independentSuccessCount,
    supportedSuccessCount: entry.supportedSuccessCount,
    consecutiveIndependentCorrect: entry.consecutiveIndependentCorrect,
    recentLevel: entry.rawStatus,
    errorPattern: entry.errorPattern,
    lastPracticedAt: entry.lastPracticedAt,
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoMastery(client: ApiClient): Partial<MasteryApi> {
  async function list(childProfileId: string): Promise<MasteryEntry[]> {
    const response = await client.request('GET', `children/${segment(childProfileId)}/mastery/`);
    return read(response.data, (r) => r.field('objectives').array(parseMasteryEntry));
  }

  return {
    listMastery: list,
    async listSkillProgress(childProfileId) {
      return (await list(childProfileId)).map(toSkillProgress);
    },
    async getMastery(childProfileId, objectiveId) {
      try {
        const response = await client.request(
          'GET',
          `children/${segment(childProfileId)}/mastery/${segment(objectiveId)}/`,
        );
        return read(response.data, parseMasteryEntry);
      } catch (error) {
        if (error instanceof ApiError && error.kind === 'not_found') return null;
        throw error;
      }
    },
  };
}

export const masteryApi: MasteryApi = selectApi<MasteryApi>('mastery', {
  amplify: amplifyMastery,
  django: (client) => createDjangoMastery(client),
});
