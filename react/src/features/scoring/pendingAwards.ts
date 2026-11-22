/**
 * The pending versus confirmed model (pure, no React).
 *
 * A pending entry is the UI's memory that the engine claimed something happened. It carries no
 * amount and no currency value: only the server decides amounts. It becomes confirmed when the
 * awards feed holds a ledger AWARD whose source matches, and the confirmed notification shows the
 * server's amount. An unmatched pending entry expires after a timeout and is dropped silently; it
 * is never shown as "lost" or "failed". CORRECTION entries are never celebrated.
 */
import type { AwardEntry, SourceKind } from './types';

export const PENDING_TTL_MS = 20_000;

export type PendingClaimType = 'ANSWER_CHECK' | 'AWARD_CLAIM';

export interface PendingHint {
  /** Ledger source kinds this claim could be confirmed as. */
  sourceKinds: readonly SourceKind[];
  /** Exact `sourceRef` when derivable, else `null`. */
  sourceRef: string | null;
  /** When the exact ref is not derivable: a ref that ends with `/<suffix>` or equals it. */
  sourceRefSuffix: string | null;
}

export interface PendingEntry {
  id: string;
  claimType: PendingClaimType;
  hint: PendingHint;
  createdAtMs: number;
}

export interface ConfirmedAward {
  award: AwardEntry;
  /** The pending entry this settled, when one matched. */
  pendingId: string | null;
}

/** Only ledger AWARD entries are ever celebrated, and never a non-positive amount. */
export function isCelebratable(entry: AwardEntry): boolean {
  return entry.entryKind === 'AWARD' && entry.amount > 0;
}

export function matchesHint(hint: PendingHint, award: AwardEntry): boolean {
  if (!hint.sourceKinds.includes(award.sourceKind)) return false;
  if (hint.sourceRef !== null) return award.sourceRef === hint.sourceRef;
  if (hint.sourceRefSuffix !== null) {
    return (
      award.sourceRef === hint.sourceRefSuffix ||
      award.sourceRef.endsWith(`/${hint.sourceRefSuffix}`)
    );
  }
  return true;
}

export function isExpired(entry: PendingEntry, nowMs: number, ttlMs = PENDING_TTL_MS): boolean {
  return nowMs - entry.createdAtMs >= ttlMs;
}

export interface ReconcileResult {
  /** Still waiting for the server. */
  pending: readonly PendingEntry[];
  /** Celebratable awards from the feed, in feed order. */
  confirmed: readonly ConfirmedAward[];
}

/**
 * Settles pending entries against a batch of feed awards and drops expired ones silently.
 * `celebratedIds` are awards already shown, so a re-fetched batch never celebrates twice.
 */
export function reconcilePending(
  pending: readonly PendingEntry[],
  awards: readonly AwardEntry[],
  nowMs: number,
  celebratedIds: ReadonlySet<string> = new Set(),
  ttlMs = PENDING_TTL_MS,
): ReconcileResult {
  const fresh = awards.filter((a) => isCelebratable(a) && !celebratedIds.has(a.id));
  const settled = new Set<string>();
  const confirmed: ConfirmedAward[] = fresh.map((award) => {
    const match = pending.find((p) => !settled.has(p.id) && matchesHint(p.hint, award));
    if (match) settled.add(match.id);
    return { award, pendingId: match?.id ?? null };
  });
  // A pending entry may match several awards (XP plus coins from one source): settle it for all.
  for (const p of pending) {
    if (fresh.some((a) => matchesHint(p.hint, a))) settled.add(p.id);
  }
  return {
    pending: pending.filter((p) => !settled.has(p.id) && !isExpired(p, nowMs, ttlMs)),
    confirmed,
  };
}

/** The line shown for a confirmed award: always the server's amount, never negative. */
export function describeAward(entry: AwardEntry): string | null {
  if (!isCelebratable(entry)) return null;
  const n = entry.amount;
  switch (entry.currency) {
    case 'XP':
      return `+${n} XP`;
    case 'LEARNING_POINTS':
      return `+${n} Learning ${n === 1 ? 'Point' : 'Points'}`;
    case 'COINS':
      return `+${n} ${n === 1 ? 'coin' : 'coins'} found`;
    case 'STAR':
      return `+${n} ${n === 1 ? 'star' : 'stars'}`;
  }
}

/** The line shown for a pending entry: no numbers, no correctness claim. */
export function describePending(entry: PendingEntry): string {
  return entry.claimType === 'ANSWER_CHECK' ? 'Checking your answer...' : 'Checking...';
}
