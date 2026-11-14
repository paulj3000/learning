import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../api/client';
import { ApiError } from '../../../api/errors';
import { createNpcHintApi } from './npcHintApi';

const CHILD = 'child-1';
const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response);
  const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
  return { client, fetch };
}

describe('npc hint API', () => {
  it('posts an empty body to the hint route of the area conversation and parses the hint', async () => {
    const { client, fetch } = setup(
      json(200, {
        contractVersion: 1,
        hint: { text: 'Count slowly.', source: 'FALLBACK', speech: null },
      }),
    );
    const api = createNpcHintApi(client, CHILD, { kind: 'area', regionId: 'treasure-rush-cove' });
    const response = await api.hint('pirate-pip', CONVERSATION);
    expect(response.hint).toEqual({ text: 'Count slowly.', source: 'FALLBACK', speech: null });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toContain(
      `children/${CHILD}/regions/treasure-rush-cove/npcs/pirate-pip/interactions/${CONVERSATION}/hint/`,
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({});
  });

  it('uses the Place route for a Place scope and rejects a refused hint', async () => {
    const { client, fetch } = setup(
      json(409, { error: { code: 'dialogue_unavailable', message: 'x' } }),
    );
    const api = createNpcHintApi(client, CHILD, { kind: 'place', placeSlug: 'storykeeper-castle' });
    await expect(api.hint('keeper-quill', CONVERSATION)).rejects.toBeInstanceOf(ApiError);
    expect(String(fetch.mock.calls[0][0])).toContain(
      'places/storykeeper-castle/npcs/keeper-quill/',
    );
  });
});
