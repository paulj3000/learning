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
export interface PlaceArea {
  regionId: string;
  title: string;
  available: boolean;
}

export interface PlaceSummary {
  placeId: string;
  title: string;
  tagline: string;
  adventureCount: number;
  area: PlaceArea | null;
}

export interface IslandSummary {
  islandId: string;
  title: string;
  tagline: string;
  isHome: boolean;
  places: PlaceSummary[];
}

export interface IslandsView {
  islands: IslandSummary[];
  /** Set when exactly one Island is available, so the Island choice can be skipped. */
  autoSelectIslandId: string | null;
}

function area(r: Reader): PlaceArea {
  return {
    regionId: r.field('regionId').string(),
    title: r.field('title').string(),
    available: r.field('available').boolean(),
  };
}

export function islandsView(r: Reader): IslandsView {
  return {
    islands: r.field('islands').array((island) => ({
      islandId: island.field('islandId').string(),
      title: island.field('title').string(),
      tagline: island.field('tagline').string(),
      isHome: island.field('isHome').boolean(),
      places: island.field('places').array((place) => ({
        placeId: place.field('placeId').string(),
        title: place.field('title').string(),
        tagline: place.field('tagline').string(),
        adventureCount: place.field('adventureCount').integer(),
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
  if (!config.enabled) return Promise.reject(new ApiError('disabled'));
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
