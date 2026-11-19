import type { ScoringSummary } from './types';
import styles from './scoring.module.css';

export function AchievementList({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  return (
    <section className={styles.card} aria-labelledby="scoring-achievements">
      <h3 className={styles.title} id="scoring-achievements">
        Keepsakes
      </h3>
      {summary.achievements.length === 0 ? (
        <p className={styles.muted}>Your first keepsake is waiting on the island.</p>
      ) : (
        <ul className={styles.list}>
          {summary.achievements.map((a) => (
            <li key={a.itemId}>
              <strong>{a.displayName}</strong>
              <span className={styles.muted}> {a.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
