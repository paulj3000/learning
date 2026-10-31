import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { SESSION_AUTH } from '../../api/apiAuth';
import type { AuthMode } from '../../api/authMode';
import { ACCOUNT_PATH, createApiClient, type ApiClient } from '../../api/client';
import { AUTH_MODE, DJANGO_API_CONFIG } from '../../api/config';
import { isApiError } from '../../api/errors';
import type { SessionAuth } from '../../api/session';
import { isAmplifyConfigured } from '../../lib/amplify-config';

/**
 * Where the signed-in parent comes from (LAI-AUTH-DUAL, ADR-038). `AuthProvider`
 * (AuthContext.tsx) holds the state; an adapter only answers "who is signed
 * in" and signs out. Permissions are never decided here: Django checks every
 * request, whichever adapter signed the parent in.
 *
 * - Cognito: Amplify Auth. Sign-in, sign-up, confirmation and recovery stay
 *   the existing Amplify forms; Amplify's Hub reports the change.
 * - Django (local development only): `login` posts the username and password
 *   to `POST /api/v1/auth/login/`, and `GET /api/v1/me/` says who is signed in.
 */
export interface AuthUser {
  userId: string;
  /** Cognito `Admins` group (the Amplify admin section). Always false in Django mode. */
  isAdmin: boolean;
  /** Cognito `Superusers` group, only ever with `isAdmin`. Always false in Django mode. */
  isSuperuser: boolean;
}

export interface AuthAdapter {
  readonly mode: AuthMode;
  /** False when this build cannot sign anyone in (Cognito mode without Amplify outputs). */
  readonly configured: boolean;
  getCurrentUser(): Promise<AuthUser | null>;
  logout(): Promise<void>;
  /** Calls `onChange` when sign-in state changes; returns the unsubscribe function. */
  listen(onChange: () => void): () => void;
  /** Django mode only: throws `LocalSignInError` when the credentials are refused. */
  login?: (username: string, password: string) => Promise<void>;
}

/**
 * Admin flags from an ID token's `cognito:groups` claim. A `Superusers`
 * member who is not also in `Admins` gets neither flag: every admin page and
 * read is `Admins`-gated, so that account could not use the admin section.
 */
export function adminAccessFromGroups(groups: unknown): { isAdmin: boolean; isSuperuser: boolean } {
  const list = Array.isArray(groups) ? groups : [];
  const isAdmin = list.includes('Admins');
  return { isAdmin, isSuperuser: isAdmin && list.includes('Superusers') };
}

export function createCognitoAuthAdapter(configured = isAmplifyConfigured): AuthAdapter {
  return {
    mode: 'cognito',
    configured,
    async getCurrentUser() {
      if (!configured) return null;
      try {
        const user = await getCurrentUser();
        const session = await fetchAuthSession();
        const groups = session.tokens?.idToken?.payload['cognito:groups'];
        return { userId: user.userId, ...adminAccessFromGroups(groups) };
      } catch {
        return null;
      }
    },
    async logout() {
      await amplifySignOut();
    },
    listen(onChange) {
      if (!configured) return () => undefined;
      return Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedIn' || payload.event === 'signedOut') onChange();
      });
    },
  };
}

/** Why a local sign-in failed: wrong credentials, or Django could not be reached. */
export class LocalSignInError extends Error {
  readonly reason: 'invalid_credentials' | 'unavailable';

  constructor(reason: 'invalid_credentials' | 'unavailable') {
    super(`Local sign-in failed: ${reason}`);
    this.name = 'LocalSignInError';
    this.reason = reason;
  }
}

export function createDjangoAuthAdapter(
  options: {
    client?: ApiClient;
    session?: SessionAuth;
  } = {},
): AuthAdapter {
  const session = options.session ?? SESSION_AUTH;
  const client =
    options.client ??
    createApiClient({
      baseUrl: DJANGO_API_CONFIG.enabled ? DJANGO_API_CONFIG.baseUrl : '',
      session,
    });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    mode: 'django',
    configured: true,
    async getCurrentUser() {
      try {
        const { data } = await client.request('GET', ACCOUNT_PATH);
        const id = typeof data === 'object' && data !== null ? (data as { id?: unknown }).id : null;
        return typeof id === 'string' && id !== ''
          ? { userId: id, isAdmin: false, isSuperuser: false }
          : null;
      } catch {
        return null; // signed out, or Django unreachable: either way, nobody to show
      }
    },
    async login(username, password) {
      session.reset();
      try {
        await client.request('POST', 'auth/login/', { body: { username, password } });
      } catch (error) {
        const refused =
          isApiError(error) &&
          (error.code === 'invalid_credentials' || error.kind === 'invalid_request');
        throw new LocalSignInError(refused ? 'invalid_credentials' : 'unavailable');
      } finally {
        session.reset(); // Django rotates the CSRF token on sign-in
      }
      notify();
    },
    async logout() {
      try {
        await client.request('POST', 'auth/logout/');
      } finally {
        session.reset();
        notify();
      }
    },
    listen(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

export function authAdapterFor(mode: AuthMode = AUTH_MODE): AuthAdapter {
  return mode === 'django' ? createDjangoAuthAdapter() : createCognitoAuthAdapter();
}
