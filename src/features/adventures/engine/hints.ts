import type { AdventureStep } from './types';

/**
 * The 5-level hint ladder from docs/ADVENTURE_ENGINE.md: encouragement,
 * attention cue, strategy hint, partial scaffold, guided completion.
 */
export const MAX_HINT_LEVEL = 5;

export function nextHintLevel(currentLevel: number): number {
  return Math.min(currentLevel + 1, MAX_HINT_LEVEL);
}

/** True once a hint has reached "guided completion" (level 5). */
export function isGuidedCompletion(hintLevel: number): boolean {
  return hintLevel >= MAX_HINT_LEVEL;
}

export function getHintText(step: AdventureStep, level: number): string | undefined {
  if (level <= 0 || !step.hintPolicy) return undefined;
  return step.hintPolicy.ladder[Math.min(level, step.hintPolicy.ladder.length) - 1];
}
