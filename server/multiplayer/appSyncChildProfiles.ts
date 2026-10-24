import type { ChildProfileRecord } from './auth';

const QUERY = /* GraphQL */ `
  query MultiplayerChildProfile($id: ID!) {
    getChildProfile(id: $id) {
      id
      owner
      ownerSub
      avatarKey
    }
  }
`;

const LOOKUP_TIMEOUT_MS = 5000;

/**
 * Reads a child profile **as the calling parent**, by forwarding their own
 * ID token to AppSync. `ChildProfile`'s `allow.owner()` rule then does the
 * ownership check the app already relies on everywhere, and the room server
 * needs no AWS credentials or table access of its own.
 *
 * Only the four fields the server needs are requested; the nickname and
 * photo are never fetched.
 */
export function createAppSyncChildProfileLookup(
  appSyncUrl: string,
  fetchImpl: typeof fetch = fetch,
): (idToken: string, childProfileId: string) => Promise<ChildProfileRecord | null> {
  return async (idToken, childProfileId) => {
    const response = await fetchImpl(appSyncUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: idToken },
      body: JSON.stringify({ query: QUERY, variables: { id: childProfileId } }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`AppSync responded ${response.status}`);

    const body = (await response.json()) as {
      data?: { getChildProfile?: Record<string, unknown> | null };
      errors?: { errorType?: string }[];
    };
    if (body.errors?.some((error) => error.errorType === 'Unauthorized')) return null;
    if (body.errors?.length) throw new Error('AppSync returned errors');

    const row = body.data?.getChildProfile;
    if (!row || typeof row.id !== 'string') return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    return {
      id: row.id,
      owner: text(row.owner),
      ownerSub: text(row.ownerSub),
      avatarKey: text(row.avatarKey),
    };
  };
}
