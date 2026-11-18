import { describe, expect, it, vi } from 'vitest';
import { uploadCapture } from './uploadCapture';

const base = {
  url: '/admin/assets/assetversion/7/capture/upload/',
  csrfToken: 'tok',
  versionId: '7',
  sourceSha256: 'a'.repeat(64),
  blob: new Blob([new Uint8Array(4)], { type: 'image/webp' }),
  type: 'image/webp' as const,
};

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('uploadCapture', () => {
  it('posts the version id, checksum and image with the CSRF header', async () => {
    const fetchImpl = reply(201, { artifact_id: 'abc' });
    const result = await uploadCapture({ ...base, fetchImpl });
    expect(result).toMatchObject({ ok: true, artifactId: 'abc' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-CSRFToken']).toBe('tok');
    const form = init.body as FormData;
    expect(form.get('version_id')).toBe('7');
    expect(form.get('source_sha256')).toBe('a'.repeat(64));
    expect((form.get('image') as File).name).toBe('capture.webp');
  });

  it('shows the server message on refusal and a safe one otherwise', async () => {
    const refused = reply(409, { error: { code: 'stale_version', message: 'The model changed.' } });
    expect(await uploadCapture({ ...base, fetchImpl: refused })).toEqual({
      ok: false,
      message: 'The model changed.',
    });
    const html = vi.fn(async () => new Response('<html>', { status: 403 }));
    expect((await uploadCapture({ ...base, fetchImpl: html })).message).toMatch(/Reload the page/);
  });

  it('reports a network failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('x');
    });
    expect((await uploadCapture({ ...base, fetchImpl })).ok).toBe(false);
  });
});
