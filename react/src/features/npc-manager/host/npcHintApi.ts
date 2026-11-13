import { getAccessToken } from '../../../api/auth';
import { createApiClient, type ApiClient } from '../../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../../api/config';
import { ApiError } from '../../../api/errors';
import { parseHint } from '../contracts/parse';
import type { HintResponse } from '../contracts/types';
import type { DialogueScope } from '../dialogue/npcDialogueApi';

/**
 * The hybrid hint route (contract v1 section 5.3): `POST .../npcs/<npc>/interactions/<id>/hint/`
 * with an empty body. The server builds the whole context; no child text is ever sent. A hint is
 * words only: AI off, refused or rate limited still answers with an authored fallback line.
 */
export interface NpcHintApi {
  hint(npcId: string, conversationId: string, signal?: AbortSignal): Promise<HintResponse>;
}

export function createNpcHintApi(
  client: ApiClient,
  childId: string,
  scope: DialogueScope,
): NpcHintApi {
  const base =
    `children/${segment(childId)}/` +
    (scope.kind === 'area'
      ? `regions/${segment(scope.regionId)}/npcs/`
      : `places/${segment(scope.placeSlug)}/npcs/`);
  return {
    async hint(npcId, conversationId, signal) {
      const path = `${base}${segment(npcId)}/interactions/${segment(conversationId)}/hint/`;
      const response = await client.request('POST', path, { body: {}, signal });
      return parseHint(response.data);
    },
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

/** The app's hint API, or one that rejects with `disabled` when there is no Django API. */
export function npcHintApiFor(
  childId: string,
  scope: DialogueScope,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): NpcHintApi {
  if (!config.enabled) return { hint: () => Promise.reject(new ApiError('disabled')) };
  return createNpcHintApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
    scope,
  );
}
