/**
 * Seasonal world state (docs/ROADMAP.md Phase 16, "Island Progression").
 * Deliberately the same shape as `events.ts`'s `getTodaysEvent`: no AI, no
 * backend, a pure function of the real-world date so it is stable across a
 * day and the same for every child who visits. Unlike every other Phase 16
 * deliverable this session, this one has no `WorldChange`/story to key off
 * — the island's season is simply always "on," reflecting the real-world
 * calendar rather than anything the child did.
 */
export type Season = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';

const SEASONAL_NOTES: Record<Season, string> = {
  SPRING: 'New buds are opening all across the island.',
  SUMMER: 'The island is warm, bright, and buzzing with life.',
  AUTUMN: 'Leaves are turning red and gold across the island.',
  WINTER: 'A cool, crisp hush has settled over the island.',
};

/** Meteorological seasons (Northern Hemisphere), from the UTC month alone. */
export function getSeason(date: Date): Season {
  const month = date.getUTCMonth(); // 0 = January
  if (month === 11 || month <= 1) return 'WINTER';
  if (month <= 4) return 'SPRING';
  if (month <= 7) return 'SUMMER';
  return 'AUTUMN';
}

export function getSeasonalIslandNote(date: Date): string {
  return SEASONAL_NOTES[getSeason(date)];
}
