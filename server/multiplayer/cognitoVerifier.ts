import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { VerifiedIdentity } from './auth';

/**
 * Verifies a Cognito **access** token issued to this app's user pool client:
 * signature against the pool's published keys (fetched once and cached),
 * issuer, `client_id`, `token_use: access` and expiry. It is the token the
 * Django API accepts, so the server can forward it unchanged for the child
 * ownership lookup.
 */
export function createCognitoAccessTokenVerifier(
  userPoolId: string,
  userPoolClientId: string,
): (token: string) => Promise<VerifiedIdentity> {
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId: userPoolClientId,
    tokenUse: 'access',
  });
  return async (token) => {
    const payload = await verifier.verify(token);
    return { sub: payload.sub, expiresAt: payload.exp * 1000 };
  };
}
