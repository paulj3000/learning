import { describe, expect, it, vi } from 'vitest';
import {
  CaptureError,
  MAX_CAPTURE_BYTES,
  assertSameOriginUrl,
  canvasToBlob,
  clampOutputSize,
  encodeCapture,
  type ToBlob,
} from './captureOutput';

const blob = (type: string, size = 100) => new Blob([new Uint8Array(size)], { type });

describe('clampOutputSize', () => {
  it('bounds sizes to 64..1024 and defaults the unusable', () => {
    expect(clampOutputSize(256)).toBe(256);
    expect(clampOutputSize('512')).toBe(512);
    expect(clampOutputSize(4096)).toBe(1024);
    expect(clampOutputSize(1)).toBe(64);
    expect(clampOutputSize(Number.NaN)).toBe(512);
    expect(clampOutputSize('abc')).toBe(512);
    expect(clampOutputSize(300.4)).toBe(300);
  });
});

describe('encodeCapture', () => {
  it('uses WebP by default', async () => {
    const toBlob = vi.fn<ToBlob>(async (type) => blob(type));
    const out = await encodeCapture(toBlob, { transparent: false });
    expect(out.type).toBe('image/webp');
    expect(toBlob).toHaveBeenCalledWith('image/webp', 0.85);
  });

  it('falls back to PNG when the browser returns another type', async () => {
    const toBlob = vi.fn<ToBlob>(async (type) =>
      type === 'image/webp' ? blob('image/png') : blob(type),
    );
    const out = await encodeCapture(toBlob, { transparent: false });
    expect(out.type).toBe('image/png');
  });

  it('falls back to PNG when toBlob gives nothing for WebP', async () => {
    const toBlob = vi.fn<ToBlob>(async (type) => (type === 'image/webp' ? null : blob(type)));
    expect((await encodeCapture(toBlob, { transparent: false })).type).toBe('image/png');
  });

  it('uses PNG for transparency and never asks for WebP', async () => {
    const toBlob = vi.fn<ToBlob>(async (type) => blob(type));
    const out = await encodeCapture(toBlob, { transparent: true });
    expect(out.type).toBe('image/png');
    expect(toBlob).not.toHaveBeenCalledWith('image/webp', expect.anything());
  });

  it('retries WebP once at lower quality when over the limit', async () => {
    const toBlob = vi.fn<ToBlob>(async (type, quality) =>
      blob(type, quality === 0.85 ? MAX_CAPTURE_BYTES + 1 : 1000),
    );
    const out = await encodeCapture(toBlob, { transparent: false });
    expect(out.blob.size).toBe(1000);
    expect(toBlob).toHaveBeenCalledTimes(2);
  });

  it('refuses a result still over the limit', async () => {
    const toBlob: ToBlob = async (type) => blob(type, MAX_CAPTURE_BYTES + 1);
    await expect(encodeCapture(toBlob, { transparent: true })).rejects.toMatchObject({
      code: 'too_large',
    });
    await expect(encodeCapture(toBlob, { transparent: false })).rejects.toBeInstanceOf(
      CaptureError,
    );
  });

  it('fails clearly when nothing can be encoded', async () => {
    await expect(encodeCapture(async () => null, { transparent: false })).rejects.toMatchObject({
      code: 'encode_failed',
    });
  });
});

describe('canvasToBlob', () => {
  it('wraps the canvas callback API', async () => {
    const canvas = document.createElement('canvas');
    const expected = blob('image/webp');
    canvas.toBlob = vi.fn((cb: BlobCallback) => cb(expected));
    expect(await canvasToBlob(canvas)('image/webp', 0.5)).toBe(expected);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.5);
  });
});

describe('assertSameOriginUrl', () => {
  const origin = 'https://admin.example.test';
  it('accepts a path and a same origin URL', () => {
    expect(
      assertSameOriginUrl('/admin/assets/assetversion/1/preview/model/', origin).pathname,
    ).toBe('/admin/assets/assetversion/1/preview/model/');
    expect(assertSameOriginUrl(`${origin}/x`, origin).origin).toBe(origin);
  });
  it.each([
    'https://evil.example.test/model.glb',
    'http://admin.example.test/x',
    '//evil.example.test/x',
    'data:model/gltf-binary;base64,AAAA',
    'blob:https://admin.example.test/abc',
    'javascript:alert(1)',
    'https://user:pw@admin.example.test/x',
  ])('refuses %s', (url) => {
    expect(() => assertSameOriginUrl(url, origin)).toThrow(CaptureError);
  });
});
