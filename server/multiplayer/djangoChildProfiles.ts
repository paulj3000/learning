import type { ChildProfileRecord } from './auth';

const LOOKUP_TIMEOUT_MS = 5000;

/** Django's answers that mean "not this parent's child" rather than "the lookup broke". */
const NOT_YOURS = new Set([401, 403, 404]);

/**
 * Reads a child profile **as the calling parent**, by forwarding their own
 * Cognito access token to the Django API (`GET /api/v1/children/<id>/`).
 * Django resolves the child through the token's parent and answers 404 for
 * another family's child or an unknown id (child scoping, LAI-0403), 401 for
 * a token it rejects and 403 for an account it has not provisioned. The room
 * server needs no database access or credentials of its own.
 *
 * Only `id` and `avatarKey` leave this function. The response also carries
 * the nickname and other profile fields; they are dropped here, never
 * stored or logged.
 *
 * Resolves null for 401, 403 and 404 (the caller refuses with
 * NOT_YOUR_CHILD). Throws on anything else, a timeout included, so the
 * caller refuses with LOOKUP_FAILED.
 */
export function createDjangoChildProfileLookup(
  apiBase: string,
  fetchImpl: typeof fetch = fetch,
): (accessToken: string, childProfileId: string) => Promise<ChildProfileRecord | null> {
  const base = apiBase.replace(/\/+$/, '');
  return async (accessToken, childProfileId) => {
    const url = `${base}/api/v1/children/${encodeURIComponent(childProfileId)}/`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      // A redirect would carry the token to wherever it points; refuse instead.
      redirect: 'error',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (NOT_YOURS.has(response.status)) return null;
    if (!response.ok) throw new Error(`Django responded ${response.status}`);

    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) throw new Error('Django returned no object');
    const row = body as Record<string, unknown>;
    if (typeof row.id !== 'string') throw new Error('Django returned no child id');
    return {
      id: row.id,
      avatarKey: typeof row.avatarKey === 'string' ? row.avatarKey : null,
    };
  };
}
