import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './IslandLocationPage.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getIslandLocation } from '../features/island/locations';
import { getAdventureTemplatesForLocation } from '../features/adventures/content';
import { listWorldChanges } from '../features/adventures/api';
import { getChildProfile } from '../features/child-profile/api';
import type { WorldChange } from '../features/adventures/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function IslandLocationPage() {
  const { childId, locationSlug } = useParams<{ childId: string; locationSlug: string }>();
  const location = locationSlug ? getIslandLocation(locationSlug) : undefined;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [worldChanges, setWorldChanges] = useState<WorldChange[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId || !location) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, changes] = await Promise.all([
          getChildProfile(childId),
          listWorldChanges(childId, location.slug),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setWorldChanges(changes);
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
    // location is derived from locationSlug and is stable for a given slug
  }, [childId, location, locationSlug]);

  if (!childId) {
    return null;
  }

  if (!location) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that part of the island.</p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading the location...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error' || !childProfile) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading this part of the island.</p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  const template = getAdventureTemplatesForLocation(location.slug)[0];
  const isAgeSupported = template ? template.ageBands.includes(childProfile.ageBand) : false;
  const worldChangeStep = template?.steps.find((step) => step.type === 'WORLD_CHANGE');
  const worldChangePresentation =
    worldChangeStep?.presentation.kind === 'world-change'
      ? worldChangeStep.presentation
      : undefined;
  const isWorldChanged = worldChangePresentation
    ? worldChanges.some((change) => change.changeKey === worldChangePresentation.payload.changeKey)
    : false;

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{location.title}</h1>
        <p className={styles.tagline}>{location.tagline}</p>
        <p className={styles.description}>{location.description}</p>
        <ul className={styles.skills}>
          {location.skills.map((skill) => (
            <li className={styles.skill} key={skill}>
              {skill}
            </li>
          ))}
        </ul>
        <p className={styles.decoration}>
          {isWorldChanged && worldChangePresentation
            ? worldChangePresentation.text
            : location.decoration}
        </p>
        {template && isAgeSupported ? (
          <Link
            className={styles.startLink}
            to={`/island/${childId}/locations/${location.slug}/adventures/${template.slug}`}
          >
            {isWorldChanged ? `Play "${template.title}" again` : `Start: ${template.title}`}
          </Link>
        ) : null}
        {template && !isAgeSupported ? (
          <p className={styles.decoration}>This adventure is not available for your age yet.</p>
        ) : null}
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
