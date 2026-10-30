import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Group } from 'three';
import type { ApiClient } from '../client';
import { ApiError } from '../errors';
import { createAssetLoader } from '../../features/island-map/three/assets/assetLoader';
import { BUNDLED_ASSET_RESOLVER } from '../../features/island-map/three/assets/assetResolver';
import {
  createDjangoAssetResolver,
  djangoAssetResolverFor,
  reportAssetResolutionIssue,
  type AssetResolutionIssue,
} from './djangoAssetResolver';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const LATER = '2026-10-25T13:00:00Z';

function resolved(
  ref: string,
  url = `/api/v1/asset-files/token-${ref}/model.glb`,
  expires = LATER,
) {
  return { ref, id: ref.split('@')[0], status: 'resolved', url, urlExpiresAt: expires };
}

function fakeClient(answer: (path: string) => unknown) {
  const request = vi.fn(async (_method: string, path: string) => ({
    status: 200,
    data: answer(path),
  }));
  return { client: { request } as unknown as ApiClient, request };
}

function idsOf(path: string): string[] {
  return decodeURIComponent(path.split('?ids=')[1] ?? '').split(',');
}

function echoAll(path: string) {
  return { assets: idsOf(path).map((id) => resolved(id)) };
}

describe('createDjangoAssetResolver', () => {
  it('resolves published assets to their delivery URL', async () => {
    const { client } = fakeClient(() => ({ assets: [resolved('npc-pip')] }));
    const resolver = createDjangoAssetResolver({ client, childId: 'child-1', now: () => NOW });
    await expect(resolver.resolve('npc-pip')).resolves.toEqual({
      id: 'npc-pip',
      url: '/api/v1/asset-files/token-npc-pip/model.glb',
      source: 'PUBLISHED',
    });
  });

  it('batches the ids a scene asks for in one tick into one request', async () => {
    const { client, request } = fakeClient(echoAll);
    const resolver = createDjangoAssetResolver({ client, childId: 'child-1', now: () => NOW });
    const ids = ['npc-pip', 'rock', 'npc-pip', 'treasure-chest'];
    await Promise.all(ids.map((id) => resolver.resolve(id)));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toBe(
      'children/child-1/assets/?ids=npc-pip,rock,treasure-chest',
    );
  });

  it('splits more than 100 ids into several requests', async () => {
    const { client, request } = fakeClient(echoAll);
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW });
    const ids = Array.from({ length: 150 }, (_, i) => `prop-${i}`);
    await Promise.all(ids.map((id) => resolver.resolve(id)));
    expect(request).toHaveBeenCalledTimes(2);
    expect(idsOf(request.mock.calls[0]?.[1] ?? '')).toHaveLength(100);
  });

  it('reuses an answer until its URL is close to expiring, then resolves again', async () => {
    let clock = NOW;
    const { client, request } = fakeClient(() => ({ assets: [resolved('npc-pip')] }));
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => clock });
    await resolver.resolve('npc-pip');
    clock = NOW + 30 * 60_000;
    await resolver.resolve('npc-pip');
    expect(request).toHaveBeenCalledTimes(1);
    clock = Date.parse(LATER) - 30_000; // within 60 s of expiry
    await resolver.resolve('npc-pip');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['unavailable', 'retired'])('falls back to the bundled file when %s', async (status) => {
    const { client } = fakeClient(() => ({ assets: [{ ref: 'npc-pip', id: 'npc-pip', status }] }));
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW });
    const bundled = await BUNDLED_ASSET_RESOLVER.resolve('npc-pip');
    await expect(resolver.resolve('npc-pip')).resolves.toEqual(bundled);
  });

  it('rejects an id nobody knows: the loader failure path placeholders handle', async () => {
    const { client } = fakeClient(() => ({
      assets: [{ ref: 'no-such', id: 'no-such', status: 'unavailable' }],
    }));
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW });
    await expect(resolver.resolve('no-such')).rejects.toThrow();
  });

  it('keeps the game on bundled files when the API fails, and retries later', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network'))
      .mockResolvedValueOnce({ status: 200, data: { assets: [resolved('npc-pip')] } });
    const resolver = createDjangoAssetResolver({
      client: { request } as unknown as ApiClient,
      childId: 'c',
      now: () => NOW,
    });
    expect((await resolver.resolve('npc-pip')).source).toBe('BUNDLED');
    expect((await resolver.resolve('npc-pip')).source).toBe('PUBLISHED');
  });

  it.each([
    'javascript:alert(1)',
    'http://cdn.example.test/model.glb',
    '//evil.example/model.glb',
    'data:model/gltf-binary;base64,AAAA',
  ])('never hands the loader an unsafe URL (%s)', async (url) => {
    const { client } = fakeClient(() => ({ assets: [resolved('npc-pip', url)] }));
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW });
    expect((await resolver.resolve('npc-pip')).source).toBe('BUNDLED');
  });

  it('accepts presigned https URLs and prefixes same-origin paths with the API base', async () => {
    const { client } = fakeClient(() => ({
      assets: [resolved('npc-pip', 'https://bucket.example/x?sig=1'), resolved('rock')],
    }));
    const resolver = createDjangoAssetResolver({
      client,
      childId: 'c',
      baseUrl: 'https://api.example.test',
      now: () => NOW,
    });
    expect((await resolver.resolve('npc-pip')).url).toBe('https://bucket.example/x?sig=1');
    expect((await resolver.resolve('rock')).url).toBe(
      'https://api.example.test/api/v1/asset-files/token-rock/model.glb',
    );
  });

  it('plugs into the existing LAI-2106 loader and its cache unchanged', async () => {
    const { client, request } = fakeClient(() => ({ assets: [resolved('npc-pip')] }));
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW });
    const fetched: string[] = [];
    const loader = createAssetLoader(resolver, async (url) => {
      fetched.push(url);
      return { scene: new Group(), animations: [] } as unknown as GLTF;
    });
    await Promise.all([loader.loadAsset('npc-pip'), loader.loadAsset('npc-pip')]);
    await loader.loadAsset('npc-pip');
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain('/api/v1/asset-files/token-npc-pip/model.glb');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('djangoAssetResolverFor', () => {
  it('is the bundled resolver in builds without the Django API', () => {
    expect(djangoAssetResolverFor('c', { enabled: false })).toBe(BUNDLED_ASSET_RESOLVER);
  });
});

describe('createDjangoAssetResolver: why an id fell back (TR-10)', () => {
  function collecting() {
    const issues: AssetResolutionIssue[] = [];
    return { issues, onIssue: (issue: AssetResolutionIssue) => issues.push(issue) };
  }

  it('reports a missing publication as not-published, never as a failure', async () => {
    const { client } = fakeClient(() => ({
      assets: [
        { ref: 'npc-pip', id: 'npc-pip', status: 'unavailable' },
        { ref: 'old-boat', id: 'old-boat', status: 'retired' },
        resolved('rock', 'http://insecure.example/rock.glb'),
        resolved('treasure-chest'),
      ],
    }));
    const { issues, onIssue } = collecting();
    const resolver = createDjangoAssetResolver({ client, childId: 'c', now: () => NOW, onIssue });
    await Promise.allSettled(
      ['npc-pip', 'old-boat', 'rock', 'treasure-chest'].map((id) => resolver.resolve(id)),
    );
    expect(issues).toEqual([
      { kind: 'not-published', id: 'npc-pip', status: 'unavailable' },
      { kind: 'not-published', id: 'old-boat', status: 'retired' },
      { kind: 'not-published', id: 'rock', status: 'unusable' },
    ]);
  });

  it.each([
    new ApiError('unauthenticated', { status: 401 }),
    new ApiError('not_found', { status: 404 }),
    new ApiError('network'),
  ])(
    'reports a failed request with its error, then still plays on bundled files',
    async (error) => {
      const request = vi.fn().mockRejectedValue(error);
      const { issues, onIssue } = collecting();
      const resolver = createDjangoAssetResolver({
        client: { request } as unknown as ApiClient,
        childId: 'c',
        now: () => NOW,
        onIssue,
      });
      const [pip, chest] = await Promise.all([
        resolver.resolve('npc-pip'),
        resolver.resolve('treasure-chest'),
      ]);
      expect([pip.source, chest.source]).toEqual(['BUNDLED', 'BUNDLED']);
      expect(issues).toEqual([
        { kind: 'request-failed', ids: ['npc-pip', 'treasure-chest'], error },
      ]);
    },
  );

  it('never lets a throwing reporter break resolution', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('network'));
    const resolver = createDjangoAssetResolver({
      client: { request } as unknown as ApiClient,
      childId: 'c',
      now: () => NOW,
      onIssue: () => {
        throw new Error('reporter bug');
      },
    });
    expect((await resolver.resolve('npc-pip')).source).toBe('BUNDLED');
  });
});

describe('reportAssetResolutionIssue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warns about a failed request with the kind and status only', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportAssetResolutionIssue({
      kind: 'request-failed',
      ids: ['npc-pip', 'treasure-chest'],
      error: new ApiError('forbidden', { status: 403, code: 'secret-detail' }),
    });
    expect(warn).toHaveBeenCalledWith(
      '[assets] the asset manager request failed (forbidden 403); using bundled models for: npc-pip, treasure-chest',
    );
  });

  it('words an unpublished id as expected, not as a failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reportAssetResolutionIssue({ kind: 'not-published', id: 'npc-pip', status: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(
      '[assets] "npc-pip" is unavailable in the asset manager (expected until it is published); using the bundled model',
    );
  });
});
