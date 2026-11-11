import { describe, expect, it } from 'vitest';
import { validateInterests, validateNickname } from './validators';

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
