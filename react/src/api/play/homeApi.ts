import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read, type Reader } from '../parse';

/**
 * `GET /api/v1/children/<id>/home/` (LAI-ANDROID-API-001): the child home summary the AP-02
 * dashboard draws. Only the fields the dashboard uses are read; every count is the server's,
 * so nothing here is a new progress measure (CLAUDE.md pillar 7, "avoid invented metrics").
 */
export interface HomeRegion {
  regionId: string;
  title: string;
  description: string;
  placeTitle: string;
  available: boolean;
  /** NOT_STARTED, IN_PROGRESS (an open session) or VISITED. */
  status: string;
  chestsTotal: number;
  chestsOpened: number;
  /** True when the child has an open session here to pick up. */
  canResume: boolean;
}

export interface HomeProgress {
  completedSessions: number;
  worldChanges: number;
  items: number;
  questsCompleted: number;
  questsActive: number;
}

export interface HomeItem {
  itemId: string;
  displayName: string;
}

export interface ChildHome {
  lastRegion: HomeRegion | null;
  resume: HomeRegion[];
  nextRegions: HomeRegion[];
  progress: HomeProgress;
  recentItems: HomeItem[];
}

function region(r: Reader): HomeRegion {
  return {
    regionId: r.field('regionId').string(),
    title: r.field('title').string(),
    description: r.field('description').string(),
    placeTitle: r.field('location').field('title').string(),
    available: r.field('available').boolean(),
    status: r.field('status').string(),
    chestsTotal: r.field('chestsTotal').integer(),
    chestsOpened: r.field('chestsOpened').integer(),
    canResume: r.field('resume').nullable(() => true) === true,
  };
}

export function childHome(r: Reader): ChildHome {
  const progress = r.field('progress');
  return {
    lastRegion: r.field('lastRegion').nullable(region),
    resume: r.field('resume').array(region),
    nextRegions: r.field('nextRegions').array(region),
    progress: {
      completedSessions: progress.field('completedSessions').integer(),
      worldChanges: progress.field('worldChanges').integer(),
      items: progress.field('items').integer(),
      questsCompleted: progress.field('questsCompleted').integer(),
      questsActive: progress.field('questsActive').integer(),
    },
    recentItems: r.field('recentItems').array((entry) => ({
      itemId: entry.field('item').field('itemId').string(),
      displayName: entry.field('item').field('displayName').string(),
    })),
  };
}

export async function getChildHome(client: ApiClient, childId: string): Promise<ChildHome> {
  if (!childId) throw new ApiError('invalid_request', { code: 'empty_id' });
  const response = await client.request('GET', `children/${encodeURIComponent(childId)}/home/`);
  return read(response.data, childHome);
}

/** The configured client's home summary, or a `disabled` error in a build without the Django API. */
export function getChildHomeFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): Promise<ChildHome> {
  if (!config.enabled) return Promise.reject(new ApiError('disabled'));
  return getChildHome(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
  );
}
