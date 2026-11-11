/**
 * The Realm Explorer's view of Django's published catalog (AP-03).
 *
 * "Realm" is the new child-facing word for an Island (catalog `World`, ADR-041). API routes,
 * field names and models keep the Island names until the approved naming migration.
 *
 * Built only from `GET /children/<id>/islands/`: the server has already applied every rule
 * (active Islands and Places, this child's age band, secret Places hidden, whether a Realm is
 * open, subject areas, published pictures). This turns that answer into what a card shows and
 * where each button goes. There is no second catalog here. Pure: no React, no network.
 */
import type {
  IslandSummary,
  IslandsView,
  PlaceSummary,
  SubjectArea,
} from '../../api/play/islandsApi';
import { ISLAND_LOCATIONS } from '../island/locations';
import { locationWorldPath } from '../island-map/three/runtime/locationWorldPath';
import { portalPath } from '../portal/exit/adventureRoutes';

/**
 * - `AVAILABLE`: open to this child, with at least one Place to visit.
 * - `LOCKED`: the Realm's travel requirement is not met yet. Shown, never entered.
 * - `UNAVAILABLE`: open, but nothing in it is published for this child yet.
 */
export type RealmState = 'AVAILABLE' | 'LOCKED' | 'UNAVAILABLE';

export interface RealmPlace {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  skills: string[];
  subjectAreas: SubjectArea[];
  thumbnailAssetId: string | null;
  adventureCount: number;
  explored: boolean;
  /** The Place's own page (its Adventures), when this app has one. */
  href: string | null;
  /** Its published 3D Area, such as Treasure Cove, when there is one for this child. */
  area: { title: string; href: string; inProgress: boolean } | null;
}

export interface Realm {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  isHome: boolean;
  state: RealmState;
  /** The authored hint, for a LOCKED Realm only. */
  lockedHint: string | null;
  ageBands: string[];
  subjectAreas: SubjectArea[];
  thumbnailAssetId: string | null;
  /** Places explored, never points or a score (pillar 7). */
  progress: { explored: number; total: number };
  places: RealmPlace[];
  /** The Realm's preview page. */
  detailHref: string;
  /** Where "Start exploring" goes, for an AVAILABLE Realm. */
  startHref: string | null;
  /** Where "Continue" goes: a 3D Area with an open session (Django's `resume`), if any. */
  continueHref: string | null;
}

/** Shown when a locked Realm authored no hint. Readable aloud; names no skill or score. */
export const DEFAULT_LOCKED_HINT = 'This realm opens later in your adventure.';

const SOURCE_PAGES = new Set(ISLAND_LOCATIONS.map((location) => location.slug));

export function realmDetailPath(childId: string, realmSlug: string): string {
  return portalPath(childId, { kind: 'realm', realmSlug });
}

/**
 * A Place's card. On the home Realm it links to the Place page and its 3D Area. In any other
 * Realm it has no links of its own: that Realm is entered through its hub, which records the
 * arrival (Phase 29), so its Places are shown for discovery and reached from there.
 */
function toPlace(childId: string, place: PlaceSummary, linkable: boolean): RealmPlace | null {
  const area =
    linkable && place.area?.available === true
      ? {
          title: place.area.title,
          href: locationWorldPath(childId, place.area.regionId),
          inProgress: place.area.resumeSessionId !== null,
        }
      : null;
  const href =
    linkable && SOURCE_PAGES.has(place.placeId)
      ? portalPath(childId, { kind: 'place', locationSlug: place.placeId })
      : null;
  // A home Place with neither a page nor a 3D Area has nothing to open yet (as before AP-03).
  if (linkable && !href && !area) return null;
  return {
    slug: place.placeId,
    title: place.title,
    tagline: place.tagline,
    description: place.description,
    skills: place.skills,
    subjectAreas: place.subjectAreas,
    thumbnailAssetId: place.thumbnailAssetId,
    adventureCount: place.adventureCount,
    explored: place.explored,
    href,
    area,
  };
}

function toRealm(childId: string, island: IslandSummary): Realm {
  const places = island.places
    .map((place) => toPlace(childId, place, island.isHome))
    .filter((place): place is RealmPlace => place !== null);
  const state: RealmState = !island.unlocked
    ? 'LOCKED'
    : places.length === 0
      ? 'UNAVAILABLE'
      : 'AVAILABLE';
  const resume = places.find((place) => place.area?.inProgress);
  const firstNew = places.find((place) => !place.explored) ?? places[0];
  // Another Realm is entered through its hub, which records the arrival (Phase 29); the home
  // Realm has no hub of its own, so "Start exploring" opens its first Place not yet explored.
  const startHref =
    state !== 'AVAILABLE'
      ? null
      : island.isHome
        ? (firstNew?.href ?? firstNew?.area?.href ?? null)
        : portalPath(childId, { kind: 'island', worldSlug: island.islandId });
  return {
    slug: island.islandId,
    title: island.title,
    tagline: island.tagline,
    description: island.description,
    isHome: island.isHome,
    state,
    lockedHint: state === 'LOCKED' ? (island.lockedHint ?? DEFAULT_LOCKED_HINT) : null,
    ageBands: island.ageBands,
    subjectAreas: island.subjectAreas,
    thumbnailAssetId: island.thumbnailAssetId,
    progress: {
      explored: island.progress?.placesExplored ?? places.filter((p) => p.explored).length,
      total: island.progress?.placesTotal ?? places.length,
    },
    // A locked Realm never shows its Places, even if a client is handed them.
    places: state === 'LOCKED' ? [] : places,
    detailHref: realmDetailPath(childId, island.islandId),
    startHref,
    continueHref: state === 'AVAILABLE' ? (resume?.area?.href ?? null) : null,
  };
}

const STATE_ORDER: Record<RealmState, number> = { AVAILABLE: 0, UNAVAILABLE: 1, LOCKED: 2 };

/**
 * Every Realm for this child: the home Realm first, then open Realms, then the rest. Realms of
 * the same kind keep the authored order (`World.sort_order`).
 */
export function buildRealms(childId: string, view: IslandsView): Realm[] {
  return view.islands
    .map((island, index) => ({ realm: toRealm(childId, island), index }))
    .sort(
      (a, b) =>
        Number(b.realm.isHome) - Number(a.realm.isHome) ||
        STATE_ORDER[a.realm.state] - STATE_ORDER[b.realm.state] ||
        a.index - b.index,
    )
    .map(({ realm }) => realm);
}
