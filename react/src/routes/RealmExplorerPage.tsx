import { useMemo } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { DJANGO_API_CONFIG } from '../api/config';
import { IslandLayout } from '../features/island/IslandLayout';
import { isLeftIslandState, LEAVE_ISLAND_COPY } from '../features/portal/exit';
import { PortalButton } from '../features/portal/ui';
import { RealmCard } from '../features/realms/RealmCard';
import { RealmFilters } from '../features/realms/RealmFilters';
import { RealmHero } from '../features/realms/RealmHero';
import { ChildBadge } from '../features/realms/RealmParts';
import { ImageResolverProvider, imageResolverFor } from '../features/realms/imageResolver';
import { buildRealms } from '../features/realms/realmCatalog';
import {
  NO_FILTER,
  ageOptions,
  filterRealms,
  readFilter,
  subjectOptions,
  writeFilter,
  type RealmFilter,
} from '../features/realms/realmFilters';
import { RealmLoadError, RealmsUnavailable } from '../features/realms/RealmNotices';
import { useRealmCatalog } from '../features/realms/useRealmCatalog';

/**
 * The Realm Explorer (AP-03) at `/island/:childId/realms`: every Realm this child can see, from
 * Django's published catalog, as illustrated discovery cards with subject and age filters.
 * It is also where "Leave island" returns (AP-04).
 *
 * A build without the Django API (`VITE_BACKEND=amplify`) has no published catalog. It used to
 * send the child to Home without a word, which looked like the Realms button was broken; it
 * now says so and offers Home (P0 fix). Local development uses Django by default.
 */
export function RealmExplorerPage() {
  const { childId } = useParams<{ childId: string }>();
  if (!DJANGO_API_CONFIG.enabled && childId) {
    return (
      <IslandLayout childId={childId}>
        <div className="flex w-full max-w-7xl flex-col gap-6" data-portal="realm-explorer">
          <RealmsUnavailable childId={childId} />
        </div>
      </IslandLayout>
    );
  }
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
  const shown = filterRealms(realms, filter);
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
                subjects={subjectOptions(realms)}
                ages={ageOptions(realms)}
                filter={filter}
                onChange={setFilter}
                shown={shown.length}
                total={realms.length}
              />
              <section aria-labelledby="realm-grid-heading" className="flex flex-col gap-4">
                <h2 id="realm-grid-heading" className="m-0 font-display text-2xl text-ocean-900">
                  Realms to discover
                </h2>
                {shown.length > 0 ? (
                  <ul className="m-0 grid list-none gap-6 p-0 min-[48rem]:grid-cols-2 min-[80rem]:grid-cols-3">
                    {shown.map((realm, index) => (
                      <li key={realm.slug} className="flex min-w-0">
                        <RealmCard realm={realm} search={search} eager={index < 3} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-start gap-3 rounded-2xl bg-paper px-4 py-4 text-ink">
                    <p className="m-0">No Realms match that choice yet.</p>
                    <PortalButton tone="ocean" onClick={() => setFilter(NO_FILTER)}>
                      Show all Realms
                    </PortalButton>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </ImageResolverProvider>
    </IslandLayout>
  );
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
        className="m-0 grid list-none gap-6 p-0 min-[48rem]:grid-cols-2 min-[80rem]:grid-cols-3"
      >
        {[0, 1, 2].map((slot) => (
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
