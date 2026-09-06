import { describe, expect, it, vi } from 'vitest';
import { readSessionClock, resolveSessionStart, sessionStartKey } from './sessionClock';

/**
 * The rules behind MVP scope item 11's calm stopping point, tested without a
 * clock. What matters here is not the arithmetic but the two ways this
 * feature could hurt a child: firing when no limit was set, and losing a
 * session's start so the limit never arrives.
 */

const MINUTE = 60_000;
const START = 1_000_000;

describe('readSessionClock', () => {
  it('counts whole minutes since the session began', () => {
    expect(readSessionClock(START, START, 10).elapsedMinutes).toBe(0);
    expect(readSessionClock(START, START + 90_000, 10).elapsedMinutes).toBe(1);
    expect(readSessionClock(START, START + 9 * MINUTE, 10).elapsedMinutes).toBe(9);
  });

  it('reaches the limit only once the whole time has passed', () => {
    expect(readSessionClock(START, START + 9 * MINUTE, 10).limitReached).toBe(false);
    expect(readSessionClock(START, START + 10 * MINUTE, 10).limitReached).toBe(true);
    expect(readSessionClock(START, START + 40 * MINUTE, 10).limitReached).toBe(true);
  });

  /**
   * The one that would be worst to get wrong: a child whose parent set no
   * limit must never be told to stop. The absence of a setting is not a
   * default of zero.
   */
  it.each([null, undefined, 0])('never suggests stopping when the limit is %s', (limit) => {
    const state = readSessionClock(START, START + 500 * MINUTE, limit);
    expect(state.limitReached).toBe(false);
    expect(state.limitMinutes).toBeNull();
  });

  /** A clock that jumped backwards must not read as a negative session. */
  it('never reports negative time', () => {
    expect(readSessionClock(START, START - 5 * MINUTE, 10).elapsedMinutes).toBe(0);
  });
});

describe('resolveSessionStart', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      read: (key: string) => map.get(key) ?? null,
    };
  }

  it('starts a session and remembers when it began', () => {
    const storage = fakeStorage();

    expect(resolveSessionStart(storage, 'child-1', START)).toBe(START);
    expect(storage.read(sessionStartKey('child-1'))).toBe(String(START));
  });

  /**
   * The behaviour the whole feature rests on: walking from the map into an
   * adventure and back must not restart the clock, or the limit is never
   * reached by a child who moves around.
   */
  it('keeps the original start across navigation', () => {
    const storage = fakeStorage({ [sessionStartKey('child-1')]: String(START) });

    expect(resolveSessionStart(storage, 'child-1', START + 8 * MINUTE)).toBe(START);
  });

  it('keeps each child on their own clock', () => {
    const storage = fakeStorage({ [sessionStartKey('child-1')]: String(START) });

    expect(resolveSessionStart(storage, 'child-2', START + 8 * MINUTE)).toBe(START + 8 * MINUTE);
    expect(resolveSessionStart(storage, 'child-1', START + 8 * MINUTE)).toBe(START);
  });

  /**
   * Storage can be absent or hostile - a private window, a browser set to
   * block site data, a corrupt value. Every one of those starts a fresh
   * session rather than throwing: the worst case is a child gets their full
   * time again, which is the right way round for this to fail.
   */
  it.each([
    ['no storage at all', null],
    ['a value that is not a number', 'not-a-time'],
    ['an empty value', ''],
    ['a start in the future', String(START + 100 * MINUTE)],
  ])('falls back to a fresh session given %s', (_case, stored) => {
    const storage =
      stored === null ? null : fakeStorage({ [sessionStartKey('child-1')]: stored as string });

    expect(resolveSessionStart(storage, 'child-1', START)).toBe(START);
  });

  it('does not throw when storage refuses to be read', () => {
    const hostile = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(),
    };

    expect(resolveSessionStart(hostile, 'child-1', START)).toBe(START);
  });
});
