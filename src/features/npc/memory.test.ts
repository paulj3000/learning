import { describe, expect, it } from 'vitest';
import { EMPTY_MEMORY_FLAGS, hasMemoryFlag, parseMemoryFlags, setMemoryFlags } from './memory';

describe('setMemoryFlags', () => {
  it('sets each named flag true', () => {
    expect(setMemoryFlags({}, ['metPip', 'heardAboutBridge'])).toEqual({
      metPip: true,
      heardAboutBridge: true,
    });
  });

  it('keeps existing flags and returns a new object', () => {
    const before = { metPip: true };
    const after = setMemoryFlags(before, ['metBolt']);
    expect(after).toEqual({ metPip: true, metBolt: true });
    expect(before).toEqual({ metPip: true });
  });

  it('returns the same reference when there is nothing to set', () => {
    const before = { metPip: true };
    expect(setMemoryFlags(before, [])).toBe(before);
  });
});

describe('hasMemoryFlag', () => {
  it('reads a set flag and defaults an unset one to false', () => {
    expect(hasMemoryFlag({ metPip: true }, 'metPip')).toBe(true);
    expect(hasMemoryFlag({}, 'metPip')).toBe(false);
  });
});

describe('parseMemoryFlags', () => {
  it('accepts a boolean map', () => {
    expect(parseMemoryFlags({ metPip: true, metBolt: false })).toEqual({
      metPip: true,
      metBolt: false,
    });
  });

  it('drops non-boolean values rather than trusting stored JSON', () => {
    expect(parseMemoryFlags({ metPip: true, nickname: 'Sam', count: 3 })).toEqual({
      metPip: true,
    });
  });

  it('degrades a malformed column to empty', () => {
    expect(parseMemoryFlags(null)).toEqual(EMPTY_MEMORY_FLAGS);
    expect(parseMemoryFlags(undefined)).toEqual(EMPTY_MEMORY_FLAGS);
    expect(parseMemoryFlags('not an object')).toEqual(EMPTY_MEMORY_FLAGS);
    expect(parseMemoryFlags([1, 2, 3])).toEqual(EMPTY_MEMORY_FLAGS);
  });
});
