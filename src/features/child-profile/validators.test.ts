import { describe, expect, it } from 'vitest';
import { validateInterests, validateNickname, validateSessionMinutes } from './validators';

describe('validateNickname', () => {
  it('rejects empty input', () => {
    expect(validateNickname('  ')).toMatch(/enter a nickname/i);
  });

  it('rejects nicknames longer than 30 characters', () => {
    expect(validateNickname('a'.repeat(31))).toMatch(/30 characters/i);
  });

  it('accepts a normal nickname', () => {
    expect(validateNickname('Robin')).toBeNull();
  });
});

describe('validateInterests', () => {
  it('rejects more than the maximum number of interests', () => {
    expect(validateInterests(['Animals', 'Space', 'Dinosaurs', 'Ocean', 'Art', 'Music'])).toMatch(
      /up to 5/i,
    );
  });

  it('accepts an empty or small list', () => {
    expect(validateInterests(['Animals'])).toBeNull();
  });
});

describe('validateSessionMinutes', () => {
  it('rejects a value below the age band range', () => {
    expect(validateSessionMinutes(2, 'SPROUT')).toMatch(/between 5 and 8/i);
  });

  it('rejects a value above the age band range', () => {
    expect(validateSessionMinutes(30, 'PATHFINDER')).toMatch(/between 8 and 12/i);
  });

  it('accepts a value inside the age band range', () => {
    expect(validateSessionMinutes(15, 'EXPLORER')).toBeNull();
  });
});
