import { useEffect, useState } from 'react';
import { setCoopPresence, subscribeToCoopSession, type CoopSession } from './api';
import { parseCoopSharedState, type CoopSharedState } from './types';

export interface CoopPresenceState {
  session: CoopSession | null;
  sharedState: CoopSharedState;
}

/**
 * Joins one coop session's live shared state for the lifetime of the
 * calling component: marks this child present on mount, polls the Django
 * co-op route for the shared state (slot claims and the other child's
 * presence), and on unmount stops polling and marks this child absent — the "avatar position,
 * join/leave" ephemeral client state docs/DATA_MODEL.md calls for, kept
 * out of `useAdventureSession` itself so single-player play never pays for
 * a subscription it does not need.
 */
export function useCoopPresence(
  coopSessionId: string | undefined,
  childProfileId: string,
): CoopPresenceState {
  const [session, setSession] = useState<CoopSession | null>(null);

  useEffect(() => {
    if (!coopSessionId) {
      setSession(null);
      return;
    }
    let cancelled = false;
    void setCoopPresence(coopSessionId, childProfileId, true).catch(() => undefined);
    const unsubscribe = subscribeToCoopSession(coopSessionId, childProfileId, (updated) => {
      if (!cancelled) setSession(updated);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void setCoopPresence(coopSessionId, childProfileId, false).catch(() => undefined);
    };
  }, [coopSessionId, childProfileId]);

  return { session, sharedState: parseCoopSharedState(session?.sharedState) };
}
