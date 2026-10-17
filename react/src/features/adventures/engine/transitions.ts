import type { AdventureStep, Correctness } from './types';

/**
 * Controls every step transition in application code (CLAUDE.md section 7:
 * "AI may vary presentation inside a step but may not create unauthorized
 * step transitions"). An unauthored path is a content-authoring bug, not a
 * runtime condition to recover from, so it throws rather than falling back.
 */
export function getNextStepId(step: AdventureStep, correctness: Correctness): string {
  const specific = step.transitions.find((rule) => rule.when === correctness);
  if (specific) return specific.nextStepId;

  const always = step.transitions.find((rule) => rule.when === 'always');
  if (always) return always.nextStepId;

  throw new Error(
    `Step "${step.id}" has no transition rule for correctness "${correctness}" and no "always" fallback.`,
  );
}
