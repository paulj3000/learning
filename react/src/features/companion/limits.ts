import type { AgeBandValue } from '../child-profile/constants';

/**
 * Age-banded output length limits (CLAUDE.md section 3 — Sprouts need the
 * shortest, simplest lines; Explorers can handle more). Enforced both in
 * the AI generation route's `maxLength` argument and again by
 * `validateCompanionTurn` on the response, since a model instruction alone
 * is never sufficient (docs/AI_AND_CHILD_SAFETY.md).
 */
export const MAX_SPOKEN_LENGTH_BY_AGE_BAND: Record<AgeBandValue, number> = {
  SPROUT: 120,
  PATHFINDER: 200,
  EXPLORER: 320,
};
