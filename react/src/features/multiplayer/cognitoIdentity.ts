import { cognitoAuth, isCognitoConfigured } from '../../lib/cognito';
import type { MultiplayerIdentity } from './multiplayerClient';
import { MultiplayerJoinError } from './transport';

/**
 * The signed-in parent's ID token and `sub`, for the room server to verify.
 * The Cognito session refreshes an expired token here, which is why the
 * client asks for it on every join rather than holding one.
 */
export async function getCognitoIdentity(): Promise<MultiplayerIdentity> {
  if (!isCognitoConfigured) throw new MultiplayerJoinError('UNAUTHORIZED');
  const tokens = await cognitoAuth().getTokens();
  const sub = tokens?.idClaims?.sub;
  if (!tokens?.idToken || typeof sub !== 'string') throw new MultiplayerJoinError('UNAUTHORIZED');
  return { idToken: tokens.idToken, sub };
}
