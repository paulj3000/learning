import { fetchAuthSession } from 'aws-amplify/auth';
import type { MultiplayerIdentity } from './multiplayerClient';
import { MultiplayerJoinError } from './transport';

/**
 * The signed-in parent's ID token and `sub`, for the room server to verify.
 * Amplify refreshes an expired token here, which is why the client asks for
 * it on every join rather than holding one.
 */
export async function getAmplifyIdentity(): Promise<MultiplayerIdentity> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken;
  const sub = idToken?.payload.sub;
  if (!idToken || typeof sub !== 'string') throw new MultiplayerJoinError('UNAUTHORIZED');
  return { idToken: idToken.toString(), sub };
}
