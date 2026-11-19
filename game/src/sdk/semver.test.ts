import { describe, expect, it } from 'vitest';
import { isValidRange, parseSemver, satisfiesRange } from './semver';

describe('semver ranges', () => {
  it('parses exact versions only', () => {
    expect(parseSemver('1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('1.2.3-beta')).toBeNull();
  });

  it.each([
    ['0.1.0', '^0.1.0', true],
    ['0.1.9', '^0.1.0', true],
    ['0.2.0', '^0.1.0', false],
    ['1.4.0', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['0.1.5', '~0.1.2', true],
    ['0.2.0', '~0.1.2', false],
    ['0.1.0', '>=0.1.0 <0.3.0', true],
    ['0.3.0', '>=0.1.0 <0.3.0', false],
    ['0.1.0', '>= 0.1.0', true],
    ['0.1.0', '0.1.0', true],
    ['0.1.1', '0.1.0', false],
    ['0.1.7', '0.1.x', true],
    ['0.2.0', '0.1.x', false],
    ['3.0.0', '*', true],
    ['0.1.0', '^1.0.0 || ^0.1.0', true],
    ['0.1.0', '>0.1.0', false],
  ])('%s satisfies %s -> %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  it('treats invalid versions and ranges as not satisfied', () => {
    expect(satisfiesRange('nope', '^0.1.0')).toBe(false);
    expect(satisfiesRange('0.1.0', 'banana')).toBe(false);
    expect(satisfiesRange('0.1.0', '')).toBe(false);
    expect(isValidRange('^0.1.0')).toBe(true);
    expect(isValidRange('^0.1.0 ||')).toBe(false);
    expect(isValidRange(42)).toBe(false);
  });
});
