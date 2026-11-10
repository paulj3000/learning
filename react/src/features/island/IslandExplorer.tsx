import { Link } from 'react-router-dom';
import { PortalCard, ProgressIndicator, cn } from '../portal/ui';
import type { ExplorerIsland, ExplorerPlace } from '../worlds/islandExplorer';

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

const BAND_AGES: Record<string, [number, number]> = {
  SPROUT: [3, 4],
  PATHFINDER: [5, 6],
  EXPLORER: [7, 8],
};

/** "Ages 3 to 8" from an Island's age bands, or null when it names none this app knows. */
export function ageRangeLabel(bands: readonly string[] | undefined): string | null {
  const ranges = (bands ?? []).map((band) => BAND_AGES[band]).filter(Boolean);
  if (ranges.length === 0) return null;
  const low = Math.min(...ranges.map(([from]) => from));
  const high = Math.max(...ranges.map(([, to]) => to));
  return `Ages ${low} to ${high}`;
}

/**
 * The Island Explorer on the child's homepage (LAI-0808, AP-03), drawn with
 * the Adventure Portal design system (AP-01).
 *
 * Presentational only: `buildIslandExplorer` (or, with the Django API,
 * `buildIslandExplorerFromServer`) decides what is here, open, and locked.
 * Links are real links; a locked island is plain text, never a button that
 * refuses (CLAUDE.md sections 4 and 13). Progress counts places explored,
 * never points or a score (pillar 7).
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
                  'flex-1 gap-2 border-treasure-100 bg-treasure-50 p-5 hover:border-treasure-500',
                )}
                to={island.href}
              >
                <IslandPicture status="OPEN" />
                <span className="font-display text-xl font-bold">{island.title}</span>
                <span>{island.tagline}</span>
                <IslandFacts island={island} />
                <span className="mt-auto inline-flex min-h-12 items-center self-start rounded-2xl bg-treasure-300 px-5 font-semibold text-ink">
                  <span aria-hidden="true">⛵&nbsp;</span>Sail here
                </span>
              </Link>
            ) : null}
            {island.status === 'LOCKED' ? (
              <PortalCard className="flex-1 border-dashed shadow-none">
                <IslandPicture status="LOCKED" />
                <p className="m-0 font-display text-xl font-bold">{island.title}</p>
                <p className={cn(BADGE, 'bg-sand text-ink')}>
                  <span aria-hidden="true">🔒 </span>Not open yet
                </p>
                <p className="m-0 text-ink-muted">{island.lockedHint}</p>
                <IslandFacts island={island} withProgress={false} />
              </PortalCard>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A decorative picture tile. No island carries an illustration yet (ADR-030: every
 * `thumbnailAssetId` is null today), so each status gets a calm drawn tile.
 */
function IslandPicture({ status }: { status: ExplorerIsland['status'] }) {
  const tile = {
    HERE: { icon: '🏝️', className: 'bg-ocean-100' },
    OPEN: { icon: '⛵', className: 'bg-treasure-100' },
    LOCKED: { icon: '🌫️', className: 'bg-sand' },
  }[status];
  return (
    <span
      aria-hidden="true"
      data-slot="island-picture"
      className={cn(
        'flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl',
        tile.className,
      )}
    >
      {tile.icon}
    </span>
  );
}

/** Subjects, ages and places explored, when the server sent them (AP-03). */
function IslandFacts({
  island,
  withProgress = true,
}: {
  island: ExplorerIsland;
  withProgress?: boolean;
}) {
  const ages = ageRangeLabel(island.ageBands);
  const subjects = island.subjects ?? [];
  const progress = withProgress && island.progress && island.progress.total > 0;
  if (!ages && subjects.length === 0 && !progress) return null;
  return (
    <span className="flex flex-col gap-2" data-slot="island-facts">
      {ages ? <span className="text-sm font-semibold text-ink">{ages}</span> : null}
      {subjects.length > 0 ? (
        <span className="flex flex-wrap gap-1" aria-label={`Learn: ${subjects.join(', ')}`}>
          {subjects.map((subject) => (
            <span
              key={subject}
              aria-hidden="true"
              className="rounded-full border-2 border-slate-line bg-paper px-2 py-0.5 text-sm text-ink"
            >
              {subject}
            </span>
          ))}
        </span>
      ) : null}
      {progress && island.progress ? (
        <ProgressIndicator
          label="Explored"
          unit="places explored"
          value={island.progress.explored}
          max={island.progress.total}
          tone="ocean"
        />
      ) : null}
    </span>
  );
}

function HereIsland({ island }: { island: ExplorerIsland }) {
  const placesHeadingId = `island-explorer-places-${island.slug}`;
  return (
    <PortalCard tone="ocean" className="flex-1 border-ocean-300 p-6">
      <div className="flex flex-wrap items-start gap-4">
        <IslandPicture status="HERE" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="m-0 font-display text-2xl font-bold text-ocean-900">{island.title}</p>
          <p className={cn(BADGE, 'bg-ocean-700 text-white')}>
            <span aria-hidden="true">📍 </span>You are here
          </p>
          <p className="m-0">{island.tagline}</p>
        </div>
        <div className="w-full md:w-72">
          <IslandFacts island={island} />
        </div>
      </div>
      <h3 className="mt-2 mb-0 text-lg text-ocean-900" id={placesHeadingId}>
        Places to visit
      </h3>
      {island.places.length > 0 ? (
        <ul
          className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 p-0"
          aria-labelledby={placesHeadingId}
        >
          {island.places.map((place, index) => (
            <li key={place.slug} className="flex min-w-0 flex-col gap-2">
              <PlaceCard place={place} tone={PLACE_TONES[index % PLACE_TONES.length]} />
              {place.area ? (
                <Link
                  className="inline-flex min-h-12 items-center gap-2 self-start rounded-2xl border-2 border-ocean-300 bg-paper px-4 font-semibold text-ocean-900 no-underline hover:bg-ocean-50"
                  to={place.area.href}
                >
                  <span aria-hidden="true">🧭</span>Explore {place.area.title} in 3D
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0">New places are on their way. Come back soon.</p>
      )}
    </PortalCard>
  );
}

function PlaceCard({ place, tone }: { place: ExplorerPlace; tone: string }) {
  return (
    <Link className={cn(LINK_CARD, 'flex-1', tone)} to={place.href}>
      <span className="font-display text-lg font-bold">{place.title}</span>
      <span>{place.tagline}</span>
      {place.explored ? (
        <span className="mt-auto self-start rounded-full bg-paper px-3 py-0.5 text-sm font-semibold text-ink">
          <span aria-hidden="true">✓ </span>Explored
        </span>
      ) : null}
    </Link>
  );
}
