import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './WelcomeHarbor.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { CompanionIntro } from '../features/island/CompanionIntro';
import { ISLAND_LOCATIONS } from '../features/island/locations';
import { getTodaysEvent } from '../features/island/events';
import { getOrCreateCompanionProfile, getCompanionProfile } from '../features/island/api';
import { getChildProfile } from '../features/child-profile/api';
import type { CompanionProfile } from '../features/island/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function WelcomeHarbor() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [companionProfile, setCompanionProfile] = useState<CompanionProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, companion] = await Promise.all([
          getChildProfile(childId),
          getCompanionProfile(childId),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setCompanionProfile(companion);
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

  async function handleChooseCompanion() {
    if (!childId) return;
    const companion = await getOrCreateCompanionProfile(childId);
    setCompanionProfile(companion);
  }

  if (loadState === 'loading') {
    return <p>Loading the island...</p>;
  }
  if (loadState === 'not-found') {
    return <p role="alert">We could not find that child profile.</p>;
  }
  if (loadState === 'error') {
    return <p role="alert">Something went wrong loading the island.</p>;
  }
  if (!childId || !childProfile) {
    return null;
  }

  if (!companionProfile) {
    return (
      <CompanionIntro childNickname={childProfile.nickname} onChoose={handleChooseCompanion} />
    );
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.intro}>
        <h1 className={styles.heading}>Welcome back, {childProfile.nickname}!</h1>
        <p className={styles.event}>{getTodaysEvent(new Date())}</p>
      </div>

      <h2 className={styles.mapHeading}>Where to next?</h2>
      <div className={styles.grid}>
        {ISLAND_LOCATIONS.map((location) => (
          <Link
            className={styles.card}
            key={location.slug}
            to={`/island/${childId}/locations/${location.slug}`}
          >
            <p className={styles.cardTitle}>{location.title}</p>
            <p className={styles.cardTagline}>{location.tagline}</p>
          </Link>
        ))}
      </div>

      <Link className={styles.logLink} to={`/island/${childId}/log`}>
        See your adventure log
      </Link>
      <Link className={styles.logLink} to={`/island/${childId}/world`}>
        Try walking around the island (new!)
      </Link>
    </IslandLayout>
  );
}
