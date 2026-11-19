import type { AwardEntry, ScoringEnabledSummary } from './types';

export function enabledSummary(overrides: Partial<ScoringEnabledSummary> = {}): ScoringEnabledSummary {
  return {
    enabled: true,
    contractVersion: 1,
    policy: { key: 'default', version: 3, provisional: true },
    totals: { xp: 800, learningPoints: 350, coins: 20, stars: 2 },
    level: { level: 2, xp: 800, levelFloorXp: 500, nextLevelXp: 1500 },
    achievements: [],
    trophies: [],
    adventures: [
      {
        scopeKey: 'treasure-rush-cove',
        xp: 300,
        learningPoints: 250,
        coins: 20,
        stars: 2,
        maxStars: 3,
        personalBest: { xpInOneVisit: 300 },
      },
    ],
    subjects: [{ subject: 'number-sense', objectives: 4, proficient: 1, mastered: 1 }],
    recentAwards: [],
    ...overrides,
  };
}

export function awardEntry(overrides: Partial<AwardEntry> = {}): AwardEntry {
  return {
    id: 'a1',
    entryKind: 'AWARD',
    currency: 'XP',
    amount: 50,
    sourceKind: 'LOCATION_FIRST_VISIT',
    sourceRef: 'treasure-rush-cove',
    scopeKey: 'treasure-rush-cove',
    recordedAt: '2026-11-18T10:00:00Z',
    ...overrides,
  };
}
