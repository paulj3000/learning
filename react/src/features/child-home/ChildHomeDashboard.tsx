import { Link } from 'react-router-dom';
import type { ChildHome } from '../../api/play/homeApi';
import { locationWorldPath } from '../island-map/three/runtime/locationWorldPath';
import { PortalButton, PortalCard, ProgressIndicator } from '../portal/ui';
import { FEATURED_COPY, pickFeatured } from './featured';

export type ChildHomeState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; home: ChildHome };

interface ChildHomeDashboardProps {
  childId: string;
  state: ChildHomeState;
}

const RECENT_ITEMS_SHOWN = 3;

/**
 * The child home dashboard (AP-02): a featured "Continue your adventure", then short summaries
 * of quests, treasures and how the island has changed, all from the Django home API.
 *
 * Every number is a count the server keeps (adventures finished, quests, items, world changes);
 * there is no XP, level, score or streak, because no real source for one exists yet (Trello
 * AP-02: "avoid invented metrics"; CLAUDE.md pillar 7). Daily missions arrive with AP-06.
 *
 * It loads on its own: while loading, or if the summary fails, the rest of the homepage (the
 * Island Explorer and the links) still works.
 */
export function ChildHomeDashboard({ childId, state }: ChildHomeDashboardProps) {
  if (state.status === 'loading') {
    return (
      <p className="m-0 w-full max-w-5xl text-ink" role="status">
        Getting your adventures ready...
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="m-0 w-full max-w-5xl rounded-2xl bg-coral-50 px-4 py-3 text-ink" role="alert">
        We could not load your adventure summary right now. You can still explore the Realms below.
      </p>
    );
  }

  const { home } = state;
  const featured = pickFeatured(home);
  const { progress } = home;
  const recent = home.recentItems.slice(0, RECENT_ITEMS_SHOWN);

  return (
    <section
      aria-labelledby="child-home-dashboard-heading"
      className="flex w-full max-w-5xl flex-col gap-4"
      data-portal="child-home-dashboard"
    >
      <h2 id="child-home-dashboard-heading" className="sr-only">
        Your adventures
      </h2>

      {featured ? (
        <PortalCard as="article" tone="treasure" className="gap-3 p-6 md:flex-row md:items-center">
          <span aria-hidden="true" className="text-5xl">
            {featured.kind === 'START' ? '🗺️' : '🧭'}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h3 className="m-0 font-display text-2xl text-ink">
              {FEATURED_COPY[featured.kind].heading}
            </h3>
            <p className="m-0 text-lg font-semibold">
              {featured.region.title}
              <span className="font-normal"> at {featured.region.placeTitle}</span>
            </p>
            {featured.region.description ? (
              <p className="m-0">{featured.region.description}</p>
            ) : null}
            {featured.region.chestsTotal > 0 ? (
              <ProgressIndicator
                label="Treasure chests"
                unit="chests opened"
                value={featured.region.chestsOpened}
                max={featured.region.chestsTotal}
                tone="treasure"
                className="max-w-sm"
              />
            ) : null}
          </div>
          <PortalButton asChild tone="ocean" size="lg">
            <Link to={locationWorldPath(childId, featured.region.regionId)}>
              {FEATURED_COPY[featured.kind].action}
            </Link>
          </PortalButton>
        </PortalCard>
      ) : (
        <PortalCard as="article" tone="treasure" className="p-6">
          <h3 className="m-0 font-display text-2xl text-ink">Ready for an adventure?</h3>
          <p className="m-0">Choose a place below to begin.</p>
        </PortalCard>
      )}

      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        <li className="flex">
          <PortalCard as="article" tone="coral" className="flex-1">
            <h3 className="m-0 font-display text-xl text-ink">
              <span aria-hidden="true">🗺️ </span>Your quests
            </h3>
            <p className="m-0">
              {progress.questsActive === 0 && progress.questsCompleted === 0
                ? 'No quests yet. Characters on the island will ask for your help.'
                : `${countLabel(progress.questsActive, 'quest')} going, ${countLabel(
                    progress.questsCompleted,
                    'quest',
                  )} finished.`}
            </p>
            <Link className="mt-auto font-semibold text-ocean-900" to={`/island/${childId}/quests`}>
              Open your quest journal
            </Link>
          </PortalCard>
        </li>
        <li className="flex">
          <PortalCard as="article" tone="purple" className="flex-1">
            <h3 className="m-0 font-display text-xl text-ink">
              <span aria-hidden="true">💎 </span>Your treasures
            </h3>
            {progress.items === 0 ? (
              <p className="m-0">No treasures yet. Open a chest to find one.</p>
            ) : (
              <>
                <p className="m-0">You have found {countLabel(progress.items, 'treasure')}.</p>
                {recent.length > 0 ? (
                  <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Newest finds">
                    {recent.map((item) => (
                      <li
                        key={item.itemId}
                        className="rounded-full border-2 border-purple-100 bg-paper px-2 py-0.5 text-sm text-ink"
                      >
                        {item.displayName}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </PortalCard>
        </li>
        <li className="flex">
          <PortalCard as="article" tone="tropical" className="flex-1">
            <h3 className="m-0 font-display text-xl text-ink">
              <span aria-hidden="true">🌱 </span>Your island so far
            </h3>
            <p className="m-0">
              {progress.completedSessions === 0 && progress.worldChanges === 0
                ? 'Your first adventure will start changing the island.'
                : `You finished ${countLabel(
                    progress.completedSessions,
                    'adventure',
                  )} and changed the island ${countLabel(progress.worldChanges, 'time')}.`}
            </p>
            <Link className="mt-auto font-semibold text-ocean-900" to={`/island/${childId}/log`}>
              See your adventure log
            </Link>
          </PortalCard>
        </li>
      </ul>
    </section>
  );
}

/** "1 quest", "3 quests". Child-facing, readable aloud. */
export function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
