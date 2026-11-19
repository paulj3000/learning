import type { ScoringSummary } from './types';
import styles from './scoring.module.css';

export function TrophyShelf({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  return (
    <section className={styles.card} aria-labelledby="scoring-trophies">
      <h3 className={styles.title} id="scoring-trophies">
        Trophy shelf
      </h3>
      {summary.trophies.length === 0 ? (
        <p className={styles.muted}>There is room on the shelf for your first trophy.</p>
      ) : (
        <ul className={styles.list}>
          {summary.trophies.map((t) => (
            <li key={t.setId}>{t.displayName}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
