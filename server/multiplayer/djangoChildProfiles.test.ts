// @vitest-environment node
import { createDjangoChildProfileLookup } from './djangoChildProfiles';

const BASE = 'https://api.example.org';
const CHILD = '3f2b7c1e-0000-4000-8000-000000000001';

function respond(status: number, body: unknown = {}) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

function lookupWith(fetchImpl: ReturnType<typeof respond>, base = BASE) {
  return createDjangoChildProfileLookup(base, fetchImpl as unknown as typeof fetch);
}

describe('createDjangoChildProfileLookup', () => {
  it("forwards the parent's own access token and keeps only the id and avatar", async () => {
    const fetchImpl = respond(200, {
      id: CHILD,
      nickname: 'Pip',
      ageBand: 'PATHFINDERS',
      avatarKey: 'FOX',
      hasPhoto: true,
    });
    await expect(lookupWith(fetchImpl)('access-token', CHILD)).resolves.toEqual({
      id: CHILD,
      avatarKey: 'FOX',
    });
    const [url, init = {}] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/children/${CHILD}/`);
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer access-token');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('tolerates a trailing slash on the API base', async () => {
    const fetchImpl = respond(200, { id: CHILD, avatarKey: 'OWL' });
    await lookupWith(fetchImpl, `${BASE}/`)('t', CHILD);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/api/v1/children/${CHILD}/`);
  });

  it('treats a missing or non-string avatar as none', async () => {
    const fetchImpl = respond(200, { id: CHILD, avatarKey: 7 });
    await expect(lookupWith(fetchImpl)('t', CHILD)).resolves.toEqual({
      id: CHILD,
      avatarKey: null,
    });
  });

  it.each([401, 403, 404])(
    'returns null when Django answers %i (not this parent’s child)',
    async (status) => {
      await expect(lookupWith(respond(status))('t', CHILD)).resolves.toBeNull();
    },
  );

  it.each([400, 429, 500, 503])(
    'throws on %i so the caller can refuse with LOOKUP_FAILED',
    async (status) => {
      await expect(lookupWith(respond(status))('t', CHILD)).rejects.toThrow();
    },
  );

  it('throws on a malformed body', async () => {
    await expect(lookupWith(respond(200, null))('t', CHILD)).rejects.toThrow();
    await expect(lookupWith(respond(200, { avatarKey: 'FOX' }))('t', CHILD)).rejects.toThrow();
  });

  it('throws when the request itself fails or times out', async () => {
    const failing = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(
      createDjangoChildProfileLookup(BASE, failing as unknown as typeof fetch)('t', CHILD),
    ).rejects.toThrow();
  });
});
