import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './TravelDeck.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getChildProfile } from '../features/child-profile/api';
import { loadTravelDeck, loadTravelPack } from '../features/worlds/api';
import { describeTravelPack } from '../features/worlds/travelPack';
import { getHomeWorld } from '../features/worlds/worlds';
import type { ChildProfile } from '../features/child-profile/api';
import type { TravelDestination } from '../features/worlds/types';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * The travel deck (docs/ROADMAP.md Phase 29, "a travel system").
 *
 * Every world this child could see is listed, open or not. A closed route
 * shows its authored `lockedHint` rather than being hidden, because the boat
 * at the end of the dock is visible from the beach: pretending the other
 * islands do not exist would make the world feel smaller, and a hint that
 * names what to do next is not pressure (CLAUDE.md pillar 7). Secret
 * *locations* still hide, which is a different promise.
 */
export function TravelDeck() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [destinations, setDestinations] = useState<TravelDestination[]>([]);
  const [packNote, setPackNote] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
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
        const [deck, pack] = await Promise.all([
          loadTravelDeck(childId, child.ageBand),
          // The backpack line is reassurance, not data the page needs: a
          // failure here must not stop a child from sailing.
          loadTravelPack(childId).catch(() => undefined),
        ]);
        if (cancelled) return;
        setDestinations(deck.destinations);
        setPackNote(pack ? describeTravelPack(pack) : '');
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

  if (!childId) return null;

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Looking out to sea...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error') {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong down at the dock.</p>
        <Link className={styles.backLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  const homeSlug = getHomeWorld().slug;

  return (
    <IslandLayout childId={childId}>
      <div className={styles.intro}>
        <h1 className={styles.heading}>The Sailing Dock</h1>
        <p className={styles.lede}>Pick an island to sail to.</p>
      </div>

      <div className={styles.grid}>
        {destinations.map(({ world, isUnlocked, lockedHint, isCurrent }) => {
          if (!isUnlocked) {
            return (
              <div className={styles.lockedCard} key={world.slug}>
                <p className={styles.cardTitle}>{world.title}</p>
                <p className={styles.cardTagline}>{world.tagline}</p>
                <p className={styles.lockedHint}>{lockedHint}</p>
              </div>
            );
          }
          const to =
            world.slug === homeSlug
              ? `/island/${childId}`
              : `/island/${childId}/worlds/${world.slug}`;
          return (
            <Link className={styles.card} key={world.slug} to={to}>
              <p className={styles.cardTitle}>{world.title}</p>
              <p className={styles.cardTagline}>{world.tagline}</p>
              {isCurrent ? <p className={styles.hereBadge}>You are here</p> : null}
            </Link>
          );
        })}
      </div>

      {packNote ? <p className={styles.packNote}>{packNote}</p> : null}

      <Link className={styles.backLink} to={`/island/${childId}`}>
        Back to the map
      </Link>
    </IslandLayout>
  );
}
