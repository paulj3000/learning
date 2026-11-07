import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './WelcomeHarbor.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { CompanionIntro } from '../features/island/CompanionIntro';
import { IslandExplorer } from '../features/island/IslandExplorer';
import { listLocationsInWorld } from '../features/island/locations';
import { getHomeWorld } from '../features/worlds/worlds';
import { listTravelDestinations } from '../features/worlds/travel';
import { buildIslandExplorer } from '../features/worlds/islandExplorer';
import { getTodaysEvent } from '../features/island/events';
import { getSeasonalIslandNote } from '../features/island/seasons';
import { getOrCreateCompanionProfile, getCompanionProfile } from '../features/island/api';
import { ChildAvatar } from '../features/child-profile/ChildAvatar';
import { getChildProfile } from '../features/child-profile/api';
import { listAllWorldChanges } from '../features/adventures/api';
import { isIslandAvailable } from '../features/catalog/availability';
import { loadCatalogSnapshot } from '../features/catalog/availabilityApi';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';
import { WELCOME_HARBOR_REGION_ID } from '../features/discovery/checkpoints';
import type { CompanionProfile } from '../features/island/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function WelcomeHarbor() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [companionProfile, setCompanionProfile] = useState<CompanionProfile | null>(null);
  const [worldChangeKeys, setWorldChangeKeys] = useState<string[]>([]);
  /** Island slugs an admin has deactivated (ADR-031); never shown on the map. */
  const [hiddenSlugs, setHiddenSlugs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, companion, changes, catalog] = await Promise.all([
          getChildProfile(childId),
          getCompanionProfile(childId),
          listAllWorldChanges(childId),
          loadCatalogSnapshot(),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setCompanionProfile(companion);
        setWorldChangeKeys(changes.map((change) => change.changeKey));
        setHiddenSlugs(
          catalog.islands
            .filter((island) => !isIslandAvailable(catalog, island.slug))
            .map((island) => island.slug),
        );
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

      {/*
        LAI-0808: the Island Explorer. Every island this child could see,
        from the same rules the Sailing Dock uses: the island they are on
        with its places, open islands one tap away, locked islands shown
        with their hint and never as a link. Computed from the world
        changes already loaded above, so it adds no request and no new
        failure mode to the homepage.
      */}
      <IslandExplorer
        islands={buildIslandExplorer({
          childId,
          destinations: listTravelDestinations({
            worldChangeKeys,
            ageBand: childProfile.ageBand,
          }),
          currentIslandLocations: listLocationsInWorld(getHomeWorld().slug),
          worldChangeKeys,
          hiddenLocationSlugs: hiddenSlugs,
        })}
      />

      <Link className={styles.logLink} to={`/island/${childId}/log`}>
        See your adventure log
      </Link>
      <Link className={styles.logLink} to={`/island/${childId}/quests`}>
        Open your quest journal (new!)
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
      {/*
        Phase 31: an early, intentionally rough look at the Three.js
        first-person world the island is migrating toward (ADR-008 in
        docs/DECISIONS.md), not a finished location, so it is not listed
        as an `IslandLocation` card above.
      */}
      <Link className={styles.logLink} to={`/island/${childId}/world/three-sandbox`}>
        Peek at an early 3D preview (new!)
      </Link>
      {/*
        Phase 32: Welcome Harbor rebuilt as a real first-person region
        (docs/ROADMAP.md Phase 32). Kept as an auxiliary link rather than
        replacing the harbor's own card-based hub or the Phase 9 walking
        route above: ADR-008's Sprouts (ages 3-4) accessibility playtest has
        not run yet, so first-person navigation is not this band's primary
        route until it does (docs/IMPLEMENTATION_STATUS.md "Known
        limitations (Phase 32)"). Older bands can already use it as a real
        alternative way to explore.
      */}
      <Link className={styles.logLink} to={locationWorldPath(childId, WELCOME_HARBOR_REGION_ID)}>
        Explore the harbor in 3D (new!)
      </Link>
    </IslandLayout>
  );
}
