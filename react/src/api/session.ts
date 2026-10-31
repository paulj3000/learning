import { API_PREFIX } from './client';

/**
 * The local Django session's CSRF token (LAI-AUTH-DUAL, ADR-038). Django
 * mode only.
 *
 * The session and CSRF cookies are HttpOnly, so script never reads them: the
 * token comes from `GET /api/v1/auth/csrf/` and is kept in memory only. Django
 * rotates it on sign-in, so `reset()` is called after sign-in and sign-out,
 * and the client asks for a fresh one once after a `403 csrf_failed`.
 */
export interface SessionAuth {
  csrfToken(options?: { forceRefresh?: boolean }): Promise<string>;
  reset(): void;
}

export const CSRF_PATH = 'auth/csrf/';

export function createSessionAuth(options: { baseUrl: string; fetch?: typeof fetch }): SessionAuth {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  let pending: Promise<string> | null = null;

  async function load(): Promise<string> {
    const response = await doFetch(`${options.baseUrl}${API_PREFIX}${CSRF_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`CSRF token request failed (${response.status})`);
    const body: unknown = await response.json();
    const token =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).csrfToken
        : undefined;
    if (typeof token !== 'string' || token === '') throw new Error('CSRF token missing');
    return token;
  }

  return {
    csrfToken({ forceRefresh = false } = {}) {
      if (forceRefresh || pending === null) {
        pending = load().catch((error: unknown) => {
          pending = null;
          throw error;
        });
      }
      return pending;
    },
    reset() {
      pending = null;
    },
  };
}
