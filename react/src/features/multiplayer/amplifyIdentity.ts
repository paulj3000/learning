import { getIdTokenIdentity } from '../../api/auth';
import type { MultiplayerIdentity } from './multiplayerClient';
import { MultiplayerJoinError } from './transport';

/**
 * The signed-in parent's ID token and `sub`, for the room server to verify.
 * Amplify refreshes an expired token here, which is why the client asks for
 * it on every join rather than holding one. Cognito is the identity
 * provider whichever data backend the build uses (ADR-024, ADR-036), so
 * this does not change with `VITE_BACKEND`.
 */
export async function getAmplifyIdentity(): Promise<MultiplayerIdentity> {
  const identity = await getIdTokenIdentity();
  if (!identity) throw new MultiplayerJoinError('UNAUTHORIZED');
  return identity;
}
