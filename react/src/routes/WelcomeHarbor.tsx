import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { CompanionIntro } from '../features/island/CompanionIntro';
import { IslandExplorer } from '../features/island/IslandExplorer';
import { listLocationsInWorld } from '../features/island/locations';
import { getHomeWorld } from '../features/worlds/worlds';
import { listTravelDestinations } from '../features/worlds/travel';
import {
  buildIslandExplorer,
  buildIslandExplorerFromServer,
  type ExplorerIsland,
} from '../features/worlds/islandExplorer';
import { getTodaysEvent } from '../features/island/events';
import { getSeasonalIslandNote } from '../features/island/seasons';
import { getOrCreateCompanionProfile, getCompanionProfile } from '../features/island/api';
import { ChildAvatar } from '../features/child-profile/ChildAvatar';
import { getChildProfile } from '../features/child-profile/api';
import { listAllWorldChanges } from '../features/adventures/api';
import { isIslandAvailable } from '../features/catalog/availability';
import { loadCatalogSnapshot } from '../features/catalog/availabilityApi';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';
import { DJANGO_API_CONFIG } from '../api/config';
import { getIslandsFor } from '../api/play/islandsApi';
import { getChildHomeFor } from '../api/play/homeApi';
import { ChildHomeDashboard, type ChildHomeState } from '../features/child-home/ChildHomeDashboard';
import { WELCOME_HARBOR_REGION_ID } from '../features/discovery/checkpoints';
import { isLeftIslandState, LEAVE_ISLAND_COPY } from '../features/portal/exit';
import { PortalButton } from '../features/portal/ui';
import type { CompanionProfile } from '../features/island/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * Where the homepage reads from. With the Django API (`VITE_BACKEND=django`) everything comes
 * from Django: the published Island catalog for the Island Explorer (AP-03) and the home summary
 * for the dashboard (AP-02). A build without it (every hosted Amplify build until the ADR-019
 * cutover) keeps the source-controlled explorer and has no dashboard, exactly as before.
 */
type HomeSource =
  { kind: 'amplify' } | { kind: 'django'; islands: IslandsState; home: ChildHomeState };

type IslandsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; islands: ExplorerIsland[] };

export function WelcomeHarbor() {
  const { childId } = useParams<{ childId: string }>();
  /** AP-04: arrived from "Leave island", so say calmly that nothing was lost. */
  const leftIsland = isLeftIslandState(useLocation().state);
  const djangoMode = DJANGO_API_CONFIG.enabled;
  const [source, setSource] = useState<HomeSource>({ kind: 'amplify' });
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
      if (djangoMode) {
        await loadFromDjango(childId);
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

    /**
     * Django mode: the child profile decides the page; the Island catalog and the home summary
     * each fail on their own, so one slow or broken read never blanks the whole homepage. There
     * is no companion record in Django yet, and Chatty is the only companion, so the companion
     * step is not shown here.
     */
    async function loadFromDjango(id: string) {
      setSource({ kind: 'django', islands: { status: 'loading' }, home: { status: 'loading' } });
      const islands = getIslandsFor(id).then(
        (view): IslandsState => ({
          status: 'ready',
          islands: buildIslandExplorerFromServer(id, view),
        }),
        (): IslandsState => ({ status: 'error' }),
      );
      const home = getChildHomeFor(id).then(
        (summary): ChildHomeState => ({ status: 'ready', home: summary }),
        (): ChildHomeState => ({ status: 'error' }),
      );
      try {
        const child = await getChildProfile(id);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('error');
        return;
      }
      const [explorer, summary] = await Promise.all([islands, home]);
      if (!cancelled) setSource({ kind: 'django', islands: explorer, home: summary });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId, djangoMode]);

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

  // Django mode has no companion record yet; Chatty is the only companion (see loadFromDjango).
  if (!companionProfile && !djangoMode) {
    return (
      <CompanionIntro childNickname={childProfile.nickname} onChoose={handleChooseCompanion} />
    );
  }

  return (
    <IslandLayout childId={childId}>
      {/*
        AP-01: the welcome is the Adventure Portal's hero, in the portal's
        ocean and treasure colours (portal.css), so the new theme is what a
        child sees first on their homepage.
      */}
      <section
        aria-labelledby="welcome-heading"
        data-portal="welcome-hero"
        className="flex w-full max-w-5xl flex-col gap-4 rounded-3xl border-b-4 border-ocean-900 bg-ocean-700 p-6 text-white shadow-sm md:p-8"
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* Decorative: the nickname is right there in the heading. */}
          <span className="rounded-full border-4 border-treasure-300 bg-paper">
            <ChildAvatar
              avatarKey={childProfile.avatarKey}
              photoKey={childProfile.avatarPhotoKey}
              size="large"
            />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="m-0 text-lg font-semibold text-white">Adventure Island</p>
            <h1 id="welcome-heading" className="m-0 font-display text-3xl text-white md:text-4xl">
              Welcome back, {childProfile.nickname}!
            </h1>
          </div>
        </div>
        {leftIsland ? (
          <p
            className="m-0 rounded-2xl bg-tropical-50 px-4 py-3 font-semibold text-ink"
            role="status"
          >
            {LEAVE_ISLAND_COPY.welcomeBack}
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <p className="m-0 rounded-2xl bg-treasure-50 px-4 py-3 text-ink">
            <span aria-hidden="true">☀️ </span>
            {getTodaysEvent(new Date())}
          </p>
          <p className="m-0 rounded-2xl bg-ocean-50 px-4 py-3 text-ink">
            <span aria-hidden="true">🌊 </span>
            {getSeasonalIslandNote(new Date())}
          </p>
        </div>
      </section>

      {/*
        AP-02 dashboard, then the Island Explorer (LAI-0808, AP-03): the
        island they are on with its places, open islands one tap away,
        locked islands shown with their hint and never as a link. With the
        Django API both come from Django (the published catalog and the
        home summary). Without it, the explorer is computed from the same
        rules the Sailing Dock uses and the world changes loaded above.
      */}
      {source.kind === 'django' ? (
        <ChildHomeDashboard childId={childId} state={source.home} />
      ) : null}

      {source.kind === 'django' ? (
        source.islands.status === 'loading' ? (
          <p className="m-0 w-full max-w-5xl text-ink" role="status">
            Finding your islands...
          </p>
        ) : source.islands.status === 'error' ? (
          <p
            className="m-0 w-full max-w-5xl rounded-2xl bg-coral-50 px-4 py-3 text-ink"
            role="alert"
          >
            We could not load the islands right now. Please try again in a moment.
          </p>
        ) : source.islands.islands.length === 0 ? (
          <p className="m-0 w-full max-w-5xl text-ink">
            New islands are on their way. Come back soon.
          </p>
        ) : (
          <IslandExplorer islands={source.islands.islands} />
        )
      ) : (
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
      )}

      <section
        aria-labelledby="more-to-explore-heading"
        className="flex w-full max-w-5xl flex-col gap-4"
      >
        <h2 id="more-to-explore-heading" className="m-0 font-display text-2xl text-ocean-900">
          More to explore
        </h2>
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          <li className="flex">
            <PortalButton asChild tone="ocean" size="lg" block>
              <Link to={`/island/${childId}/log`}>See your adventure log</Link>
            </PortalButton>
          </li>
          <li className="flex">
            <PortalButton asChild tone="coral" size="lg" block>
              <Link to={`/island/${childId}/quests`}>Open your quest journal (new!)</Link>
            </PortalButton>
          </li>
          <li className="flex">
            <PortalButton asChild tone="tropical" size="lg" block>
              <Link to={`/island/${childId}/world`}>Try walking around the island (new!)</Link>
            </PortalButton>
          </li>
          {/*
            Phase 15 replaced the single hardcoded "read The Dragon of Ember
            Mountain" link with the Adventure Library, which age-gates and
            interest-ranks every arc including that one. The harbor no longer
            needs to know which stories exist.
          */}
          <li className="flex">
            <PortalButton asChild tone="purple" size="lg" block>
              <Link to={`/island/${childId}/library`}>Open the adventure library (new!)</Link>
            </PortalButton>
          </li>
          {/*
            Phase 31: an early, intentionally rough look at the Three.js
            first-person world the island is migrating toward (ADR-008 in
            docs/DECISIONS.md), not a finished location, so it is not listed
            as an `IslandLocation` card above.
          */}
          <li className="flex">
            <PortalButton asChild tone="quiet" size="lg" block>
              <Link to={`/island/${childId}/world/three-sandbox`}>
                Peek at an early 3D preview (new!)
              </Link>
            </PortalButton>
          </li>
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
          <li className="flex">
            <PortalButton asChild tone="treasure" size="lg" block>
              <Link to={locationWorldPath(childId, WELCOME_HARBOR_REGION_ID)}>
                Explore the harbor in 3D (new!)
              </Link>
            </PortalButton>
          </li>
        </ul>
      </section>
    </IslandLayout>
  );
}
