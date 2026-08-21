import { describe, expect, it } from 'vitest';
import {
  RELATIONSHIP_THRESHOLDS,
  awardRelationshipPoints,
  pointsToNextLevel,
  relationshipLevelForPoints,
} from './relationship';
import { RELATIONSHIP_LEVEL_ORDER } from './types';

describe('relationshipLevelForPoints', () => {
  it('starts at STRANGER with no points', () => {
    expect(relationshipLevelForPoints(0)).toBe('STRANGER');
  });

  it('returns each level exactly at its threshold', () => {
    for (const level of RELATIONSHIP_LEVEL_ORDER) {
      expect(relationshipLevelForPoints(RELATIONSHIP_THRESHOLDS[level])).toBe(level);
    }
  });

  it('stays at the top level beyond the last threshold', () => {
    expect(relationshipLevelForPoints(RELATIONSHIP_THRESHOLDS.TRUSTED_FRIEND + 100)).toBe(
      'TRUSTED_FRIEND',
    );
  });

  it('never regresses as points increase', () => {
    let previousRank = -1;
    for (let points = 0; points <= 30; points += 1) {
      const rank = RELATIONSHIP_LEVEL_ORDER.indexOf(relationshipLevelForPoints(points));
      expect(rank).toBeGreaterThanOrEqual(previousRank);
      previousRank = rank;
    }
  });
});

describe('awardRelationshipPoints', () => {
  it('adds a positive award', () => {
    expect(awardRelationshipPoints(3, 2)).toBe(5);
  });

  it('never subtracts, so a friendship cannot be lost to bad content', () => {
    expect(awardRelationshipPoints(5, -10)).toBe(5);
    expect(awardRelationshipPoints(5, 0)).toBe(5);
  });

  it('truncates a fractional award rather than storing a float', () => {
    expect(awardRelationshipPoints(0, 2.9)).toBe(2);
  });
});

describe('pointsToNextLevel', () => {
  it('reports the remaining points toward the next level', () => {
    expect(pointsToNextLevel(0)).toBe(RELATIONSHIP_THRESHOLDS.ACQUAINTANCE);
    expect(pointsToNextLevel(RELATIONSHIP_THRESHOLDS.ACQUAINTANCE)).toBe(
      RELATIONSHIP_THRESHOLDS.FRIEND - RELATIONSHIP_THRESHOLDS.ACQUAINTANCE,
    );
  });

  it('is null at the top of the ladder', () => {
    expect(pointsToNextLevel(RELATIONSHIP_THRESHOLDS.TRUSTED_FRIEND)).toBeNull();
  });
});
