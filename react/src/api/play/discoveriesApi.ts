import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read } from '../parse';

/**
 * `GET` and `POST /api/v1/children/<id>/discoveries/` (SC-R04-00,
 * docs/PLAY_API.md): the server's record of which secrets a child has found.
 *
 * The server decides whether a secret opens, whether this was the first find,
 * and what finding it grants. A caller sends only a discovery id.
 */
export type DiscoveryStatus = 'FOUND_NOW' | 'ALREADY_FOUND' | 'LOCKED';

export interface RecordedDiscovery {
  discoveryId: string;
  status: DiscoveryStatus;
  /** The authored locked line. Present only when the status is `LOCKED`. */
  message?: string;
  rewardMessages: readonly string[];
  newItemIds: readonly string[];
}

export interface DiscoveriesApi {
  list(): Promise<readonly string[]>;
  record(discoveryId: string): Promise<RecordedDiscovery>;
}

const base = (childId: string) => `children/${encodeURIComponent(childId)}/discoveries/`;

function requireId(value: string, name: string): void {
  if (!value) throw new ApiError('invalid_request', { code: `empty_${name}` });
}

export async function getDiscoveries(
  client: ApiClient,
  childId: string,
): Promise<readonly string[]> {
  requireId(childId, 'id');
  const response = await client.request('GET', base(childId));
  return read(response.data, (r) => r.field('discoveries').array((id) => id.string()));
}

export async function recordDiscoveryOnServer(
  client: ApiClient,
  childId: string,
  discoveryId: string,
): Promise<RecordedDiscovery> {
  requireId(childId, 'id');
  requireId(discoveryId, 'discovery');
  const response = await client.request('POST', base(childId), { body: { discoveryId } });
  return read(response.data, (r) => {
    const status = r.field('status').string();
    if (status !== 'FOUND_NOW' && status !== 'ALREADY_FOUND' && status !== 'LOCKED') {
      throw new ApiError('invalid_response', { code: `unknown status at ${r.path}.status` });
    }
    const message = r.object().message;
    return {
      discoveryId: r.field('discoveryId').string(),
      status,
      ...(typeof message === 'string' ? { message } : {}),
      rewardMessages: r.object().rewardMessages
        ? r.field('rewardMessages').array((m) => m.string())
        : [],
      newItemIds: r.object().newItemIds ? r.field('newItemIds').array((m) => m.string()) : [],
    };
  });
}

/** The configured API for one child, or `undefined` in a build without the Django API. */
export function discoveriesApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): DiscoveriesApi | undefined {
  const client = createApiClient({
    baseUrl: config.baseUrl,
    getAccessToken,
    provisionAccount: true,
  });
  return {
    list: () => getDiscoveries(client, childId),
    record: (discoveryId) => recordDiscoveryOnServer(client, childId, discoveryId),
  };
}
