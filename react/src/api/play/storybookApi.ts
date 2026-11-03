import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read } from '../parse';

/**
 * `GET /api/v1/children/<id>/castle/storybook/` (SC-R04-02, docs/PLAY_API.md):
 * the Great Storybook as the server derives it from its own records.
 *
 * Read-only. A page is back exactly when the record it names exists on the server;
 * nothing a caller sends can restore one, and asking changes nothing. The child's age
 * band is the server's own, from their profile.
 */
export interface ServerStorybookPage {
  id: string;
  title: string;
  required: boolean;
  restored: boolean;
  roomId: string;
  /** The page's own words: what it says once it is back, or where to look while it is missing. */
  text: string;
}

export interface ServerStorybook {
  band: string;
  /** Required pages always; the hidden bonus page only once it has been found. */
  pages: readonly ServerStorybookPage[];
  restoredRequired: number;
  totalRequired: number;
  restoredBonus: number;
  complete: boolean;
  quest: { questId: string | null; status: string };
}

export interface StorybookApi {
  get(): Promise<ServerStorybook>;
}

export async function getStorybook(client: ApiClient, childId: string): Promise<ServerStorybook> {
  if (!childId) throw new ApiError('invalid_request', { code: 'empty_id' });
  const response = await client.request(
    'GET',
    `children/${encodeURIComponent(childId)}/castle/storybook/`,
  );
  return read(response.data, (r) => ({
    band: r.field('band').string(),
    pages: r.field('pages').array((page) => ({
      id: page.field('id').string(),
      title: page.field('title').string(),
      required: page.field('required').boolean(),
      restored: page.field('restored').boolean(),
      roomId: page.field('roomId').string(),
      text: page.field('text').string(),
    })),
    restoredRequired: r.field('restoredRequired').integer(),
    totalRequired: r.field('totalRequired').integer(),
    restoredBonus: r.field('restoredBonus').integer(),
    complete: r.field('complete').boolean(),
    quest: {
      questId: r
        .field('quest')
        .field('questId')
        .nullable((v) => v.string()),
      status: r.field('quest').field('status').string(),
    },
  }));
}

/** The configured API for one child, or `undefined` in a build without the Django API. */
export function storybookApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): StorybookApi | undefined {
  if (!config.enabled) return undefined;
  const client = createApiClient({
    baseUrl: config.baseUrl,
    getAccessToken,
    provisionAccount: true,
  });
  return { get: () => getStorybook(client, childId) };
}
