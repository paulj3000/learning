import { describe, expect, it } from 'vitest';
import { buildDomainMasterySummaries } from './masteryOverview';
import { buildMasteryDetail } from '../mastery/summary';
import type { SkillProgressCounts } from '../mastery/types';

const NOW = new Date('2026-08-20T00:00:00Z');

function counts(overrides: Partial<SkillProgressCounts> = {}): SkillProgressCounts {
  return {
    exposureCount: 3,
    independentSuccessCount: 3,
    supportedSuccessCount: 0,
    consecutiveIndependentCorrect: 1,
    lastPracticedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('buildDomainMasterySummaries', () => {
  it('omits a domain with no practiced skill', () => {
    const details = buildMasteryDetail(['counting-sets'], new Map(), NOW);
    expect(buildDomainMasterySummaries(details)).toEqual([]);
  });

  it('reports a practiced skill’s domain by title and status', () => {
    const details = buildMasteryDetail(
      ['counting-sets'],
      new Map([['counting-sets', counts()]]),
      NOW,
    );
    expect(buildDomainMasterySummaries(details)).toEqual([
      { domainId: 'early-number', domainTitle: 'Early Number', status: 'PROFICIENT' },
    ]);
  });

  it('uses the weakest practiced status when a domain has multiple skills', () => {
    // observation and classification are both in the observing-and-sorting domain.
    const details = buildMasteryDetail(
      ['observation', 'classification'],
      new Map([
        ['observation', counts()],
        ['classification', counts({ exposureCount: 1, independentSuccessCount: 0 })],
      ]),
      NOW,
    );
    const summary = buildDomainMasterySummaries(details);
    expect(summary).toEqual([
      {
        domainId: 'observing-and-sorting',
        domainTitle: 'Observing and Sorting',
        status: 'INTRODUCED',
      },
    ]);
  });

  it('sorts multiple domains by title', () => {
    const details = buildMasteryDetail(
      ['measurement', 'counting-sets'],
      new Map([
        ['measurement', counts()],
        ['counting-sets', counts()],
      ]),
      NOW,
    );
    const summary = buildDomainMasterySummaries(details);
    expect(summary.map((entry) => entry.domainTitle)).toEqual([
      'Early Number',
      'Measurement and Data',
    ]);
  });
});
