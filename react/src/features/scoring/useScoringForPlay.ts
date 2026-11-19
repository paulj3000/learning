import { useScoringClaims, type ScoringClaims } from './useScoringClaims';
import { useScoringSummary } from './useScoringSummary';

export interface ScoringForPlay extends ScoringClaims {
  /** True only when Django says scoring is on for this child. */
  enabled: boolean;
}

/**
 * One hook for a play surface (the location page, a GameHost world). Pass `onGameplayEvent` to
 * the world's claim sink and render `ScoreNotification` from `pending`, `confirmed`, `dismiss`.
 *
 * While scoring is off (the default), loading, failed, or there is no child yet, claims are
 * ignored and the awards feed is never read. Only the one summary request is made. Amounts
 * shown are always the server's.
 */
export function useScoringForPlay(childId: string | undefined): ScoringForPlay {
  const summary = useScoringSummary(childId ?? '');
  const enabled = summary.status === 'ready';
  const claims = useScoringClaims(childId ?? '', { enabled });
  return { ...claims, enabled };
}
