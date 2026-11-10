import { Link } from 'react-router-dom';
import { PortalCard, cn } from '../portal/ui';
import type { ExplorerIsland } from '../worlds/islandExplorer';

interface IslandExplorerProps {
  islands: readonly ExplorerIsland[];
}

/**
 * Card washes for the places on the island the child is on, in turn, so
 * neighbouring places are easy to tell apart. Literal class strings: the
 * portal's Tailwind build only sees classes written out in full (portal.css).
 * Every pair is `text-ink` on a 50 shade, checked in `portalCss.test.ts`.
 */
const PLACE_TONES = [
  'border-tropical-100 bg-tropical-50 hover:border-tropical-500',
  'border-coral-100 bg-coral-50 hover:border-coral-500',
  'border-purple-100 bg-purple-50 hover:border-purple-500',
  'border-treasure-100 bg-treasure-50 hover:border-treasure-500',
] as const;

const LINK_CARD =
  'flex h-full min-h-14 min-w-0 flex-col gap-1 rounded-3xl border-2 p-4 text-left text-ink no-underline shadow-sm [overflow-wrap:anywhere]';

const BADGE = 'm-0 self-start rounded-full px-3 py-1 text-sm font-semibold';

/**
 * The Island Explorer on the child's homepage (LAI-0808), drawn with the
 * Adventure Portal design system (AP-01).
 *
 * Presentational only: `buildIslandExplorer` decides what is here, open, and
 * locked. Links are real links; a locked island is plain text, never a
 * button that refuses (CLAUDE.md sections 4 and 13).
 */
export function IslandExplorer({ islands }: IslandExplorerProps) {
  return (
    <section
      className="flex w-full max-w-5xl flex-col gap-4"
      aria-labelledby="island-explorer-heading"
      data-portal="island-explorer"
    >
      <h2 className="m-0 font-display text-2xl text-ocean-900" id="island-explorer-heading">
        Where to next?
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-4 p-0">
        {islands.map((island) => (
          <li
            className={cn('flex min-w-0', island.status === 'HERE' && 'col-span-full')}
            key={island.slug}
          >
            {island.status === 'HERE' ? <HereIsland island={island} /> : null}
            {island.status === 'OPEN' && island.href ? (
              <Link
                className={cn(
                  LINK_CARD,
                  'flex-1 border-treasure-100 bg-treasure-50 p-5 hover:border-treasure-500',
                )}
                to={island.href}
              >
                <span className="font-display text-xl font-bold">{island.title}</span>
                <span>{island.tagline}</span>
                <span className="mt-auto inline-flex min-h-12 items-center self-start rounded-2xl bg-treasure-300 px-5 font-semibold text-ink">
                  <span aria-hidden="true">⛵&nbsp;</span>Sail here
                </span>
              </Link>
            ) : null}
            {island.status === 'LOCKED' ? (
              <PortalCard className="flex-1 border-dashed shadow-none">
                <p className="m-0 font-display text-xl font-bold">{island.title}</p>
                <p className={cn(BADGE, 'bg-sand text-ink')}>
                  <span aria-hidden="true">🔒 </span>Not open yet
                </p>
                <p className="m-0 text-ink-muted">{island.lockedHint}</p>
              </PortalCard>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HereIsland({ island }: { island: ExplorerIsland }) {
  const placesHeadingId = `island-explorer-places-${island.slug}`;
  return (
    <PortalCard tone="ocean" className="flex-1 border-ocean-300 p-6">
      <p className="m-0 font-display text-2xl font-bold text-ocean-900">{island.title}</p>
      <p className={cn(BADGE, 'bg-ocean-700 text-white')}>
        <span aria-hidden="true">📍 </span>You are here
      </p>
      <p className="m-0">{island.tagline}</p>
      <h3 className="mt-2 mb-0 text-lg text-ocean-900" id={placesHeadingId}>
        Places to visit
      </h3>
      {island.places.length > 0 ? (
        <ul
          className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 p-0"
          aria-labelledby={placesHeadingId}
        >
          {island.places.map((place, index) => (
            <li key={place.slug} className="min-w-0">
              <Link
                className={cn(LINK_CARD, PLACE_TONES[index % PLACE_TONES.length])}
                to={place.href}
              >
                <span className="font-display text-lg font-bold">{place.title}</span>
                <span>{place.tagline}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0">New places are on their way. Come back soon.</p>
      )}
    </PortalCard>
  );
}
