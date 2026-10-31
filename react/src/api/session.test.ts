import { createSessionAuth } from './session';
import { jsonResponse } from '../test/playFixtures';

function setup(...responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return { session: createSessionAuth({ baseUrl: '', fetch }), fetch };
}

describe('createSessionAuth', () => {
  it('fetches the CSRF token once, same-origin, and keeps it in memory', async () => {
    const { session, fetch } = setup(jsonResponse(200, { csrfToken: 'tok-1' }));
    await expect(session.csrfToken()).resolves.toBe('tok-1');
    await expect(session.csrfToken()).resolves.toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/auth/csrf/');
    expect(init?.credentials).toBe('same-origin');
  });

  it('fetches a new token after reset or when forced', async () => {
    const { session } = setup(
      jsonResponse(200, { csrfToken: 'tok-1' }),
      jsonResponse(200, { csrfToken: 'tok-2' }),
      jsonResponse(200, { csrfToken: 'tok-3' }),
    );
    await session.csrfToken();
    session.reset();
    await expect(session.csrfToken()).resolves.toBe('tok-2');
    await expect(session.csrfToken({ forceRefresh: true })).resolves.toBe('tok-3');
  });

  it('does not remember a failure', async () => {
    const { session } = setup(jsonResponse(404, {}), jsonResponse(200, { csrfToken: 'tok-1' }));
    await expect(session.csrfToken()).rejects.toThrow();
    await expect(session.csrfToken()).resolves.toBe('tok-1');
  });

  it('rejects a response without a token', async () => {
    const { session } = setup(jsonResponse(200, { csrfToken: '' }));
    await expect(session.csrfToken()).rejects.toThrow(/missing/);
  });
});
