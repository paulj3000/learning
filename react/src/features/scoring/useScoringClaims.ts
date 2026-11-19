import { useCallback, useEffect, useRef, useState } from 'react';
import { getScoringAwards } from './api';
import { pendingFromEvent } from './engineAdapter';
import { reconcilePending, type ConfirmedAward, type PendingEntry } from './pendingAwards';

/** How often the awards feed is read while something is pending. Never while nothing is. */
export const CLAIM_POLL_MS = 1500;

export interface ScoringClaims {
  pending: readonly PendingEntry[];
  confirmed: readonly ConfirmedAward[];
  /** The GameHost seam: `<GameHost onGameplayEvent={claims.onGameplayEvent} />`. */
  onGameplayEvent: (claim: unknown) => void;
  dismiss: (awardId: string) => void;
}

/**
 * Turns engine gameplay claims into pending notifications and confirms them from the server's
 * awards feed (docs/scoring/SCORING_CONTRACTS.md sections 6 and 7). A claim never carries or
 * produces an amount: amounts only ever come from the feed.
 *
 * On mount the feed is read to its end, so awards earned before this visit are never
 * celebrated again. When scoring is off (the feed has no cursor) nothing is ever polled.
 * Polling runs only while a claim is pending, and stops when every pending entry has been
 * confirmed or has quietly expired.
 */
export interface ScoringClaimsOptions {
  /**
   * False while scoring is off or still loading (`useScoringSummary(childId).status !== 'ready'`):
   * no feed request is made and claims are ignored. Default true.
   */
  enabled?: boolean;
  pollMs?: number;
  now?: () => number;
}

/** The seam: pass `onGameplayEvent` to `GameHost` or the location engine bridge
 * (`mountEngineBridge(host, { onGameplayEvent })`); both take `(event: AnyGameplayEvent) => void`. */
export function useScoringClaims(childId: string, options: ScoringClaimsOptions = {}): ScoringClaims {
  const { enabled: active = true, pollMs = CLAIM_POLL_MS, now = Date.now } = options;
  const [pending, setPending] = useState<readonly PendingEntry[]>([]);
  const [confirmed, setConfirmed] = useState<readonly ConfirmedAward[]>([]);
  const cursor = useRef<string | null>(null);
  const ready = useRef(false);
  const enabled = useRef(false);
  const celebrated = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    cursor.current = null;
    enabled.current = false;
    if (!active) {
      setPending([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        let page = await getScoringAwards(childId);
        while (page.hasMore && page.cursor && !cancelled) {
          page = await getScoringAwards(childId, page.cursor);
        }
        if (cancelled) return;
        cursor.current = page.cursor;
        enabled.current = page.cursor !== null || page.awards.length > 0;
        for (const award of page.awards) celebrated.current.add(award.id);
      } catch {
        enabled.current = false; // scoring is an enhancement: play goes on without it
      } finally {
        if (!cancelled) ready.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [childId, active]);

  const onGameplayEvent = useCallback(
    (claim: unknown) => {
      if (!active) return;
      const entry = pendingFromEvent(claim, now());
      if (entry) setPending((current) => [...current, entry]);
    },
    [active, now],
  );

  useEffect(() => {
    if (pending.length === 0) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!ready.current) {
        // Still reading the feed's end: re-arm this effect for the next tick.
        if (!cancelled) setPending((current) => [...current]);
        return;
      }
      let awards: Awaited<ReturnType<typeof getScoringAwards>>['awards'] = [];
      if (enabled.current || cursor.current !== null) {
        try {
          const page = await getScoringAwards(childId, cursor.current ?? undefined);
          awards = page.awards;
          if (page.cursor) {
            cursor.current = page.cursor;
            enabled.current = true;
          }
        } catch {
          awards = [];
        }
      }
      if (cancelled) return;
      const result = reconcilePending(pending, awards, now(), celebrated.current);
      for (const c of result.confirmed) celebrated.current.add(c.award.id);
      setPending(result.pending);
      if (result.confirmed.length > 0) setConfirmed((current) => [...current, ...result.confirmed]);
    }, pollMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [childId, pending, pollMs, now]);

  const dismiss = useCallback((awardId: string) => {
    setConfirmed((current) => current.filter((c) => c.award.id !== awardId));
  }, []);

  return { pending, confirmed, onGameplayEvent, dismiss };
}
