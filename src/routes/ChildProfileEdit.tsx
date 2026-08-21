import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { ChildProfileForm } from '../features/child-profile/ChildProfileForm';
import { getChildProfile, updateChildProfile } from '../features/child-profile/api';
import type { ChildProfile, ChildProfileInput } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function ChildProfileEdit() {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const profile = await getChildProfile(childId);
        if (cancelled) return;
        if (!profile) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(profile);
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

  async function handleSubmit(input: ChildProfileInput) {
    if (!childId) return;
    await updateChildProfile(childId, input);
    navigate('/home');
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Edit child profile</h1>
        <Link to="/home">Back to dashboard</Link>
      </header>
      <main className={styles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading profile...</p> : null}
        {loadState === 'not-found' ? (
          <p role="alert">We could not find that child profile.</p>
        ) : null}
        {loadState === 'error' ? (
          <p className={styles.error} role="alert">
            Something went wrong loading this profile.
          </p>
        ) : null}
        {loadState === 'ready' && childProfile ? (
          <ChildProfileForm
            submitLabel="Save changes"
            initialValue={{
              nickname: childProfile.nickname,
              ageBand: childProfile.ageBand,
              avatarKey: childProfile.avatarKey,
              avatarPhotoKey: childProfile.avatarPhotoKey ?? null,
              interests: (childProfile.interests ?? []).filter((interest): interest is string =>
                Boolean(interest),
              ),
              readingMode: childProfile.readingMode,
              sessionMinutes: childProfile.sessionMinutes,
            }}
            onSubmit={handleSubmit}
          />
        ) : null}
      </main>
    </div>
  );
}
