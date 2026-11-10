import { cognitoAuth, isCognitoConfigured } from '../lib/cognito';

/**
 * The signed-in parent's Cognito **access** token, which is what Django
 * verifies (ADR-024; the multiplayer room server takes the ID token instead).
 *
 * Asked for on every request rather than held: the Cognito session
 * (`lib/cognito`, AMP-02) refreshes an expired token here, and ADR-024 gate
 * A1 says not to copy tokens into app state or any storage of our own.
 * `forceRefresh` is used once after a 401. Returns null when nobody is
 * signed in or the build has no Cognito configuration.
 */
export async function getAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  if (!isCognitoConfigured) return null;
  const tokens = await cognitoAuth().getTokens({ forceRefresh: options.forceRefresh ?? false });
  return tokens?.accessToken ?? null;
}
