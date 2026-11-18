import { describe, expect, it } from 'vitest';
import {
  CASTLE_RANKS,
  rankConfigProblems,
  rankFor,
  shownRank,
  type RankTitle,
} from './castleRanks';
import source from './castleRanks.ts?raw';

const id = (rank: RankTitle | null) => rank?.id ?? null;

describe('rank titles config (SC-R07-04)', () => {
  it('is switched off by default: the owner has not decided to keep ranks', () => {
    expect(CASTLE_RANKS.enabled).toBe(false);
    expect(shownRank(4, 4)).toBeNull();
  });

  it('authors the four prep titles, ascending from 0 to 1, readable aloud', () => {
    expect(CASTLE_RANKS.ranks.map((rank) => rank.title)).toEqual([
      'Story Explorer',
      'Page Keeper',
      'Castle Pathfinder',
      'Master Storykeeper',
    ]);
    expect(rankConfigProblems(CASTLE_RANKS.ranks)).toEqual([]);
  });

  it('reports unusable lists', () => {
    expect(rankConfigProblems([])).not.toEqual([]);
    expect(rankConfigProblems([{ id: 'a', title: 'A', min: 0.2 }, { id: 'b', title: 'B', min: 1 }]))
      .toContain('the first rank must start at 0');
    expect(rankConfigProblems([{ id: 'a', title: 'A', min: 0 }, { id: 'b', title: 'B', min: 0.5 }]))
      .toContain('the last rank must be at 1');
    expect(rankConfigProblems([{ id: 'a', title: 'A', min: 0 }, { id: 'a', title: 'B', min: 1 }]))
      .toContain('ids repeat');
    expect(
      rankConfigProblems([{ id: 'a', title: 'Story — one', min: 0 }, { id: 'b', title: 'B', min: 1 }]),
    ).toContain('a: bad title');
  });
});

describe('rankFor', () => {
  it('meets each threshold exactly at its boundary', () => {
    expect(id(rankFor(0, 3))).toBe('story-explorer');
    expect(id(rankFor(1, 3))).toBe('story-explorer'); // 0.333 is under 0.34
    expect(id(rankFor(34, 100))).toBe('page-keeper');
    expect(id(rankFor(2, 3))).toBe('page-keeper'); // 0.667 is under 0.67
    expect(id(rankFor(67, 100))).toBe('castle-pathfinder');
    expect(id(rankFor(99, 100))).toBe('castle-pathfinder');
    expect(id(rankFor(3, 3))).toBe('master-storykeeper');
  });

  it('gives every band the same titles at the same share, whatever its page count', () => {
    expect(id(rankFor(1, 2))).toBe('page-keeper'); // a Sprout with one of two pages
    expect(id(rankFor(2, 2))).toBe('master-storykeeper');
    expect(id(rankFor(2, 4))).toBe('page-keeper'); // an Explorer with two of four
    expect(id(rankFor(3, 4))).toBe('castle-pathfinder');
  });

  it('gives the first title to a band with no required pages', () => {
    expect(id(rankFor(0, 0))).toBe('story-explorer');
  });

  it('returns null for input that cannot describe a book, and for an invalid config', () => {
    for (const [restored, total] of [
      [-1, 2],
      [3, 2],
      [0.5, 2],
      [Number.NaN, 2],
      [1, Number.POSITIVE_INFINITY],
    ]) {
      expect(rankFor(restored, total)).toBeNull();
    }
    expect(rankFor(1, 2, [{ id: 'only', title: 'Only', min: 0.5 }])).toBeNull();
  });

  it('sorts an unordered list before choosing', () => {
    const shuffled = [...CASTLE_RANKS.ranks].reverse();
    expect(id(rankFor(1, 2, shuffled))).toBe('page-keeper');
  });

  it('is pure and never time-based, stored or compared', () => {
    expect(rankFor(1, 2)).toEqual(rankFor(1, 2));
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date|now\(|localStorage|fetch\(|import /);
  });

  it('shows a title only when switched on', () => {
    const on = { ...CASTLE_RANKS, enabled: true };
    expect(id(shownRank(2, 2, on))).toBe('master-storykeeper');
    expect(shownRank(2, 2, CASTLE_RANKS)).toBeNull();
  });
});
