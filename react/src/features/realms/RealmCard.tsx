import { Link } from 'react-router-dom';
import { PortalButton, ProgressIndicator, cn } from '../portal/ui';
import type { Realm } from './realmCatalog';
import { AgeRange, SubjectBadges } from './RealmParts';
import { RealmPicture } from './RealmPicture';
import { themeFor } from './realmThemes';

interface RealmCardProps {
  realm: Realm;
  /** The Explorer's current query string, so the preview's "Back to Realms" keeps the filter. */
  search?: string;
  /** The first row loads its picture eagerly; the rest lazily. */
  eager?: boolean;
}

/**
 * One Realm discovery card (AP-03). Presentational: `buildRealms` decided the state and every
 * link. A card is an `article`, never a clickable div; its actions are real links. A locked
 * Realm has no Explore link at all (CLAUDE.md sections 4 and 13): it shows a lock, the authored
 * unlock hint, and nothing to press. The server still enforces the lock on every route.
 */
export function RealmCard({ realm, search = '', eager = false }: RealmCardProps) {
  const theme = themeFor(realm.slug);
  const titleId = `realm-card-${realm.slug}`;
  const locked = realm.state === 'LOCKED';
  return (
    <article
      aria-labelledby={titleId}
      data-realm={realm.slug}
      data-state={realm.state}
      className={cn(
        'flex h-full w-full min-w-0 flex-col overflow-hidden rounded-3xl border-2 bg-paper text-ink shadow-sm transition duration-200 motion-reduce:transition-none',
        locked ? 'border-dashed border-slate-line' : theme.frame,
        !locked && 'hover:shadow-lg motion-safe:hover:-translate-y-1',
      )}
    >
      <div className="relative">
        <RealmPicture
          assetId={realm.thumbnailAssetId}
          scene={theme.scene}
          label={realm.title}
          eager={eager}
          className={cn('aspect-[16/10] w-full', theme.wash, locked && 'grayscale')}
        />
        <StateRibbon realm={realm} />
        {locked ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center bg-ink/60 text-5xl"
          >
            🔒
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 id={titleId} className="m-0 font-display text-2xl leading-tight text-ocean-900">
          {realm.title}
        </h3>
        {realm.tagline ? <p className="m-0">{realm.tagline}</p> : null}
        <SubjectBadges subjects={realm.subjectAreas} />
        <AgeRange bands={realm.ageBands} />
        {locked ? (
          <p className="m-0 rounded-2xl bg-sand px-4 py-3 text-ink" data-slot="locked-hint">
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
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            {realm.continueHref ? (
              <PortalButton asChild tone="treasure" size="lg">
                <Link to={realm.continueHref} aria-label={`Continue in ${realm.title}`}>
                  <span aria-hidden="true">▶️</span>Continue
                </Link>
              </PortalButton>
            ) : null}
            <PortalButton asChild tone={realm.continueHref ? 'quiet' : 'ocean'} size="lg">
              <Link
                to={realm.detailHref}
                state={{ realmSearch: search }}
                aria-label={`Explore ${realm.title}`}
              >
                <span aria-hidden="true">🧭</span>Explore
              </Link>
            </PortalButton>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function StateRibbon({ realm }: { realm: Realm }) {
  const ribbon =
    realm.state === 'LOCKED'
      ? { icon: '🔒', text: 'Locked' }
      : realm.state === 'UNAVAILABLE'
        ? { icon: '🌱', text: 'Coming soon' }
        : realm.continueHref
          ? { icon: '⭐', text: 'Adventure in progress' }
          : realm.isHome
            ? { icon: '🏠', text: 'Your home realm' }
            : null;
  if (!ribbon) return null;
  return (
    <p className="absolute top-3 left-3 m-0 rounded-full bg-paper px-3 py-1 text-sm font-semibold text-ink shadow-sm">
      <span aria-hidden="true">{ribbon.icon} </span>
      {ribbon.text}
    </p>
  );
}
