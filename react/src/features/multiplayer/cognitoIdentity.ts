import { cognitoAuth, isCognitoConfigured } from '../../lib/cognito';
import type { MultiplayerIdentity } from './multiplayerClient';
import { MultiplayerJoinError } from './transport';

/**
 * The signed-in parent's Cognito access token and `sub`, for the room
 * server to verify. It is the access token, not the ID token, because the
 * room server forwards it to the Django API, which accepts access tokens
 * only, to check that the child is this parent's. The Cognito session
 * refreshes an expired token here, which is why the client asks for it on
 * every join rather than holding one.
 */
export async function getCognitoIdentity(): Promise<MultiplayerIdentity> {
  if (!isCognitoConfigured) throw new MultiplayerJoinError('UNAUTHORIZED');
  const tokens = await cognitoAuth().getTokens();
  const sub = tokens?.accessClaims.sub;
  if (!tokens?.accessToken || typeof sub !== 'string') {
    throw new MultiplayerJoinError('UNAUTHORIZED');
  }
  return { accessToken: tokens.accessToken, sub };
}
