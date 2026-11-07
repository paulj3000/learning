import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { createDjangoAudioSource, djangoAudioSourceFor, manifestPath } from './audioManifestApi';

const CHILD = '5b2f1c3e-0000-4000-8000-000000000001';

function entry(ref: string, family = 'audio') {
  return {
    ref,
    id: ref.split('@')[0],
    status: 'resolved',
    family,
    kind: family === 'audio' ? 'audio' : 'character',
    format: family === 'audio' ? 'wav' : 'glb',
    url: `/api/v1/asset-files/token-${ref}/audio.wav`,
    urlExpiresAt: '2099-01-01T00:00:00Z',
    cache: { key: `${ref}-key`, immutable: true, ttl: 3600 },
  };
}

function fakeClient(answers: (path: string) => unknown = () => ({ assets: [] })) {
  const request = vi.fn(async (_method: string, path: string) => ({
    status: 200,
    data: answers(path),
  }));
  return { client: { request } as unknown as ApiClient, request };
}

describe('manifestPath', () => {
  it('addresses the child-scoped read-only manifest routes', () => {
    expect(manifestPath(CHILD, { type: 'region', id: 'treasure-cove' })).toBe(
      `children/${CHILD}/audio/manifests/regions/treasure-cove/`,
    );
    expect(manifestPath(CHILD, { type: 'island', id: 'home' })).toContain('/islands/home/');
    expect(manifestPath(CHILD, { type: 'place', id: 'bay' })).toContain('/places/bay/');
  });

  it('encodes ids so they cannot change the path', () => {
    expect(manifestPath('a/b', { type: 'region', id: '../x' })).toBe(
      'children/a%2Fb/audio/manifests/regions/..%2Fx/',
    );
  });
});

describe('createDjangoAudioSource', () => {
  it("fetches the manifest with GET and the caller's abort signal", async () => {
    const { client, request } = fakeClient(() => ({ schemaVersion: 1 }));
    const source = createDjangoAudioSource({ client, childId: CHILD });
    const controller = new AbortController();
    await expect(
      source.fetchManifest({ type: 'region', id: 'treasure-cove' }, controller.signal),
    ).resolves.toEqual({ schemaVersion: 1 });
    expect(request).toHaveBeenCalledWith(
      'GET',
      `children/${CHILD}/audio/manifests/regions/treasure-cove/`,
      { signal: controller.signal },
    );
  });

  it('lets a failed request surface so the sync can record it', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    const source = createDjangoAudioSource({
      client: { request } as unknown as ApiClient,
      childId: CHILD,
    });
    await expect(
      source.fetchManifest({ type: 'region', id: 'x' }, new AbortController().signal),
    ).rejects.toThrow('offline');
  });

  it('resolves a pinned reference to a signed url and a stable cache key', async () => {
    const { client, request } = fakeClient(() => ({ assets: [entry('coin@1')] }));
    const { resolver } = createDjangoAudioSource({ client, childId: CHILD });
    const resolved = await resolver.resolve('coin@1');
    expect(resolved).toEqual({
      id: 'coin@1',
      url: '/api/v1/asset-files/token-coin@1/audio.wav',
      cacheKey: 'coin@1-key',
    });
    expect(request.mock.calls[0]?.[1]).toBe(`children/${CHILD}/assets/?ids=coin%401`);
  });

  it('rejects an answer that is not audio instead of playing it', async () => {
    const { client } = fakeClient(() => ({ assets: [entry('coin@1', 'model')] }));
    const { resolver } = createDjangoAudioSource({ client, childId: CHILD });
    await expect(resolver.resolve('coin@1')).rejects.toThrow();
  });

  it('rejects an unpublished or retired asset (there is no bundled audio to fall back to)', async () => {
    const { client } = fakeClient(() => ({
      assets: [{ ref: 'coin@1', id: 'coin', status: 'retired' }],
    }));
    const { resolver } = createDjangoAudioSource({ client, childId: CHILD });
    await expect(resolver.resolve('coin@1')).rejects.toThrow('no bundled audio');
  });

  it('rejects when the request fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('down'));
    const { resolver } = createDjangoAudioSource({
      client: { request } as unknown as ApiClient,
      childId: CHILD,
    });
    await expect(resolver.resolve('coin@1')).rejects.toThrow();
  });

  it('remembers an answer until asked to refresh, then asks Django again', async () => {
    const { client, request } = fakeClient(() => ({ assets: [entry('coin@1')] }));
    const { resolver } = createDjangoAudioSource({ client, childId: CHILD });
    await resolver.resolve('coin@1');
    await resolver.resolve('coin@1');
    expect(request).toHaveBeenCalledTimes(1);
    await resolver.resolve('coin@1', { forceRefresh: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never sends anything but reads', async () => {
    const { client, request } = fakeClient(() => ({ assets: [entry('coin@1')] }));
    const source = createDjangoAudioSource({ client, childId: CHILD });
    await source.resolver.resolve('coin@1');
    await source.fetchManifest({ type: 'place', id: 'bay' }, new AbortController().signal);
    expect(new Set(request.mock.calls.map((call) => call[0]))).toEqual(new Set(['GET']));
  });
});

describe('djangoAudioSourceFor', () => {
  it('is null for a build without the Django API, so no sound is attempted', () => {
    expect(djangoAudioSourceFor(CHILD, { enabled: false })).toBeNull();
  });

  it('builds a source when the Django API is on', () => {
    const source = djangoAudioSourceFor(CHILD, { enabled: true, baseUrl: '' });
    expect(source?.fetchManifest).toBeTypeOf('function');
    expect(source?.resolver.resolve).toBeTypeOf('function');
  });
});
