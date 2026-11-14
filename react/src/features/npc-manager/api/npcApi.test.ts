import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../../api/client';
import { ApiError } from '../../../api/errors';
import { errorJson, jsonResponse } from '../../../test/playFixtures';
import { createNpcApi } from './npcApi';

const CHILD = '0b9f6f5e-3f1a-4b8e-9d2c-1a2b3c4d5e6f';

const character = {
  npcId: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'QUEST_GIVER',
  ageBands: [],
  personality: { traits: ['cheerful'] },
  dialogueMode: 'AUTHORED',
  voiceProfile: null,
  defaultVariant: 'classic',
  variants: [
    {
      variantKey: 'classic',
      displayName: 'Classic',
      model: { assetId: 'npc-pip', version: null },
      portrait: null,
      scale: 1,
      rotationOffsetY: 0,
      positionOffsetY: 0,
      animationMap: { idle: 'Idle' },
      extras: [],
    },
  ],
};

function sceneJson(area: string | null) {
  return {
    contractVersion: 1,
    release: 4,
    scope: { place: 'pirate-builder-bay', area },
    characters: { 'pirate-pip': character },
    placements: [
      {
        placementKey: 'cove-pip',
        npcId: 'pirate-pip',
        variant: 'classic',
        behavior: null,
        position: { x: 1, y: 0, z: 2 },
        rotationY: 0,
        scale: 1,
        interactionRadius: 2.5,
      },
    ],
  };
}

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({ baseUrl: '', getAccessToken: async () => 'tok', fetch });
  return { api: createNpcApi(client, CHILD), fetch };
}

const child = `/api/v1/children/${CHILD}/`;

describe('NPC runtime API', () => {
  it('reads the catalog', async () => {
    const { api, fetch } = setup(
      jsonResponse(200, { contractVersion: 1, release: 4, characters: [character] }),
    );
    const catalog = await api.getCatalog();
    expect(fetch.mock.calls[0][0]).toBe(`${child}npcs/`);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    expect(catalog.characters.map((c) => c.npcId)).toEqual(['pirate-pip']);
  });

  it('reads a 3D Area scene', async () => {
    const { api, fetch } = setup(jsonResponse(200, sceneJson('treasure-rush-cove')));
    const scene = await api.getAreaNpcs('treasure-rush-cove');
    expect(fetch.mock.calls[0][0]).toBe(`${child}regions/treasure-rush-cove/npcs/`);
    expect(scene.release).toBe(4);
    expect(scene.placements[0].placementKey).toBe('cove-pip');
    expect(scene.characters['pirate-pip'].displayName).toBe('Pirate Pip');
  });

  it('reads a Place scene with an encoded slug', async () => {
    const { api, fetch } = setup(jsonResponse(200, sceneJson(null)));
    const scene = await api.getPlaceNpcs('pirate-builder-bay');
    expect(fetch.mock.calls[0][0]).toBe(`${child}places/pirate-builder-bay/npcs/`);
    expect(scene.scope).toEqual({ place: 'pirate-builder-bay', area: null });
  });

  it.each(['no_active_release'])('turns 404 %s into an empty scene, not an error', async (code) => {
    const { api } = setup(
      jsonResponse(404, errorJson(code)),
      jsonResponse(404, errorJson(code)),
      jsonResponse(404, errorJson(code)),
    );
    expect(await api.getPlaceNpcs('bay')).toEqual({
      contractVersion: 1,
      release: 0,
      scope: { place: 'bay', area: null },
      characters: {},
      placements: [],
    });
    const area = await api.getAreaNpcs('cove');
    expect(area.placements).toEqual([]);
    expect(area.scope.area).toBe('cove');
    expect(await api.getCatalog()).toEqual({ contractVersion: 1, release: 0, characters: [] });
  });

  it('keeps other failures as errors', async () => {
    const { api } = setup(
      jsonResponse(404, errorJson('place_not_found')),
      jsonResponse(404, errorJson('not_found')),
      jsonResponse(404, errorJson('npc_not_found')),
    );
    await expect(api.getPlaceNpcs('nowhere')).rejects.toMatchObject({
      kind: 'not_found',
      code: 'place_not_found',
    });
    await expect(api.getAreaNpcs('cove')).rejects.toMatchObject({ code: 'not_found' });
    // Not a read-route code: never silently treated as "no NPCs".
    await expect(api.getCatalog()).rejects.toMatchObject({ code: 'npc_not_found' });
  });

  it('rejects a response that breaks the contract', async () => {
    const broken = sceneJson(null);
    broken.placements[0].variant = 'missing';
    const { api } = setup(jsonResponse(200, broken));
    await expect(api.getPlaceNpcs('bay')).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('rejects a newer contract version', async () => {
    const { api } = setup(jsonResponse(200, { ...sceneJson(null), contractVersion: 2 }));
    await expect(api.getPlaceNpcs('bay')).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses an empty id without a request', async () => {
    const { api, fetch } = setup();
    await expect(api.getAreaNpcs('')).rejects.toMatchObject({ code: 'empty_id' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
