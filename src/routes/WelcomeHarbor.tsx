import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './WelcomeHarbor.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { CompanionIntro } from '../features/island/CompanionIntro';
import { ISLAND_LOCATIONS, isLocationUnlocked } from '../features/island/locations';
import { getTodaysEvent } from '../features/island/events';
import { getSeasonalIslandNote } from '../features/island/seasons';
import { getOrCreateCompanionProfile, getCompanionProfile } from '../features/island/api';
import { ChildAvatar } from '../features/child-profile/ChildAvatar';
import { getChildProfile } from '../features/child-profile/api';
import { listAllWorldChanges } from '../features/adventures/api';
import type { CompanionProfile } from '../features/island/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function WelcomeHarbor() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [companionProfile, setCompanionProfile] = useState<CompanionProfile | null>(null);
  const [worldChangeKeys, setWorldChangeKeys] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, companion, changes] = await Promise.all([
          getChildProfile(childId),
          getCompanionProfile(childId),
          listAllWorldChanges(childId),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setCompanionProfile(companion);
        setWorldChangeKeys(changes.map((change) => change.changeKey));
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
        <div className={styles.greeting}>
          {/* Decorative: the nickname is right there in the heading. */}
          <ChildAvatar
            avatarKey={childProfile.avatarKey}
            photoKey={childProfile.avatarPhotoKey}
            size="large"
          />
          <h1 className={styles.heading}>Welcome back, {childProfile.nickname}!</h1>
        </div>
        <p className={styles.event}>{getTodaysEvent(new Date())}</p>
        <p className={styles.event}>{getSeasonalIslandNote(new Date())}</p>
      </div>

      <h2 className={styles.mapHeading}>Where to next?</h2>
      <div className={styles.grid}>
        {ISLAND_LOCATIONS.filter((location) => isLocationUnlocked(location, worldChangeKeys)).map(
          (location) => (
            <Link
              className={styles.card}
              key={location.slug}
              to={`/island/${childId}/locations/${location.slug}`}
            >
              <p className={styles.cardTitle}>{location.title}</p>
              <p className={styles.cardTagline}>{location.tagline}</p>
            </Link>
          ),
        )}
      </div>

      <Link className={styles.logLink} to={`/island/${childId}/log`}>
        See your adventure log
      </Link>
      <Link className={styles.logLink} to={`/island/${childId}/world`}>
        Try walking around the island (new!)
      </Link>
      {/*
        Phase 15 replaced the single hardcoded "read The Dragon of Ember
        Mountain" link with the Adventure Library, which age-gates and
        interest-ranks every arc including that one. The harbor no longer
        needs to know which stories exist.
      */}
      <Link className={styles.logLink} to={`/island/${childId}/library`}>
        Open the adventure library (new!)
      </Link>
    </IslandLayout>
  );
}
