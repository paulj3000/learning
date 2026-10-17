import { describe, expect, it } from 'vitest';
import { getTodaysEvent } from './events';

describe('getTodaysEvent', () => {
  it('returns the same message for the same date', () => {
    const date = new Date('2026-03-05T09:00:00Z');
    expect(getTodaysEvent(date)).toBe(getTodaysEvent(new Date('2026-03-05T18:00:00Z')));
  });

  it('returns a non-empty message', () => {
    expect(getTodaysEvent(new Date('2026-01-01T00:00:00Z')).length).toBeGreaterThan(0);
  });

  it('can return a different message on a different day', () => {
    const messages = new Set<string>();
    for (let day = 1; day <= 10; day += 1) {
      messages.add(getTodaysEvent(new Date(Date.UTC(2026, 0, day))));
    }
    expect(messages.size).toBeGreaterThan(1);
  });
});
