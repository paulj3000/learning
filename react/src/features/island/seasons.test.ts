import { describe, expect, it } from 'vitest';
import { getSeason, getSeasonalIslandNote } from './seasons';

describe('getSeason', () => {
  it.each([
    ['2026-01-15', 'WINTER'],
    ['2026-02-15', 'WINTER'],
    ['2026-03-15', 'SPRING'],
    ['2026-04-15', 'SPRING'],
    ['2026-05-15', 'SPRING'],
    ['2026-06-15', 'SUMMER'],
    ['2026-07-15', 'SUMMER'],
    ['2026-08-15', 'SUMMER'],
    ['2026-09-15', 'AUTUMN'],
    ['2026-10-15', 'AUTUMN'],
    ['2026-11-15', 'AUTUMN'],
    ['2026-12-15', 'WINTER'],
  ])('maps %s to %s', (isoDate, season) => {
    expect(getSeason(new Date(`${isoDate}T00:00:00Z`))).toBe(season);
  });
});

describe('getSeasonalIslandNote', () => {
  it('returns a non-empty note for every season', () => {
    const dates = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map(
      (isoDate) => new Date(`${isoDate}T00:00:00Z`),
    );
    for (const date of dates) {
      expect(getSeasonalIslandNote(date).length).toBeGreaterThan(0);
    }
  });

  it('is stable for the same date', () => {
    const date = new Date('2026-06-01T00:00:00Z');
    expect(getSeasonalIslandNote(date)).toBe(getSeasonalIslandNote(date));
  });
});
