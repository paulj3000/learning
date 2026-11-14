import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { getTodaysEvent } from '../features/island/events';
import { getSeasonalIslandNote } from '../features/island/seasons';
import { ChildAvatar } from '../features/child-profile/ChildAvatar';
import { getChildProfile } from '../features/child-profile/api';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';
import { getChildHomeFor } from '../api/play/homeApi';
import { ChildHomeDashboard, type ChildHomeState } from '../features/child-home/ChildHomeDashboard';
import { WELCOME_HARBOR_REGION_ID } from '../features/discovery/checkpoints';
import { isLeftIslandState, LEAVE_ISLAND_COPY, realmExplorerPath } from '../features/portal/exit';
import { PortalButton } from '../features/portal/ui';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

/**
 * The child's homepage. The dashboard comes from Django's home summary (AP-02), and the Realms
 * live on their own page, the Realm Explorer (AP-03), which Home links to. Django is the only
 * backend (AMP-03). Chatty is the only companion, so no companion step is shown here.
 */
export function WelcomeHarbor() {
  const { childId } = useParams<{ childId: string }>();
  /** AP-04: arrived from "Leave island", so say calmly that nothing was lost. */
  const leftIsland = isLeftIslandState(useLocation().state);
  const [home, setHome] = useState<ChildHomeState>({ status: 'loading' });
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * The child profile decides the page; the home summary fails on its own, so a slow or broken
     * read never blanks the whole homepage.
     */
    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      setHome({ status: 'loading' });
      const summary = getChildHomeFor(childId).then(
        (value): ChildHomeState => ({ status: 'ready', home: value }),
        (): ChildHomeState => ({ status: 'error' }),
      );
      try {
        const child = await getChildProfile(childId);
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
      const loaded = await summary;
      if (!cancelled) setHome(loaded);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

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

      {/* AP-02 dashboard, then the way to the Realms (the Realm Explorer, AP-03). */}
      <ChildHomeDashboard childId={childId} state={home} />
      <section
        aria-labelledby="realms-teaser-heading"
        data-portal="realms-teaser"
        className="flex w-full max-w-5xl flex-col gap-3 rounded-3xl border-2 border-treasure-100 bg-treasure-50 p-6 text-ink shadow-sm md:flex-row md:items-center md:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="realms-teaser-heading" className="m-0 font-display text-2xl text-ocean-900">
            <span aria-hidden="true">🧭 </span>Realm Explorer
          </h2>
          <p className="m-0">Choose a Realm to learn, play, and go on an adventure!</p>
        </div>
        <PortalButton asChild tone="ocean" size="lg">
          <Link to={realmExplorerPath(childId)}>Explore the Realms</Link>
        </PortalButton>
      </section>

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
