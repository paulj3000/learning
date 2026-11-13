import { getAccessToken } from '../../../api/auth';
import { createApiClient, type ApiClient } from '../../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../../api/config';
import { ApiError } from '../../../api/errors';
import { parseInteraction } from '../contracts/parse';
import type { InteractionResponse, InteractionStartRequest } from '../contracts/types';

/**
 * The NPC interaction API (contract v1 section 5.2) for one child in one scope: a 3D Area
 * (`regions/<regionId>`) or a Place without one (`places/<placeSlug>`).
 *
 * The server chooses the dialogue, filters nodes and choices for the child and owns every
 * outcome. Bodies carry only what the contract accepts: a trigger (and optional placement key)
 * to start, a choice key to choose, and nothing for advance and end.
 */

export type DialogueScope =
  { kind: 'area'; regionId: string } | { kind: 'place'; placeSlug: string };

export interface NpcDialogueApi {
  start(
    npcId: string,
    request: InteractionStartRequest,
    signal?: AbortSignal,
  ): Promise<InteractionResponse>;
  choose(
    npcId: string,
    conversationId: string,
    choiceKey: string,
    signal?: AbortSignal,
  ): Promise<InteractionResponse>;
  advance(
    npcId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<InteractionResponse>;
  end(npcId: string, conversationId: string, signal?: AbortSignal): Promise<InteractionResponse>;
}

export function createNpcDialogueApi(
  client: ApiClient,
  childId: string,
  scope: DialogueScope,
): NpcDialogueApi {
  const base =
    `children/${encodeURIComponent(childId)}/` +
    (scope.kind === 'area'
      ? `regions/${segment(scope.regionId)}/npcs/`
      : `places/${segment(scope.placeSlug)}/npcs/`);

  async function send(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<InteractionResponse> {
    const response = await client.request('POST', `${base}${path}`, { body, signal });
    return parseInteraction(response.data);
  }

  const conversation = (npcId: string, conversationId: string, action: string) =>
    `${segment(npcId)}/interactions/${segment(conversationId)}/${action}/`;

  // Every method is async, so a bad id rejects like any other failure instead of throwing.
  return {
    async start(npcId, request, signal) {
      const body: Record<string, unknown> = { trigger: request.trigger };
      if (request.placementKey !== undefined) body.placementKey = request.placementKey;
      return send(`${segment(npcId)}/interactions/`, body, signal);
    },
    async choose(npcId, conversationId, choiceKey, signal) {
      return send(conversation(npcId, conversationId, 'choose'), { choiceKey }, signal);
    },
    async advance(npcId, conversationId, signal) {
      return send(conversation(npcId, conversationId, 'advance'), {}, signal);
    },
    async end(npcId, conversationId, signal) {
      return send(conversation(npcId, conversationId, 'end'), {}, signal);
    },
  };
}

/** One path segment, encoded, and never empty (an empty id would change the route). */
function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

/** The app's interaction API, or one that rejects with `disabled` when there is no Django API. */
export function npcDialogueApiFor(
  childId: string,
  scope: DialogueScope,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): NpcDialogueApi {
  if (!config.enabled) {
    const disabled = () => Promise.reject(new ApiError('disabled'));
    return { start: disabled, choose: disabled, advance: disabled, end: disabled };
  }
  return createNpcDialogueApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
    scope,
  );
}
