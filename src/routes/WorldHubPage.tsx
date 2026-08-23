import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './WorldHubPage.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getChildProfile } from '../features/child-profile/api';
import { listAllWorldChanges } from '../features/adventures/api';
import { isLocationUnlocked, listLocationsInWorld } from '../features/island/locations';
import { getWorld } from '../features/worlds/worlds';
import { recordArrival } from '../features/worlds/api';
import type { ChildProfile } from '../features/child-profile/api';
import type { IslandLocation } from '../features/island/locations';

type LoadState = 'loading' | 'ready' | 'not-found' | 'unreachable' | 'error';

/**
 * A world's hub: what Welcome Harbor is for the home island, for every other
 * world (docs/ROADMAP.md Phase 29).
 *
 * Deliberately generic. It renders whatever world the route names out of the
 * registry and whatever locations that world's content claims, so the tenth
 * island needs a `WorldDefinition` and some locations, not a tenth copy of
 * this file. That is the section 39 authoring principle applied to the shell
 * as well as to the content.
 *
 * The home world is not served here: Welcome Harbor has been its hub since
 * Phase 2, with onboarding, the daily event, and the seasonal note attached
 * to it, and a second, thinner version of that page would be a worse home
 * rather than a more consistent one.
 */
export function WorldHubPage() {
  const { childId, worldSlug } = useParams<{ childId: string; worldSlug: string }>();
  const world = worldSlug ? getWorld(worldSlug) : undefined;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [locations, setLocations] = useState<IslandLocation[]>([]);
  const [arrivalText, setArrivalText] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId || !world) {
        setLoadState('not-found');
        return;
      }
      try {
        const child: ChildProfile | null = await getChildProfile(childId);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }

        // Re-checked here rather than trusted from the travel deck: a
        // bookmarked or shared URL reaches this route without passing the
        // deck at all.
        const arrival = await recordArrival(childId, world.slug, child.ageBand);
        if (cancelled) return;
        if (!arrival.arrived) {
          setLoadState('unreachable');
          return;
        }

        const changes = await listAllWorldChanges(childId).catch(() => []);
        if (cancelled) return;
        const keys = changes.map((change) => change.changeKey);
        setLocations(
          listLocationsInWorld(world.slug).filter((location) => isLocationUnlocked(location, keys)),
        );
        setArrivalText(arrival.arrivalText ?? '');
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
    // `world` is derived from `worldSlug` and is stable for a given slug.
  }, [childId, world, worldSlug]);

  if (!childId) return null;

  if (!world || loadState === 'not-found') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that island.</p>
        <Link className={styles.backLink} to={`/island/${childId}/travel`}>
          Back to the sailing dock
        </Link>
      </IslandLayout>
    );
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Sailing across...</p>
      </IslandLayout>
    );
  }

  if (loadState === 'unreachable') {
    return (
      <IslandLayout childId={childId}>
        <p className={styles.arrival}>
          {world.travelRequirement?.lockedHint ?? 'That island is not ready for visitors yet.'}
        </p>
        <Link className={styles.backLink} to={`/island/${childId}/travel`}>
          Back to the sailing dock
        </Link>
      </IslandLayout>
    );
  }

  if (loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong on the way there.</p>
        <Link className={styles.backLink} to={`/island/${childId}/travel`}>
          Back to the sailing dock
        </Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <div className={styles.intro}>
        <h1 className={styles.heading}>{world.title}</h1>
        <p className={styles.lede}>{world.description}</p>
      </div>
      {arrivalText ? <p className={styles.arrival}>{arrivalText}</p> : null}

      <h2 className={styles.locationsHeading}>Where to next?</h2>
      <div className={styles.grid}>
        {locations.map((location) => (
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

      <Link className={styles.backLink} to={`/island/${childId}/travel`}>
        Back to the sailing dock
      </Link>
    </IslandLayout>
  );
}
