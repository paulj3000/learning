import { createApiClient } from '../../../api/client';
import { ApiError } from '../../../api/errors';
import { createNpcDialogueApi, type DialogueScope } from './npcDialogueApi';

const CHILD = '11111111-2222-3333-4444-555555555555';
const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function interactionJson(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 1,
    release: 3,
    npcId: 'pirate-pip',
    conversationId: CONVERSATION,
    dialogueKey: 'greeting',
    node: {
      nodeKey: 'hello',
      text: 'Ahoy!',
      emotion: 'happy',
      animationState: 'wave',
      audio: null,
      speech: null,
      allowAiHint: false,
    },
    choices: [{ choiceKey: 'ok', label: 'Okay', action: 'NONE' }],
    ended: false,
    questOffer: null,
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(scope: DialogueScope, ...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
  return { api: createNpcDialogueApi(client, CHILD, scope), fetch };
}

function sent(fetch: ReturnType<typeof setup>['fetch'], index = 0) {
  const [url, init] = fetch.mock.calls[index];
  return { url, method: init?.method, body: JSON.parse(init?.body as string) as unknown };
}

const AREA: DialogueScope = { kind: 'area', regionId: 'treasure-rush-cove' };
const PLACE: DialogueScope = { kind: 'place', placeSlug: 'pirate-bay' };

describe('NPC dialogue API', () => {
  it('starts an interaction in a 3D Area with only the contract fields', async () => {
    const { api, fetch } = setup(AREA, json(200, interactionJson()));
    const response = await api.start('pirate-pip', {
      trigger: 'on_interact',
      placementKey: 'cove-pip',
    });
    expect(response.node?.text).toBe('Ahoy!');
    expect(sent(fetch)).toEqual({
      url: `/api/v1/children/${CHILD}/regions/treasure-rush-cove/npcs/pirate-pip/interactions/`,
      method: 'POST',
      body: { trigger: 'on_interact', placementKey: 'cove-pip' },
    });
  });

  it('chooses, advances and ends in a Place', async () => {
    const { api, fetch } = setup(
      PLACE,
      json(200, interactionJson()),
      json(200, interactionJson()),
      json(200, interactionJson({ node: null, choices: [], ended: true })),
    );
    await api.choose('pirate-pip', CONVERSATION, 'ok');
    await api.advance('pirate-pip', CONVERSATION);
    const ended = await api.end('pirate-pip', CONVERSATION);
    const base = `/api/v1/children/${CHILD}/places/pirate-bay/npcs/pirate-pip/interactions/${CONVERSATION}/`;
    expect(sent(fetch, 0)).toEqual({
      url: `${base}choose/`,
      method: 'POST',
      body: { choiceKey: 'ok' },
    });
    expect(sent(fetch, 1)).toEqual({ url: `${base}advance/`, method: 'POST', body: {} });
    expect(sent(fetch, 2)).toEqual({ url: `${base}end/`, method: 'POST', body: {} });
    expect(ended.ended).toBe(true);
  });

  it('turns API errors and bad responses into ApiError', async () => {
    const { api } = setup(
      AREA,
      json(409, { error: { code: 'invalid_choice', message: 'x' } }),
      json(200, { ...interactionJson(), contractVersion: 2 }),
    );
    await expect(api.choose('pirate-pip', CONVERSATION, 'zzz')).rejects.toMatchObject({
      kind: 'conflict',
      code: 'invalid_choice',
    });
    await expect(api.advance('pirate-pip', CONVERSATION)).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('refuses empty ids', async () => {
    const { api } = setup(AREA);
    await expect(api.end('', CONVERSATION)).rejects.toBeInstanceOf(ApiError);
  });
});
