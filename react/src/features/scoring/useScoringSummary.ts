import { useEffect, useState } from 'react';
import { getScoringSummary } from './api';
import type { ScoringEnabledSummary } from './types';

export type ScoringSummaryState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'error'; message: string }
  | { status: 'ready'; summary: ScoringEnabledSummary };

export const SCORING_ERROR_MESSAGE = 'Progress is not available right now.';

/** Loads a child's scoring summary: loading, a safe error message, disabled, or ready. */
export function useScoringSummary(childId: string): ScoringSummaryState {
  const [state, setState] = useState<ScoringSummaryState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!childId) {
      // No child (a route still resolving): nothing to read, so nothing is requested.
      setState({ status: 'disabled' });
      return () => {
        cancelled = true;
      };
    }
    setState({ status: 'loading' });
    getScoringSummary(childId).then(
      (summary) => {
        if (cancelled) return;
        setState(summary.enabled ? { status: 'ready', summary } : { status: 'disabled' });
      },
      () => {
        if (!cancelled) setState({ status: 'error', message: SCORING_ERROR_MESSAGE });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [childId]);

  return state;
}
