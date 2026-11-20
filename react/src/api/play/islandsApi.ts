import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read, type Reader } from '../parse';

/**
 * `GET /api/v1/children/<id>/islands/` (ADR-041): Island > Place > 3D Area for one child.
 * A Place's `area` is null until it has a published 3D Area; its Adventures are still playable
 * from the Place page then.
 */
export type AreaStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'VISITED';

export interface PlaceArea {
  regionId: string;
  title: string;
  available: boolean;
  /** AP-03: NOT_STARTED, IN_PROGRESS (an open session) or VISITED. */
  status: AreaStatus;
  /** AP-03: the open session this child can continue here, if any. */
  resumeSessionId: string | null;
}

/** AP-03 Realm Explorer filter values, in display order (Django `discovery.SUBJECT_AREAS`). */
export const SUBJECT_AREAS = ['MATH', 'READING', 'SCIENCE', 'CREATIVITY'] as const;
export type SubjectArea = (typeof SUBJECT_AREAS)[number];

/** NP-023: the active seasonal event a Realm or Place belongs to (Django `seasons`). */
export interface SeasonalInfo {
  slug: string;
  theme: string;
  /** Featured and inside the event's window right now. */
  featured: boolean;
  inWindow: boolean;
}

export interface PlaceSummary {
  placeId: string;
  title: string;
  tagline: string;
  /** AP-03: longer authored copy; '' when an older server leaves it out. */
  description: string;
  /** AP-03: the authored skills, such as "Counting". */
  skills: string[];
  subjectAreas: SubjectArea[];
  /** AP-03: a published image in the Django asset library, or null. */
  thumbnailAssetId: string | null;
  adventureCount: number;
  /** AP-03: the child has started an adventure here or entered its 3D Area. */
  explored: boolean;
  /** NP-023: null for content with no seasonal event (and from an older server). */
  seasonal?: SeasonalInfo | null;
  /** Quest-based Places: quests its published 3D Area offers this child; 0 when absent. */
  questCount: number;
  questsCompleted: number;
  questsInProgress: number;
  /** All offered quests completed by this child (false when there are none). */
  completed: boolean;
  area: PlaceArea | null;
}

/** AP-03: how far along this child is on an Island, in Places explored (never a score). */
export interface IslandProgress {
  placesExplored: number;
  placesTotal: number;
}

export interface IslandSummary {
  islandId: string;
  title: string;
  tagline: string;
  isHome: boolean;
  /** AP-03 discovery details. Defaults apply when an older server leaves them out. */
  description: string;
  ageBands: string[];
  subjects: string[];
  subjectAreas: SubjectArea[];
  thumbnailAssetId: string | null;
  unlocked: boolean;
  lockedHint: string | null;
  progress: IslandProgress | null;
  /** NP-023: null for content with no seasonal event (and from an older server). */
  seasonal?: SeasonalInfo | null;
  places: PlaceSummary[];
}

export interface IslandsView {
  islands: IslandSummary[];
  /** Set when exactly one Island is available, so the Island choice can be skipped. */
  autoSelectIslandId: string | null;
}

const AREA_STATUSES: readonly AreaStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'VISITED'];

function area(r: Reader): PlaceArea {
  const status = added(r, 'status', (f) => f.string(), 'NOT_STARTED');
  return {
    regionId: r.field('regionId').string(),
    title: r.field('title').string(),
    available: r.field('available').boolean(),
    status: (AREA_STATUSES as readonly string[]).includes(status)
      ? (status as AreaStatus)
      : 'NOT_STARTED',
    resumeSessionId: added(
      r,
      'resume',
      (f) => f.nullable((resume) => resume.field('sessionId').string()),
      null,
    ),
  };
}

/** Known subject areas only, in display order; anything else a newer server sends is ignored. */
function subjectAreas(r: Reader): SubjectArea[] {
  const sent = new Set(r.array((value) => value.string()));
  return SUBJECT_AREAS.filter((area) => sent.has(area));
}

/** Reads a field the AP-03 server added, or `fallback` when an older server left it out. */
function added<T>(r: Reader, name: string, read: (field: Reader) => T, fallback: T): T {
  return name in r.object() ? read(r.field(name)) : fallback;
}

function seasonal(r: Reader): SeasonalInfo | null {
  return added(
    r,
    'seasonal',
    (f) =>
      f.nullable((value) => ({
        slug: value.field('slug').string(),
        theme: value.field('theme').string(),
        featured: value.field('featured').boolean(),
        inWindow: value.field('inWindow').boolean(),
      })),
    null,
  );
}

export function islandsView(r: Reader): IslandsView {
  return {
    islands: r.field('islands').array((island) => ({
      islandId: island.field('islandId').string(),
      title: island.field('title').string(),
      tagline: island.field('tagline').string(),
      isHome: island.field('isHome').boolean(),
      description: added(island, 'description', (f) => f.string(), ''),
      subjectAreas: added(island, 'subjectAreas', subjectAreas, []),
      ageBands: added(island, 'ageBands', (f) => f.array((band) => band.string()), []),
      subjects: added(island, 'subjects', (f) => f.array((subject) => subject.string()), []),
      thumbnailAssetId: added(
        island,
        'thumbnailAssetId',
        (f) => f.nullable((v) => v.string()),
        null,
      ),
      unlocked: added(island, 'unlocked', (f) => f.boolean(), true),
      lockedHint: added(island, 'lockedHint', (f) => f.nullable((v) => v.string()), null),
      progress: added(
        island,
        'progress',
        (f) => ({
          placesExplored: f.field('placesExplored').integer(),
          placesTotal: f.field('placesTotal').integer(),
        }),
        null,
      ),
      seasonal: seasonal(island),
      places: island.field('places').array((place) => ({
        placeId: place.field('placeId').string(),
        title: place.field('title').string(),
        tagline: place.field('tagline').string(),
        description: added(place, 'description', (f) => f.string(), ''),
        skills: added(place, 'skills', (f) => f.array((skill) => skill.string()), []),
        subjectAreas: added(place, 'subjectAreas', subjectAreas, []),
        thumbnailAssetId: added(
          place,
          'thumbnailAssetId',
          (f) => f.nullable((v) => v.string()),
          null,
        ),
        adventureCount: place.field('adventureCount').integer(),
        explored: added(place, 'explored', (f) => f.boolean(), false),
        seasonal: seasonal(place),
        questCount: added(place, 'questCount', (f) => f.integer(), 0),
        questsCompleted: added(place, 'questsCompleted', (f) => f.integer(), 0),
        questsInProgress: added(place, 'questsInProgress', (f) => f.integer(), 0),
        completed: added(place, 'completed', (f) => f.boolean(), false),
        area: place.field('area').nullable(area),
      })),
    })),
    autoSelectIslandId: r.field('autoSelectIslandId').nullable((v) => v.string()),
  };
}

export async function getIslands(client: ApiClient, childId: string): Promise<IslandsView> {
  if (!childId) throw new ApiError('invalid_request', { code: 'empty_id' });
  const response = await client.request('GET', `children/${encodeURIComponent(childId)}/islands/`);
  return read(response.data, islandsView);
}

/** The configured client's islands, or a `disabled` error in a build without the Django API. */
export function getIslandsFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): Promise<IslandsView> {
  return getIslands(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
  );
}

/** The published 3D Area of one Place, if this child has one. */
export function areaForPlace(view: IslandsView, placeSlug: string): PlaceArea | null {
  for (const island of view.islands) {
    const place = island.places.find((p) => p.placeId === placeSlug);
    if (place) return place.area;
  }
  return null;
}
