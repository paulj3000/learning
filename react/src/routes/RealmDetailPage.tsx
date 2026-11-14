import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { realmExplorerPath } from '../features/portal/exit';
import { PortalButton, ProgressIndicator, cn } from '../features/portal/ui';
import { PlaceCard } from '../features/realms/PlaceCard';
import { AgeRange, ChildBadge, SubjectBadges } from '../features/realms/RealmParts';
import { ImageResolverProvider, imageResolverFor } from '../features/realms/imageResolver';
import { RealmPicture } from '../features/realms/RealmPicture';
import { buildRealms, type Realm } from '../features/realms/realmCatalog';
import { themeFor } from '../features/realms/realmThemes';
import { RealmLoadError } from '../features/realms/RealmNotices';
import { useRealmCatalog } from '../features/realms/useRealmCatalog';

/**
 * A Realm's preview (AP-03) at `/island/:childId/realms/:realmId`: its picture, words, subjects
 * and progress, its Places with their own looks, and the ways in. A page rather than a panel,
 * so it has its own URL, the browser's back button works and the shell's "Realms" stays
 * current. Everything comes from the same Django catalog read as the Explorer; nothing is
 * invented and nothing here loads Three.js (the 3D routes do, when opened).
 *
 * A locked Realm's page shows its hint and no way in, even when reached by a typed URL. The
 * server stays authoritative: the hub, Place and 3D Area routes check again.
 */
export function RealmDetailPage() {
  const { childId, realmId } = useParams<{ childId: string; realmId: string }>();
  return <RealmDetail childId={childId} realmId={realmId} />;
}

function backHref(childId: string, state: unknown): string {
  const search = (state as { realmSearch?: unknown } | null)?.realmSearch;
  // Only a query string this app wrote (`?subject=...`), never a path.
  return typeof search === 'string' && /^\?[\w=&-]*$/.test(search)
    ? `${realmExplorerPath(childId)}${search}`
    : realmExplorerPath(childId);
}

function RealmDetail({ childId, realmId }: { childId?: string; realmId?: string }) {
  const location = useLocation();
  const { state, retry } = useRealmCatalog(childId);
  const resolveImage = useMemo(() => (childId ? imageResolverFor(childId) : null), [childId]);

  if (!childId || state.status === 'not-found') {
    return <p role="alert">We could not find that child profile.</p>;
  }
  const back = backHref(childId, location.state);
  const realm =
    state.status === 'ready'
      ? buildRealms(childId, state.view).find((candidate) => candidate.slug === realmId)
      : undefined;

  return (
    <IslandLayout
      childId={childId}
      profile={state.status === 'ready' ? <ChildBadge child={state.child} /> : undefined}
    >
      <ImageResolverProvider value={resolveImage}>
        <div className="flex w-full max-w-7xl flex-col gap-6" data-portal="realm-detail">
          <Link
            to={back}
            className="inline-flex min-h-12 items-center gap-2 self-start rounded-2xl border-2 border-ocean-300 bg-paper px-4 font-semibold text-ocean-900 no-underline hover:bg-ocean-50"
          >
            <span aria-hidden="true">⬅️</span>Back to Realms
          </Link>

          {state.status === 'loading' ? (
            <p className="m-0 text-ink" role="status">
              Opening the Realm...
            </p>
          ) : null}

          {state.status === 'error' ? (
            <RealmLoadError
              message="We could not load this Realm right now."
              failure={state.failure}
              onRetry={retry}
            />
          ) : null}

          {state.status === 'ready' && !realm ? (
            <p className="m-0 rounded-2xl bg-paper px-4 py-3 text-ink" role="alert">
              We could not find that Realm. It may not be ready for you yet.
            </p>
          ) : null}

          {realm ? <RealmPreview realm={realm} /> : null}
        </div>
      </ImageResolverProvider>
    </IslandLayout>
  );
}

function RealmPreview({ realm }: { realm: Realm }) {
  const theme = themeFor(realm.slug);
  const locked = realm.state === 'LOCKED';
  const placesHeading = `realm-places-${realm.slug}`;
  return (
    <>
      <section
        aria-labelledby="realm-title"
        className={cn(
          'grid overflow-hidden rounded-3xl border-2 bg-paper shadow-sm md:grid-cols-2',
          locked ? 'border-dashed border-slate-line' : theme.frame,
        )}
      >
        <div className="relative">
          <RealmPicture
            assetId={realm.thumbnailAssetId}
            scene={theme.scene}
            label={realm.title}
            eager
            className={cn(
              'aspect-[16/10] h-full w-full md:aspect-auto md:min-h-80',
              theme.wash,
              locked && 'grayscale',
            )}
          />
          {locked ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-ink/60 text-6xl"
            >
              🔒
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3 p-6 md:p-8">
          <h1 id="realm-title" className="m-0 font-display text-3xl text-ocean-900 md:text-4xl">
            {realm.title}
          </h1>
          <p className="m-0 text-lg">{realm.description || realm.tagline}</p>
          <SubjectBadges subjects={realm.subjectAreas} />
          <AgeRange bands={realm.ageBands} />
          {locked ? (
            <p className="m-0 rounded-2xl bg-sand px-4 py-3 text-ink">
              <span aria-hidden="true">🔒 </span>
              <span className="font-semibold">Not open yet. </span>
              {realm.lockedHint}
            </p>
          ) : null}
          {realm.state === 'UNAVAILABLE' ? (
            <p className="m-0 rounded-2xl bg-sand px-4 py-3 text-ink">
              New places are on their way. Come back soon.
            </p>
          ) : null}
          {realm.state === 'AVAILABLE' && realm.progress.total > 0 ? (
            <ProgressIndicator
              label="Explored"
              unit="places explored"
              value={realm.progress.explored}
              max={realm.progress.total}
              tone={theme.tone}
            />
          ) : null}
          {realm.state === 'AVAILABLE' ? (
            <div className="mt-auto flex flex-wrap gap-3 pt-2">
              {realm.continueHref ? (
                <PortalButton asChild tone="treasure" size="lg">
                  <Link to={realm.continueHref}>
                    <span aria-hidden="true">▶️</span>Continue Adventure
                  </Link>
                </PortalButton>
              ) : null}
              {realm.startHref ? (
                <PortalButton asChild tone={realm.continueHref ? 'quiet' : 'ocean'} size="lg">
                  <Link to={realm.startHref}>
                    <span aria-hidden="true">🧭</span>Start Exploring
                  </Link>
                </PortalButton>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {realm.places.length > 0 ? (
        <section aria-labelledby={placesHeading} className="flex flex-col gap-4">
          <h2 id={placesHeading} className="m-0 font-display text-2xl text-ocean-900">
            Places in {realm.title}
          </h2>
          <ul className="m-0 grid list-none gap-6 p-0 min-[48rem]:grid-cols-2 min-[80rem]:grid-cols-3">
            {realm.places.map((place) => (
              <li key={place.slug} className="flex min-w-0">
                <PlaceCard place={place} realmTitle={realm.title} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
