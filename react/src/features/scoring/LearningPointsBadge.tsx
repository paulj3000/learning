import type { ScoringSummary } from './types';
import styles from './scoring.module.css';

export function LearningPointsBadge({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  const n = summary.totals.learningPoints;
  return (
    <span className={styles.badge}>
      Learning Points: <strong>{n}</strong>
    </span>
  );
}
