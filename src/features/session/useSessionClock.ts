import { useEffect, useState } from 'react';
import { getChildProfile } from '../child-profile/api';
import { readSessionClock, resolveSessionStart, type SessionClockState } from './sessionClock';

/** How often the clock re-reads the time. A minute's resolution needs no more. */
const TICK_MS = 20_000;

const IDLE: SessionClockState = {
  elapsedMinutes: 0,
  limitMinutes: null,
  limitReached: false,
};

/**
 * How long this child has been on the island this sitting, and whether the
 * time their parent set has run out.
 *
 * Mounted once, by `IslandLayout`, which wraps every child-mode screen -
 * so the clock survives walking from the map into an adventure and back,
 * and there is exactly one of it. The start time lives in `sessionStorage`
 * (see `sessionClock.ts`) rather than in a database: the limit is about this
 * sitting, and nothing about how long a child played is written anywhere.
 *
 * The tick is deliberately coarse. A minute's resolution is all the calm
 * stop needs, and a per-second timer on every child screen would be a lot of
 * renders to tell nobody anything.
 */
export function useSessionClock(childProfileId: string): SessionClockState {
  const [limitMinutes, setLimitMinutes] = useState<number | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const storage = typeof window === 'undefined' ? null : window.sessionStorage;
    setStartedAtMs(resolveSessionStart(storage, childProfileId, Date.now()));

    /*
      A profile that will not load simply has no limit. The calm stop is a
      kindness rather than an enforcement, so failing to read it must never
      interrupt a child who is playing - and it is not worth an error state
      on screen either.
    */
    void getChildProfile(childProfileId)
      .then((profile) => {
        if (!cancelled) setLimitMinutes(profile?.sessionMinutes ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [childProfileId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  if (startedAtMs === null) return IDLE;
  return readSessionClock(startedAtMs, nowMs, limitMinutes);
}
