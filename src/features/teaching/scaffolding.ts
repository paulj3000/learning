import { SCAFFOLDING_LEVEL_ORDER, type ScaffoldingLevel } from './types';

/**
 * Mirrors `src/features/adventures/engine/hints.ts`'s `MAX_HINT_LEVEL`
 * exactly — the two are the same underlying escalation, this module just
 * gives it the Teaching Engine's reusable vocabulary. See
 * `scaffolding.test.ts` for a direct equivalence check against
 * `isGuidedCompletion`.
 */
export const MAX_SCAFFOLDING_LEVEL = SCAFFOLDING_LEVEL_ORDER.length;

/**
 * The existing 1-5 `hintLevel`/`supportLevel` integer, translated to this
 * module's named vocabulary. `0` or below (no scaffold used yet) has no
 * named level, same as `getHintText`'s `level <= 0` case in `hints.ts`.
 */
export function scaffoldingLevelForHintLevel(hintLevel: number): ScaffoldingLevel | undefined {
  if (hintLevel <= 0) return undefined;
  const index = Math.min(Math.round(hintLevel), MAX_SCAFFOLDING_LEVEL) - 1;
  return SCAFFOLDING_LEVEL_ORDER[index];
}

/** The reverse of `scaffoldingLevelForHintLevel`, for recording evidence in the existing integer fields. */
export function hintLevelForScaffoldingLevel(level: ScaffoldingLevel): number {
  return SCAFFOLDING_LEVEL_ORDER.indexOf(level) + 1;
}

/** Escalates one level, capped at `EQUIVALENT_RETRY_PROBLEM` — mirrors `nextHintLevel`. */
export function nextScaffoldingLevel(current: ScaffoldingLevel | undefined): ScaffoldingLevel {
  const currentHintLevel = current ? hintLevelForScaffoldingLevel(current) : 0;
  return scaffoldingLevelForHintLevel(currentHintLevel + 1) ?? SCAFFOLDING_LEVEL_ORDER[0];
}

/**
 * The generalized "stop looping" rule (roadmap Phase 21's "a rule
 * preventing repeated failure loops from stalling an adventure"): once a
 * child has been offered every scaffolding level up to the most
 * intensive, the engine should force the step to resolve rather than
 * escalate further — mirrors `isGuidedCompletion` in `hints.ts`.
 */
export function shouldForceAdvancement(level: ScaffoldingLevel | undefined): boolean {
  if (!level) return false;
  return hintLevelForScaffoldingLevel(level) >= MAX_SCAFFOLDING_LEVEL;
}
