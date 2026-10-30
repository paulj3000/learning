import { Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  PreviewError,
  fetchPreviewModel,
  parsePreviewModel,
  sniffFormat,
  type PreviewErrorCode,
} from './previewModelSource';
import { fakeResponse, glbFile, gltfFile } from './previewFixtures';

const OPTIONS = {
  url: '/admin/assets/assetversion/7/preview/model/',
  tokenHeader: 'X-Asset-Preview-Token',
  token: 'signed-token',
  maxBytes: 1024 * 1024,
};

async function codeOf(promise: Promise<unknown>): Promise<PreviewErrorCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as Error).message).not.toMatch(/stack|Traceback|amazonaws|token/i);
    return (error as PreviewError).code;
  }
}

describe('fetchPreviewModel', () => {
  it('sends the token in a header, never in the url, with the session cookie only', async () => {
    const data = glbFile();
    const fetchImpl = vi.fn(async () =>
      fakeResponse(200, data, { 'Content-Length': String(data.byteLength) }),
    );
    const result = await fetchPreviewModel({ ...OPTIONS, fetchImpl });
    expect(result).toBe(data);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPTIONS.url);
    expect(url).not.toContain('signed-token');
    expect(init.headers).toEqual({ 'X-Asset-Preview-Token': 'signed-token' });
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.redirect).toBe('error');
  });

  it.each([
    [401, null, 'forbidden'],
    [403, { error: { code: 'forbidden' } }, 'forbidden'],
    [404, { error: { code: 'not_found' } }, 'missing'],
    [409, { error: { code: 'not_previewable' } }, 'not_previewable'],
    [409, { error: { code: 'checksum_mismatch' } }, 'checksum_mismatch'],
    [410, { error: { code: 'preview_expired' } }, 'expired'],
    [413, { error: { code: 'too_large' } }, 'too_large'],
    [503, { error: { code: 'content_unavailable' } }, 'storage'],
    [500, null, 'storage'],
  ] as const)('maps HTTP %i (%j) to %s', async (status, body, expected) => {
    const fetchImpl = vi.fn(async () => fakeResponse(status, body));
    expect(await codeOf(fetchPreviewModel({ ...OPTIONS, fetchImpl }))).toBe(expected);
  });

  it('treats a failed request or a login redirect (fetch rejects with redirect: error) as network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await codeOf(fetchPreviewModel({ ...OPTIONS, fetchImpl }))).toBe('network');
  });

  it('refuses a body over the limit by its declared length and by its real length', async () => {
    const declared = vi.fn(async () =>
      fakeResponse(200, glbFile(), { 'Content-Length': String(OPTIONS.maxBytes + 1) }),
    );
    expect(await codeOf(fetchPreviewModel({ ...OPTIONS, fetchImpl: declared }))).toBe('too_large');
    const actual = vi.fn(async () => fakeResponse(200, new ArrayBuffer(65)));
    expect(await codeOf(fetchPreviewModel({ ...OPTIONS, maxBytes: 64, fetchImpl: actual }))).toBe(
      'too_large',
    );
  });

  it('lets an abort propagate as an abort, not as a preview error', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('aborted', 'AbortError');
    const fetchImpl = vi.fn(async () => {
      throw abortError;
    });
    await expect(
      fetchPreviewModel({ ...OPTIONS, fetchImpl, signal: controller.signal }),
    ).rejects.toBe(abortError);
  });
});

describe('sniffFormat', () => {
  it('tells GLB from glTF JSON by content', () => {
    expect(sniffFormat(glbFile())).toBe('glb');
    expect(sniffFormat(gltfFile())).toBe('gltf');
    expect(sniffFormat(new TextEncoder().encode('PK\u0003\u0004zip').buffer as ArrayBuffer)).toBe(
      null,
    );
    expect(sniffFormat(new ArrayBuffer(0))).toBe(null);
  });
});

describe('parsePreviewModel', () => {
  it('parses a GLB into a scene with its mesh', async () => {
    const { scene, clipNames } = await parsePreviewModel(glbFile(), 'glb');
    let meshes = 0;
    scene.traverse((node) => {
      if (node instanceof Mesh) meshes += 1;
    });
    expect(meshes).toBe(1);
    expect(clipNames).toEqual([]);
  });

  it('parses a self-contained glTF and reports its animation clips', async () => {
    const { scene, clipNames } = await parsePreviewModel(
      gltfFile({ clips: ['Idle', 'Wave'] }),
      'gltf',
    );
    expect(scene.children.length).toBeGreaterThan(0);
    expect(clipNames).toEqual(['Idle', 'Wave']);
  });

  it('never fetches an external reference and refuses the model', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    try {
      const code = await codeOf(
        parsePreviewModel(gltfFile({ bufferUri: 'https://example.com/steal.bin' }), 'gltf'),
      );
      expect(code).toBe('invalid_model');
      for (const call of spy.mock.calls) expect(String(call[0])).not.toContain('example.com');
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses bytes that are not the recorded format, or not a model at all', async () => {
    expect(await codeOf(parsePreviewModel(glbFile(), 'gltf'))).toBe('invalid_model');
    expect(await codeOf(parsePreviewModel(gltfFile(), 'glb'))).toBe('invalid_model');
    const broken = new TextEncoder().encode('{"asset": {"version": "1.0"}}');
    const local = new Uint8Array(broken.length);
    local.set(broken);
    expect(await codeOf(parsePreviewModel(local.buffer, 'gltf'))).toBe('invalid_model');
  });
});
