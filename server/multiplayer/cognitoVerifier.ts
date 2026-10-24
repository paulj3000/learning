import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { VerifiedIdentity } from './auth';

/**
 * Verifies a Cognito **ID** token for this app's user pool client: signature
 * against the pool's published keys (fetched once and cached), issuer,
 * audience, `token_use` and expiry.
 */
export function createCognitoIdTokenVerifier(
  userPoolId: string,
  userPoolClientId: string,
): (token: string) => Promise<VerifiedIdentity> {
  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    clientId: userPoolClientId,
    tokenUse: 'id',
  });
  return async (token) => {
    const payload = await verifier.verify(token);
    return { sub: payload.sub, expiresAt: payload.exp * 1000 };
  };
}
