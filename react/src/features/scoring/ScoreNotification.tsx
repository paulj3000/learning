import { useEffect } from 'react';
import { prefersReducedMotion } from '../../lib/motionPreference';
import {
  describeAward,
  describePending,
  type ConfirmedAward,
  type PendingEntry,
} from './pendingAwards';
import styles from './scoring.module.css';

export interface ScoreNotificationProps {
  pending: readonly PendingEntry[];
  confirmed: readonly ConfirmedAward[];
  /** Called quietly after `dismissAfterMs`. Never shown to the child as a countdown. */
  onDismiss?: (key: string) => void;
  dismissAfterMs?: number;
}

export function ScoreNotification({
  pending,
  confirmed,
  onDismiss,
  dismissAfterMs = 5000,
}: ScoreNotificationProps) {
  const reduced = prefersReducedMotion();
  const toastClass = reduced ? styles.toast : `${styles.toast} ${styles.toastAnimated}`;
  const keys = confirmed.map((c) => c.award.id).join('|');

  useEffect(() => {
    if (!onDismiss || confirmed.length === 0) return;
    const timers = confirmed.map((c) =>
      window.setTimeout(() => onDismiss(c.award.id), dismissAfterMs),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, dismissAfterMs, onDismiss]);

  // Pending entries already settled are hidden: the confirmed line replaces them.
  const settled = new Set(confirmed.map((c) => c.pendingId));
  return (
    <div
      className={styles.toasts}
      role="status"
      aria-live="polite"
      data-motion={reduced ? 'reduced' : 'full'}
    >
      {pending
        .filter((p) => !settled.has(p.id))
        .map((p) => (
          <p key={p.id} className={toastClass}>
            {describePending(p)}
          </p>
        ))}
      {confirmed.map((c) => {
        const text = describeAward(c.award);
        return text ? (
          <p key={c.award.id} className={toastClass}>
            {text}
          </p>
        ) : null;
      })}
    </div>
  );
}
