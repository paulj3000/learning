import type { ScoringSummary } from './types';
import styles from './scoring.module.css';

/** Coins are treasure the child has found. They are never spent, so there is no shop here. */
export function CoinCounter({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  const n = summary.totals.coins;
  return (
    <span className={styles.badge}>
      Treasure found: <strong>{n}</strong> {n === 1 ? 'coin' : 'coins'}
    </span>
  );
}
