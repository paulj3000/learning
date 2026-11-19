import type { ScoringLevel, ScoringSummary } from './types';
import styles from './scoring.module.css';

export function XpLevelIndicator({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  return <LevelView level={summary.level} />;
}

function LevelView({ level }: { level: ScoringLevel }) {
  const next = level.nextLevelXp;
  if (next === null) {
    return (
      <div className={styles.badge}>
        <strong>Level {level.level}</strong>
        <span>Top level reached</span>
      </div>
    );
  }
  const span = Math.max(1, next - level.levelFloorXp);
  const done = Math.min(span, Math.max(0, level.xp - level.levelFloorXp));
  return (
    <div className={styles.card}>
      <strong>Level {level.level}</strong>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label={`Progress to level ${level.level + 1}`}
        aria-valuemin={0}
        aria-valuemax={span}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${span} XP`}
      >
        <div className={styles.progressFill} style={{ width: `${(done / span) * 100}%` }} />
      </div>
      <span className={styles.muted}>
        {done} of {span} XP toward level {level.level + 1}
      </span>
    </div>
  );
}
