import { useMemo } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { isLeftIslandState, LEAVE_ISLAND_COPY } from '../features/portal/exit';
import { PortalButton } from '../features/portal/ui';
import { RealmCard } from '../features/realms/RealmCard';
import { PlaceCard } from '../features/realms/PlaceCard';
import { RealmFilters } from '../features/realms/RealmFilters';
import { RealmHero } from '../features/realms/RealmHero';
import { ChildBadge } from '../features/realms/RealmParts';
import { ImageResolverProvider, imageResolverFor } from '../features/realms/imageResolver';
import { buildRealms, type Realm, type RealmPlace } from '../features/realms/realmCatalog';
import {
  NO_FILTER,
  ageOptions,
  filterRealms,
  readFilter,
  subjectOptions,
  writeFilter,
  type RealmFilter,
} from '../features/realms/realmFilters';
import { RealmLoadError } from '../features/realms/RealmNotices';
import { useRealmCatalog } from '../features/realms/useRealmCatalog';

/**
 * The Realm Explorer (AP-03) at `/island/:childId/realms`: every Realm this child can see, from
 * Django's published catalog, as illustrated discovery cards with subject and age filters.
 * It is also where "Leave island" returns (AP-04).
 */
export function RealmExplorerPage() {
  const { childId } = useParams<{ childId: string }>();
  return <RealmExplorer childId={childId} />;
}

function RealmExplorer({ childId }: { childId: string | undefined }) {
  const leftIsland = isLeftIslandState(useLocation().state);
  const [params, setParams] = useSearchParams();
  const { state, retry } = useRealmCatalog(childId);
  const resolveImage = useMemo(() => (childId ? imageResolverFor(childId) : null), [childId]);
  const filter = readFilter(params);

  if (!childId || state.status === 'not-found') {
    return <p role="alert">We could not find that child profile.</p>;
  }

  const realms = state.status === 'ready' ? buildRealms(childId, state.view) : [];
  const destinations = explorerDestinations(realms);
  const shown = filterRealms(destinations, filter);
  const home = realms.find((realm) => realm.isHome && realm.state === 'AVAILABLE');
  const search = params.toString() ? `?${params.toString()}` : '';
  const setFilter = (next: RealmFilter) => setParams(writeFilter(next), { replace: true });

  return (
    <IslandLayout
      childId={childId}
      profile={state.status === 'ready' ? <ChildBadge child={state.child} /> : undefined}
    >
      <ImageResolverProvider value={resolveImage}>
        <div className="flex w-full max-w-7xl flex-col gap-6" data-portal="realm-explorer">
          <RealmHero>
            {leftIsland ? (
              <p
                className="m-0 rounded-2xl bg-tropical-50 px-4 py-3 font-semibold text-ink"
                role="status"
              >
                {LEAVE_ISLAND_COPY.welcomeBack}
              </p>
            ) : null}
          </RealmHero>

          {state.status === 'loading' ? <LoadingGrid /> : null}

          {state.status === 'error' ? (
            <RealmLoadError
              message="We could not load the Realms right now."
              failure={state.failure}
              onRetry={retry}
            />
          ) : null}

          {state.status === 'ready' && realms.length === 0 ? (
            <p className="m-0 rounded-2xl bg-paper px-4 py-3 text-ink">
              New Realms are on their way. Come back soon.
            </p>
          ) : null}

          {state.status === 'ready' && realms.length > 0 ? (
            <>
              <RealmFilters
                subjects={subjectOptions(destinations)}
                ages={ageOptions(destinations)}
                filter={filter}
                onChange={setFilter}
                shown={shown.length}
                total={destinations.length}
                countLabel="destination"
              />
              <section aria-labelledby="realm-grid-heading" className="flex flex-col gap-4">
                <h2 id="realm-grid-heading" className="m-0 font-display text-2xl text-ocean-900">
                  Choose your destination
                </h2>
                {shown.length > 0 ? (
                  <ul className="m-0 grid list-none gap-6 p-0 min-[48rem]:grid-cols-2">
                    {shown.map((destination, index) => (
                      <li key={destination.key} className="flex min-w-0">
                        {destination.kind === 'place' ? (
                          <PlaceCard
                            place={destination.place}
                            realmTitle={destination.realm.title}
                            displayTitle={destination.displayTitle}
                            displayTagline={destination.displayTagline}
                            eager={index < 2}
                          />
                        ) : (
                          <RealmCard
                            realm={destination.realm}
                            search={search}
                            eager={index < 2}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-2xl bg-paper px-4 py-4 text-ink">
                    <p className="m-0">No destinations match that choice yet.</p>
                    <PortalButton tone="ocean" onClick={() => setFilter(NO_FILTER)}>
                      Show all Realms
                    </PortalButton>
                  </div>
                )}
              </section>
              {home ? (
                <PortalButton asChild tone="quiet" size="lg">
                  <Link to={home.detailHref} state={{ realmSearch: search }}>
                    See all places on{' '}
                    {home.slug === 'learning-adventure-island' ? 'Adventure Island' : home.title}
                  </Link>
                </PortalButton>
              ) : null}
            </>
          ) : null}
        </div>
      </ImageResolverProvider>
    </IslandLayout>
  );
}

/**
 * Home is a catalog container, not a single gameplay destination. Surface its already-linkable
 * Places individually, without inventing Realms, changing identifiers, or bypassing access rules.
 * Other Realms retain their preview, lock hints, seasonal badges and hub navigation.
 */
type Destination = Pick<Realm, 'subjectAreas' | 'ageBands'> &
  (
    | { key: string; kind: 'realm'; realm: Realm }
    | {
        key: string;
        kind: 'place';
        realm: Realm;
        place: RealmPlace;
        displayTitle?: string;
        displayTagline?: string;
      }
  );

function placeCopy(place: RealmPlace): { displayTitle?: string; displayTagline?: string } {
  switch (place.slug) {
    case 'pirate-builder-bay':
      return place.area?.href.endsWith('/treasure-rush-cove')
        ? {
            displayTitle: 'Treasure Rush',
            displayTagline: 'Discover hidden pirate treasures.',
          }
        : {};
    case 'storykeeper-castle':
      return {
        displayTitle: "Storykeeper's Castle",
        displayTagline: 'Explore stories and solve mysteries.',
      };
    case 'firepeak-volcano':
    case 'firepeak-heart':
      return {
        displayTitle: 'Heart of Firepeak',
        displayTagline: 'Discover the secrets of the volcano.',
      };
    default:
      return {};
  }
}

function explorerDestinations(realms: readonly Realm[]): Destination[] {
  return realms.flatMap<Destination>((realm) => {
    if (realm.isHome && realm.state === 'AVAILABLE') {
      return realm.places.map((place) => ({
        key: `place:${realm.slug}:${place.slug}`,
        kind: 'place',
        realm,
        place,
        subjectAreas: place.subjectAreas,
        ageBands: realm.ageBands,
        ...placeCopy(place),
      }));
    }
    return [
      {
        key: `realm:${realm.slug}`,
        kind: 'realm',
        realm:
          realm.isHome && realm.slug === 'learning-adventure-island'
            ? { ...realm, title: 'Adventure Island' }
            : realm,
        subjectAreas: realm.subjectAreas,
        ageBands: realm.ageBands,
      },
    ];
  });
}

/** Calm placeholders the size of real cards, so nothing jumps when the catalog arrives. */
function LoadingGrid() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="m-0 text-ink" role="status">
        Finding your Realms...
      </p>
      <ul
        aria-hidden="true"
        className="m-0 grid list-none gap-6 p-0 min-[48rem]:grid-cols-2"
      >
        {[0, 1, 2, 3].map((slot) => (
          <li key={slot} className="flex flex-col overflow-hidden rounded-3xl bg-paper shadow-sm">
            <span className="aspect-[16/10] w-full bg-ocean-100" />
            <span className="m-5 h-6 w-2/3 rounded-full bg-ocean-50" />
            <span className="mx-5 mb-5 h-4 w-1/2 rounded-full bg-ocean-50" />
          </li>
        ))}
      </ul>
    </div>
  );
}
