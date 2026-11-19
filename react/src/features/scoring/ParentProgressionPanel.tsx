import { AdventureResults } from './AdventureResults';
import { humanizeKey } from './format';
import { useScoringSummary } from './useScoringSummary';
import type { ScoringEnabledSummary } from './types';
import styles from './scoring.module.css';

/** The parent's view of progression by subject. No transcripts and no child free text. */
export function ParentProgressionPanel({ childId }: { childId: string }) {
  const state = useScoringSummary(childId);
  if (state.status === 'disabled') return null;
  if (state.status === 'loading') return <p className={styles.muted}>Loading progress...</p>;
  if (state.status === 'error') return <p role="alert">{state.message}</p>;
  return <PanelView summary={state.summary} />;
}

function PanelView({ summary }: { summary: ScoringEnabledSummary }) {
  const { level, totals } = summary;
  return (
    <section className={styles.card} aria-labelledby="parent-progression">
      <h2 className={styles.title} id="parent-progression">
        Progress and rewards
      </h2>
      {summary.policy.provisional ? (
        <p className={styles.notice} role="note">
          Provisional development values. These numbers are for testing and may change.
        </p>
      ) : null}
      <p>
        Level {level.level}
        {level.nextLevelXp === null ? ' (top level reached)' : ''}
      </p>
      <ul className={styles.list}>
        <li>XP: {totals.xp}</li>
        <li>Learning Points: {totals.learningPoints}</li>
        <li>Treasure coins found: {totals.coins}</li>
        <li>Stars: {totals.stars}</li>
      </ul>
      <h3 className={styles.title}>By subject</h3>
      {summary.subjects.length === 0 ? (
        <p className={styles.muted}>Subjects will appear as your child learns.</p>
      ) : (
        <ul className={styles.list}>
          {summary.subjects.map((s) => (
            <li key={s.subject}>
              {humanizeKey(s.subject)}: {s.objectives} skills, {s.proficient} proficient,{' '}
              {s.mastered} mastered
            </li>
          ))}
        </ul>
      )}
      <h3 className={styles.title}>Adventure results</h3>
      {summary.adventures.length === 0 ? (
        <p className={styles.muted}>Adventure results will appear after the first visit.</p>
      ) : (
        summary.adventures.map((a) => <AdventureResults key={a.scopeKey} adventure={a} />)
      )}
    </section>
  );
}
