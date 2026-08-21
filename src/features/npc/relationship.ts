/**
 * Relationship/friendship progression (docs/ROADMAP.md Phase 23).
 *
 * The thresholds below are authored product constants, not a validated
 * model of anything — the same honesty Phase 20's mastery constants are
 * documented with. They are spaced so a child reaches `FRIEND` within a
 * normal handful of visits rather than through grinding, because the ladder
 * exists to make a character feel like it remembers you, not to create a
 * reason to return (CLAUDE.md pillar 7: no streaks, no engagement pressure).
 *
 * Progression is monotonic: points never decrease, so a level can never be
 * lost. A child who stops visiting an NPC for a month finds it exactly as
 * pleased to see them as before.
 */
import { RELATIONSHIP_LEVEL_ORDER, type RelationshipLevel } from './types';

/** Minimum points for each level, ascending. */
export const RELATIONSHIP_THRESHOLDS: Readonly<Record<RelationshipLevel, number>> = {
  STRANGER: 0,
  ACQUAINTANCE: 2,
  FRIEND: 6,
  TRUSTED_FRIEND: 12,
};

/** Highest level whose threshold `points` has reached. */
export function relationshipLevelForPoints(points: number): RelationshipLevel {
  let level: RelationshipLevel = 'STRANGER';
  for (const candidate of RELATIONSHIP_LEVEL_ORDER) {
    if (points >= RELATIONSHIP_THRESHOLDS[candidate]) level = candidate;
  }
  return level;
}

/**
 * Points after awarding `award`, floored at the current total so a negative
 * or malformed authored award can never cost a child a friendship.
 */
export function awardRelationshipPoints(currentPoints: number, award: number): number {
  return currentPoints + Math.max(0, Math.trunc(award));
}

/** Points still needed for the next level, or null at the top of the ladder. */
export function pointsToNextLevel(points: number): number | null {
  const current = relationshipLevelForPoints(points);
  const nextIndex = RELATIONSHIP_LEVEL_ORDER.indexOf(current) + 1;
  if (nextIndex >= RELATIONSHIP_LEVEL_ORDER.length) return null;
  return RELATIONSHIP_THRESHOLDS[RELATIONSHIP_LEVEL_ORDER[nextIndex]] - points;
}
