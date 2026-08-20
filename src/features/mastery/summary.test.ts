import { describe, expect, it } from 'vitest';
import {
  buildMasteryDetail,
  buildMasterySummary,
  indexProgressBySkill,
  resolveSkillStatuses,
} from './summary';
import type { SkillProgress } from './api';
import { REVIEW_DECAY_DAYS } from './status';
import type { SkillProgressCounts } from './types';

const NOW = new Date('2026-08-20T00:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function skillProgressRow(overrides: Partial<SkillProgress> = {}): SkillProgress {
  return {
    id: 'sp1',
    childProfileId: 'child-1',
    learningObjectiveCode: 'counting-sets',
    exposureCount: 1,
    independentSuccessCount: 1,
    supportedSuccessCount: 0,
    consecutiveIndependentCorrect: 1,
    recentLevel: null,
    errorPattern: null,
    lastPracticedAt: daysAgo(1),
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...overrides,
  } as SkillProgress;
}

function proficientCounts(overrides: Partial<SkillProgressCounts> = {}): SkillProgressCounts {
  return {
    exposureCount: 3,
    independentSuccessCount: 3,
    supportedSuccessCount: 0,
    consecutiveIndependentCorrect: 1,
    lastPracticedAt: daysAgo(1),
    ...overrides,
  };
}

describe('indexProgressBySkill', () => {
  it('keys rows by learningObjectiveCode', () => {
    const rows = [
      skillProgressRow({ learningObjectiveCode: 'counting-sets', exposureCount: 2 }),
      skillProgressRow({ learningObjectiveCode: 'patterns', exposureCount: 5 }),
    ];
    const bySkill = indexProgressBySkill(rows);
    expect(bySkill.get('counting-sets')?.exposureCount).toBe(2);
    expect(bySkill.get('patterns')?.exposureCount).toBe(5);
    expect(bySkill.has('addition-within-ten')).toBe(false);
  });
});

describe('resolveSkillStatuses', () => {
  it('is INTRODUCED for a prerequisite-free skill with no progress', () => {
    const statuses = resolveSkillStatuses(['counting-sets'], new Map());
    expect(statuses.get('counting-sets')).toBe('INTRODUCED');
  });

  it('is LOCKED for a skill whose prerequisite has not been reached yet', () => {
    const statuses = resolveSkillStatuses(['addition-within-ten'], new Map());
    expect(statuses.get('addition-within-ten')).toBe('LOCKED');
  });

  it('unlocks once the prerequisite is proficient', () => {
    const progress = new Map([['counting-sets', proficientCounts()]]);
    const statuses = resolveSkillStatuses(['counting-sets', 'addition-within-ten'], progress);
    expect(statuses.get('counting-sets')).toBe('PROFICIENT');
    expect(statuses.get('addition-within-ten')).toBe('INTRODUCED');
  });

  it('resolves a two-level prerequisite chain (subtraction-within-ten needs addition-within-ten needs counting-sets)', () => {
    const progress = new Map([
      ['counting-sets', proficientCounts()],
      ['addition-within-ten', proficientCounts()],
    ]);
    const statuses = resolveSkillStatuses(['subtraction-within-ten'], progress);
    expect(statuses.get('subtraction-within-ten')).toBe('INTRODUCED');
  });

  it('stays LOCKED partway through a chain when only the first link is proficient', () => {
    const progress = new Map([['counting-sets', proficientCounts()]]);
    const statuses = resolveSkillStatuses(['subtraction-within-ten'], progress);
    expect(statuses.get('subtraction-within-ten')).toBe('LOCKED');
  });

  it('resolves an unknown skill id to LOCKED rather than throwing', () => {
    const statuses = resolveSkillStatuses(['not-a-real-skill'], new Map());
    expect(statuses.get('not-a-real-skill')).toBe('LOCKED');
  });
});

describe('buildMasteryDetail', () => {
  it('includes counts, error pattern, and decay-adjusted status', () => {
    const staleProficient = proficientCounts({
      lastPracticedAt: daysAgo(REVIEW_DECAY_DAYS + 5),
    });
    const [detail] = buildMasteryDetail(
      ['counting-sets'],
      new Map([['counting-sets', staleProficient]]),
      NOW,
    );
    expect(detail.skillId).toBe('counting-sets');
    expect(detail.status).toBe('DEVELOPING');
    expect(detail.errorPattern).toBe('NONE');
    expect(detail.exposureCount).toBe(3);
    expect(detail.independentSuccessCount).toBe(3);
  });
});

describe('buildMasterySummary', () => {
  it('exposes only skillId and status, never raw counts', () => {
    const [entry] = buildMasterySummary(
      ['counting-sets'],
      new Map([['counting-sets', proficientCounts()]]),
      NOW,
    );
    expect(entry).toEqual({ skillId: 'counting-sets', status: 'PROFICIENT' });
    expect(Object.keys(entry).sort()).toEqual(['skillId', 'status']);
  });
});
