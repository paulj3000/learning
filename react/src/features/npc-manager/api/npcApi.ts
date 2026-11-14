import { getAccessToken } from '../../../api/auth';
import { createApiClient, type ApiClient } from '../../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../../api/config';
import { ApiError } from '../../../api/errors';
import { parseCatalog, parseScene } from '../contracts/parse';
import type { NpcCatalogResponse, NpcSceneResponse } from '../contracts/types';
import { CONTRACT_VERSION } from '../contracts/vocabulary';

/**
 * NPC Manager runtime reads (LAI-NPC-007, docs/NPC_MANAGER_CONTRACTS.md section 5.1), scoped to
 * one child. Responses are parsed with `contracts/parse.ts`; a response that does not match the
 * contract is an `ApiError('invalid_response')`.
 *
 * "No NPCs here" is not an error: when nothing is published (including a retired active release)
 * the server answers `200` with `release: 0` and nothing in it (QA F-A), so a world simply shows
 * no NPCs. An older server's `404 no_active_release` still resolves to the same empty answer. Every other failure (signed out, foreign child, unknown
 * Place or Area, offline) still rejects with the client's `ApiError`; a host shows no NPCs for
 * those too, but can tell them apart.
 */

export interface NpcApi {
  getCatalog(signal?: AbortSignal): Promise<NpcCatalogResponse>;
  getAreaNpcs(regionId: string, signal?: AbortSignal): Promise<NpcSceneResponse>;
  getPlaceNpcs(placeSlug: string, signal?: AbortSignal): Promise<NpcSceneResponse>;
}

/** The server codes that mean "show no NPCs" rather than an error screen. */
export const EMPTY_SCENE_CODES: ReadonlySet<string> = new Set(['no_active_release']);

export function isEmptySceneError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && EMPTY_SCENE_CODES.has(error.code);
}

export function emptyScene(place: string, area: string | null): NpcSceneResponse {
  return {
    contractVersion: CONTRACT_VERSION,
    release: 0,
    scope: { place, area },
    characters: {},
    placements: [],
  };
}

export function emptyCatalog(): NpcCatalogResponse {
  return { contractVersion: CONTRACT_VERSION, release: 0, characters: [] };
}

export function createNpcApi(client: ApiClient, childId: string): NpcApi {
  const child = `children/${segment(childId)}/`;

  async function get<T>(
    path: string,
    parse: (value: unknown) => T,
    empty: () => T,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      const response = await client.request('GET', `${child}${path}`, { signal });
      return parse(response.data);
    } catch (error) {
      if (isEmptySceneError(error)) return empty();
      throw error;
    }
  }

  return {
    getCatalog: (signal) => get('npcs/', parseCatalog, emptyCatalog, signal),
    getAreaNpcs: async (regionId, signal) => {
      const area = segment(regionId);
      // The Place is unknown without a release; the area is what the caller asked for.
      return get(`regions/${area}/npcs/`, parseScene, () => emptyScene('', regionId), signal);
    },
    getPlaceNpcs: async (placeSlug, signal) =>
      get(
        `places/${segment(placeSlug)}/npcs/`,
        parseScene,
        () => emptyScene(placeSlug, null),
        signal,
      ),
  };
}

/** One path segment, encoded, and never empty (an empty id would change the route). */
function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

/** The app's NPC API for a child, or a `disabled` error when this build has no Django API. */
export function npcApiFor(childId: string, config: DjangoApiConfig = DJANGO_API_CONFIG): NpcApi {
  return createNpcApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
  );
}
