import {
  getCurrentUser as amplifyGetCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';
import { describeAuthError } from '../errors';

/**
 * Recent sign-in verification on the client (LAI-0209, ADR-043;
 * docs/platform/RECENT_SIGN_IN.md).
 *
 * Django decides whether a sign-in is recent enough, from the Cognito access
 * token alone. This module only reacts to Django's answer,
 * `403 recent_auth_required`, by running a real Cognito sign-in for the same
 * account (Amplify `signIn`, SRP: the password goes to Cognito, never to
 * Django, and is never stored). A silent token refresh is never used for
 * this: Django would refuse it, because a refresh keeps the original
 * `auth_time`.
 *
 * Amplify refuses `signIn` while a session exists, so verification signs the
 * current session out first (which also revokes its refresh token) and then
 * signs in again. While that happens, `AuthContext` ignores the sign-out so
 * the page, and whatever the parent was doing on it, stays mounted.
 */

export const RECENT_AUTH_REQUIRED = 'recent_auth_required';
export const RECENT_AUTH_UNAVAILABLE = 'recent_auth_unavailable';

/** Whether an error (an `ApiError`, a wrapped one, or one carried in `cause`) is Django's answer. */
export function isRecentAuthRequired(error: unknown): boolean {
  return errorCodes(error).includes(RECENT_AUTH_REQUIRED);
}

function errorCodes(error: unknown, depth = 0): string[] {
  if (depth > 3 || typeof error !== 'object' || error === null) return [];
  const record = error as { code?: unknown; error?: unknown; cause?: unknown };
  const own = typeof record.code === 'string' ? [record.code] : [];
  return [...own, ...errorCodes(record.error, depth + 1), ...errorCodes(record.cause, depth + 1)];
}

// --- reauthentication in progress (read by AuthContext) ----------------------------------------

let reauthenticating = false;
const endListeners = new Set<() => void>();

export function isReauthenticating(): boolean {
  return reauthenticating;
}

/** Called when a verification ends, so `AuthContext` can read the session again. */
export function onReauthenticationEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

export function endReauthentication(): void {
  if (!reauthenticating) return;
  reauthenticating = false;
  for (const listener of [...endListeners]) listener();
}

// --- the verification itself ---------------------------------------------------------------------

/** Who is signed in when verification starts; the new sign-in must be the same account. */
export interface ReauthIdentity {
  userId: string;
  loginId: string;
}

export type ReauthOutcome =
  | { status: 'verified' }
  /** Wrong password, throttling, a network failure: the parent may try again. */
  | { status: 'failed'; message: string }
  /** Cognito wants another step (for example a new password). Sign in from the sign-in page. */
  | { status: 'incomplete' }
  /** Someone signed in as a different account. That session was signed out again. */
  | { status: 'wrong_account' };

export interface ReauthDeps {
  getCurrentUser: () => Promise<{
    userId: string;
    username: string;
    signInDetails?: { loginId?: string };
  }>;
  signIn: (input: { username: string; password: string }) => Promise<{
    isSignedIn: boolean;
    nextStep: { signInStep: string };
  }>;
  signOut: () => Promise<void>;
}

const amplifyDeps: ReauthDeps = {
  getCurrentUser: amplifyGetCurrentUser,
  signIn: amplifySignIn,
  signOut: () => amplifySignOut(),
};

/**
 * The account to verify, or null when nobody is signed in (the session has
 * expired: the parent must sign in from the sign-in page instead).
 */
export async function currentIdentity(
  deps: ReauthDeps = amplifyDeps,
): Promise<ReauthIdentity | null> {
  try {
    const user = await deps.getCurrentUser();
    return { userId: user.userId, loginId: user.signInDetails?.loginId ?? user.username };
  } catch {
    return null;
  }
}

/**
 * Signs in again as `identity` with `password`. The password is used once and
 * not kept. Call `endReauthentication` when the dialog closes, whatever the
 * outcome.
 */
export async function verifyRecentSignIn(
  identity: ReauthIdentity,
  password: string,
  deps: ReauthDeps = amplifyDeps,
): Promise<ReauthOutcome> {
  reauthenticating = true;
  try {
    if (await currentIdentity(deps)) await deps.signOut();
  } catch {
    // Already signed out (for example after a failed attempt): sign in below.
  }
  let result: Awaited<ReturnType<ReauthDeps['signIn']>>;
  try {
    result = await deps.signIn({ username: identity.loginId, password });
  } catch (error) {
    return { status: 'failed', message: describeAuthError(error) };
  }
  if (!result.isSignedIn || result.nextStep.signInStep !== 'DONE') {
    await signOutQuietly(deps);
    return { status: 'incomplete' };
  }
  const now = await currentIdentity(deps);
  if (!now || now.userId !== identity.userId) {
    await signOutQuietly(deps);
    return { status: 'wrong_account' };
  }
  return { status: 'verified' };
}

async function signOutQuietly(deps: ReauthDeps): Promise<void> {
  try {
    await deps.signOut();
  } catch {
    // Nothing more to do: the session is unusable either way.
  }
}
