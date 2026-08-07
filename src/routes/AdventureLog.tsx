import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './AdventureLog.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { listSessions } from '../features/adventures/api';
import { getAdventureTemplate } from '../features/adventures/content';
import type { AdventureSession } from '../features/adventures/api';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_LABELS: Record<AdventureSession['status'], string> = {
  ACTIVE: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ABANDONED: 'Not finished',
  SAFETY_STOPPED: 'Stopped',
};

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function AdventureLog() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [sessions, setSessions] = useState<AdventureSession[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) return;
      try {
        const data = await listSessions(childId);
        if (cancelled) return;
        setSessions(data);
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  if (!childId) {
    return null;
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Adventure log</h1>

        {loadState === 'loading' ? <p className={styles.lead}>Loading your adventures...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.lead} role="alert">
            Something went wrong loading your adventures.
          </p>
        ) : null}
        {loadState === 'ready' && sessions.length === 0 ? (
          <p className={styles.lead}>
            No adventures yet. Explore the island to start your first quest.
          </p>
        ) : null}

        {loadState === 'ready' && sessions.length > 0 ? (
          <ul className={styles.list}>
            {sessions.map((session) => {
              const template = getAdventureTemplate(session.templateSlug);
              return (
                <li className={styles.entry} key={session.id}>
                  <p className={styles.entryTitle}>{template?.title ?? session.templateSlug}</p>
                  <p className={styles.entryMeta}>
                    {STATUS_LABELS[session.status]} &middot;{' '}
                    {formatDate(session.completedAt ?? session.lastActivityAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}

        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
