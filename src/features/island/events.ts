/**
 * Calm, curated "today on the island" messages (docs/ROADMAP.md Phase 2
 * "static world-state decorations"). No AI, no backend: a small fixed list
 * chosen deterministically by the date, so it is stable across a day and the
 * same for every child who visits.
 */
const ISLAND_EVENTS: string[] = [
  'The tide is calm and the harbor bell is ringing softly.',
  'Seagulls are gathering shells along the shore this morning.',
  'A gentle breeze is moving the flags above Welcome Harbor.',
  'The lighthouse lamp is freshly polished and shining bright.',
  'Someone spotted dolphins playing near the harbor this morning.',
  'The morning fog is lifting over the island, one hill at a time.',
  'A friendly crab is exploring the docks near Welcome Harbor.',
];

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / (1000 * 60 * 60 * 24));
}

export function getTodaysEvent(date: Date): string {
  const index = dayOfYear(date) % ISLAND_EVENTS.length;
  return ISLAND_EVENTS[index];
}
