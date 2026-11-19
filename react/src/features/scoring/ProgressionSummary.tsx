import { AchievementList } from './AchievementList';
import { AdventureResults } from './AdventureResults';
import { CoinCounter } from './CoinCounter';
import { LearningPointsBadge } from './LearningPointsBadge';
import { TrophyShelf } from './TrophyShelf';
import { XpLevelIndicator } from './XpLevelIndicator';
import type { ScoringSummary } from './types';
import styles from './scoring.module.css';

export function ProgressionSummary({ summary }: { summary: ScoringSummary }) {
  if (!summary.enabled) return null;
  return (
    <div className={styles.card}>
      <XpLevelIndicator summary={summary} />
      <div className={styles.row}>
        <LearningPointsBadge summary={summary} />
        <CoinCounter summary={summary} />
      </div>
      {summary.adventures.map((a) => (
        <AdventureResults key={a.scopeKey} adventure={a} />
      ))}
      <AchievementList summary={summary} />
      <TrophyShelf summary={summary} />
    </div>
  );
}
