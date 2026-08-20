import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from './ChildDashboard.module.css';
import {
  listAllChildProfiles,
  listAllParentProfiles,
  groupChildrenByParent,
} from '../features/admin/api';
import type { ParentWithChildren } from '../features/admin/api';
import { AGE_BAND_LABELS } from '../features/child-profile/constants';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Read-only admin directory (CLAUDE.md section 2/10,
 * docs/AUTHORIZATION_REVIEW.md section 4.3): every parent account and their
 * child profiles, grouped by parent. Reachable only through
 * `RequireAdmin`/the Cognito `Admins` group. Each child links to
 * `AdminChildProgress` for that child's learning progress; nothing here is
 * editable — parents remain the only ones who can change a child's own
 * settings or delete their data.
 */
export function AdminDashboard() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [groups, setGroups] = useState<ParentWithChildren[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [parents, children] = await Promise.all([
          listAllParentProfiles(),
          listAllChildProfiles(),
        ]);
        if (cancelled) return;
        setGroups(groupChildrenByParent(parents, children));
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
  }, []);

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>Admin</h1>
        <Link to="/home">Back to my dashboard</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading families...</p> : null}
        {loadState === 'error' ? (
          <p className={parentStyles.error} role="alert">
            Something went wrong loading the admin directory.
          </p>
        ) : null}
        {loadState === 'ready' ? (
          <div className={styles.sections}>
            {groups.length === 0 ? <p className={styles.hint}>No parent accounts yet.</p> : null}
            {groups.map(({ parent, children }) => (
              <section className={styles.section} key={parent.id}>
                <h2 className={styles.heading}>{parent.displayName}</h2>
                <p className={styles.hint}>
                  {parent.timezone ?? 'No timezone on file'} &middot; {children.length}{' '}
                  {children.length === 1 ? 'child' : 'children'}
                </p>
                {children.length === 0 ? (
                  <p className={styles.hint}>No child profiles yet.</p>
                ) : (
                  <ul className={styles.list}>
                    {children.map((child) => (
                      <li className={styles.card} key={child.id}>
                        <p className={styles.cardTitle}>
                          <Link className={styles.link} to={`/admin/children/${child.id}`}>
                            {child.nickname}
                          </Link>
                        </p>
                        <p className={styles.cardMeta}>
                          {AGE_BAND_LABELS[child.ageBand]} &middot;{' '}
                          {child.active ? 'Active' : 'Deactivated'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}
