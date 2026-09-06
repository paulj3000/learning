/**
 * The session clock: how long this child has been on the island, and
 * whether the time their parent set has run out.
 *
 * MVP scope item 11 promises "session time controls and a calm stopping
 * point". Until now only the control existed: `ChildProfile.sessionMinutes`
 * is validated per age band, stored, editable on the profile form and shown
 * on the parent dashboard, and **nothing anywhere read it at play time**. A
 * parent set twelve minutes and the app did not know.
 *
 * Pure functions and a plain shape, no React and no timers, so the rules can
 * be tested without a clock. `useSessionClock.ts` is the thin part that
 * knows what time it is.
 *
 * Three things this deliberately does not do, from CLAUDE.md section 7's
 * "calm engagement - no dark patterns" and the storyboard's beat 13:
 *
 * - **No countdown.** A child is never shown time draining away. The only
 *   thing that ever crosses the boundary is "it is a good moment to stop".
 * - **No lockout.** Reaching the limit does not end anything, take anything
 *   away, or block the next tap. A three-year-old stopped mid-sentence
 *   learns that the island punishes them for playing.
 * - **No streak, score, or come-back-or-lose framing.** Stopping is not a
 *   loss and continuing is not a win.
 */

/** How long a child has been here, and what that means for the calm stop. */
export interface SessionClockState {
  /** Whole minutes since this session began. */
  elapsedMinutes: number;
  /** The parent-configured limit for this child, if they have one. */
  limitMinutes: number | null;
  /** Whether the limit has been reached. `false` when there is no limit set. */
  limitReached: boolean;
}

/**
 * A child with no `sessionMinutes` set has no limit, and no calm stop is
 * ever suggested to them - the absence of a setting is not a default of
 * zero.
 */
export function readSessionClock(
  startedAtMs: number,
  nowMs: number,
  limitMinutes: number | null | undefined,
): SessionClockState {
  const elapsedMinutes = Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
  const limit = typeof limitMinutes === 'number' && limitMinutes > 0 ? limitMinutes : null;
  return {
    elapsedMinutes,
    limitMinutes: limit,
    limitReached: limit !== null && elapsedMinutes >= limit,
  };
}

/**
 * Where a session's start time is kept, so walking from the map into an
 * adventure and back does not restart the clock.
 *
 * `sessionStorage` rather than a database: the limit is about *this sitting*,
 * not a lifetime total, and it should reset when the tab closes. It is also
 * the reading that keeps this out of `ChildProfile` entirely - nothing about
 * how long a child played is written anywhere, which is the same restraint
 * CLAUDE.md section 13 asks for about logging children.
 */
export const SESSION_START_STORAGE_PREFIX = 'lai:session-start:';

export function sessionStartKey(childProfileId: string): string {
  return `${SESSION_START_STORAGE_PREFIX}${childProfileId}`;
}

/**
 * Reads this child's session start, beginning one at `nowMs` if there is
 * none or the stored value is unusable.
 *
 * Storage can be unavailable (private browsing, a browser set to block site
 * data) and can hold anything, so a failed read starts a fresh session
 * rather than throwing: the worst case is that a child gets their full time
 * again, which is the right way round for this feature to fail.
 */
export function resolveSessionStart(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
  childProfileId: string,
  nowMs: number,
): number {
  if (!storage) return nowMs;
  const key = sessionStartKey(childProfileId);
  try {
    const stored = Number.parseInt(storage.getItem(key) ?? '', 10);
    // A start in the future is a clock change or a corrupt value, not a session.
    if (Number.isFinite(stored) && stored > 0 && stored <= nowMs) return stored;
    storage.setItem(key, String(nowMs));
  } catch {
    return nowMs;
  }
  return nowMs;
}
