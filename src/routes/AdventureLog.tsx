import { Link, useParams } from 'react-router-dom';
import styles from './AdventureLog.module.css';
import { IslandLayout } from '../features/island/IslandLayout';

/**
 * Log shell only (docs/ROADMAP.md Phase 2 "adventure log shell"). Real
 * entries arrive once adventures exist to complete (Phase 3).
 */
export function AdventureLog() {
  const { childId } = useParams<{ childId: string }>();

  if (!childId) {
    return null;
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Adventure log</h1>
        <p className={styles.lead}>
          No adventures yet. Explore the island to start your first quest.
        </p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
