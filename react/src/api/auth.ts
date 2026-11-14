import { fetchAuthSession } from 'aws-amplify/auth';
import { withTimeout } from '../lib/withTimeout';

/** Reading (and, if needed, refreshing) the token is bounded like every request. */
export const TOKEN_TIMEOUT_MS = 15_000;

/**
 * The signed-in parent's Cognito **access** token, which is what Django
 * verifies (ADR-024; the multiplayer room server takes the ID token instead).
 *
 * Asked for on every request rather than held: Amplify refreshes an expired
 * token here, and ADR-024 gate A1 says not to copy tokens into app state or
 * any storage of our own. `forceRefresh` is used once after a 401.
 * Returns null when nobody is signed in.
 */
export async function getAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const session = await withTimeout(
    fetchAuthSession({ forceRefresh: options.forceRefresh ?? false }),
    TOKEN_TIMEOUT_MS,
    'Reading the Cognito access token',
  );
  return session.tokens?.accessToken?.toString() ?? null;
}
