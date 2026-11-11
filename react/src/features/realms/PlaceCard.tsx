import { Link } from 'react-router-dom';
import { PortalButton, cn } from '../portal/ui';
import type { RealmPlace } from './realmCatalog';
import { SubjectBadges } from './RealmParts';
import { RealmPicture } from './RealmPicture';
import { themeFor } from './realmThemes';

/**
 * A Place in a Realm's preview (AP-03), with its own look: Treasure Cove's ship and treasure,
 * Storykeeper Castle's towers and books, Firepeak's volcano. Its buttons open the routes that
 * already exist: the Place page (its Adventures) and its published 3D Area. Nothing here starts
 * Three.js; the 3D route loads its scene only when opened.
 */
export function PlaceCard({ place, realmTitle }: { place: RealmPlace; realmTitle: string }) {
  const theme = themeFor(place.slug);
  const titleId = `place-card-${place.slug}`;
  return (
    <article
      aria-labelledby={titleId}
      data-place={place.slug}
      className={cn(
        'flex h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl border-2 bg-paper text-ink shadow-sm transition duration-200 hover:shadow-lg motion-safe:hover:-translate-y-1 motion-reduce:transition-none',
        theme.frame,
      )}
    >
      <div className="relative">
        <RealmPicture
          assetId={place.thumbnailAssetId}
          scene={theme.scene}
          label={place.area ? `${place.title}: ${place.area.title}` : place.title}
          className={cn('aspect-[16/10] w-full', theme.wash)}
        />
        {place.area?.inProgress ? (
          <p className="absolute top-3 left-3 m-0 rounded-full bg-paper px-3 py-1 text-sm font-semibold text-ink shadow-sm">
            <span aria-hidden="true">⭐ </span>Adventure in progress
          </p>
        ) : place.explored ? (
          <p className="absolute top-3 left-3 m-0 rounded-full bg-paper px-3 py-1 text-sm font-semibold text-ink shadow-sm">
            <span aria-hidden="true">✓ </span>Explored
          </p>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 id={titleId} className="m-0 font-display text-xl leading-tight text-ocean-900">
          {place.title}
        </h3>
        {place.tagline ? <p className="m-0">{place.tagline}</p> : null}
        <SubjectBadges subjects={place.subjectAreas} />
        {place.adventureCount > 0 ? (
          <p className="m-0 text-sm font-semibold text-ink-muted">
            {place.adventureCount === 1 ? '1 adventure' : `${place.adventureCount} adventures`}
          </p>
        ) : null}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {!place.area && !place.href ? (
            <p className="m-0 rounded-2xl bg-sand px-4 py-2 text-ink">
              <span aria-hidden="true">⛵ </span>Sail to {realmTitle} to visit.
            </p>
          ) : null}
          {place.area ? (
            <PortalButton asChild tone={place.area.inProgress ? 'treasure' : 'ocean'} block>
              <Link to={place.area.href}>
                <span aria-hidden="true">{place.area.inProgress ? '▶️' : '🧭'}</span>
                {place.area.inProgress
                  ? `Continue in ${place.area.title}`
                  : `Explore ${place.area.title} in 3D`}
              </Link>
            </PortalButton>
          ) : null}
          {place.href ? (
            <PortalButton asChild tone={place.area ? 'quiet' : 'ocean'} block>
              <Link to={place.href}>
                <span aria-hidden="true">🗺️</span>Visit {place.title}
              </Link>
            </PortalButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
