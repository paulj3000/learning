import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { UserMenu } from '../components/UserMenu';
import { ChildProfileList } from '../features/child-profile/ChildProfileList';
import {
  getOrCreateParentProfile,
  listChildProfiles,
  setChildProfileActive,
} from '../features/child-profile/api';
import type { ChildProfile, ParentProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'error';

export function ParentDashboard() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const parent = await getOrCreateParentProfile();
        const children = await listChildProfiles();
        if (cancelled) return;
        setParentProfile(parent);
        setChildProfiles(children);
        setLoadState('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Something went wrong.');
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleActive(child: ChildProfile) {
    const updated = await setChildProfileActive(child.id, !child.active);
    setChildProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {parentProfile ? `Welcome, ${parentProfile.displayName}` : 'Parent dashboard'}
        </h1>
        <UserMenu />
      </header>
      <main className={styles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading your family's island...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {loadState === 'ready' ? (
          <div className={styles.content}>
            <ChildProfileList childProfiles={childProfiles} onToggleActive={handleToggleActive} />
            <p>
              <Link to="/home/coop/new">
                Play together (shared adventure between two children)
              </Link>
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
