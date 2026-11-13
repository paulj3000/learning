import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { isAuthConfigured } from '../../lib/amplify-config';
import { TimeoutError, withTimeout } from '../../lib/withTimeout';
import { AUTH_CHECK_TIMEOUT_MS } from './authNoticeCopy';
import { isReauthenticating, onReauthenticationEnd } from './recentSignIn/recentSignIn';

/**
 * - `unconfigured`: this build has no Cognito pool and client (`VITE_COGNITO_*`).
 * - `unavailable`: Cognito did not answer in time; the parent can try again. Never treated
 *   as signed out, so a slow network does not bounce a parent to the sign-in page.
 */
export type AuthStatus =
  'unconfigured' | 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /**
   * Whether the signed-in user belongs to the Cognito `Admins` group
   * (amplify/auth/resource.ts). Read from the ID token's `cognito:groups`
   * claim rather than a separate call, since `fetchAuthSession` already
   * has to run once per sign-in to get a fresh token. Always `false` while
   * unauthenticated/unconfigured — `RequireAdmin` (src/features/auth/RequireAdmin.tsx)
   * is what actually gates the admin section, this is just the signal it reads.
   */
  isAdmin: boolean;
  /**
   * Whether the signed-in admin is also in `Superusers` (ADR-031), which is
   * what unlocks destructive admin actions such as deleting an adventure.
   * Only ever `true` alongside `isAdmin`; the backend enforces the same rule
   * on its own (`allow.group('Superusers')` in amplify/data/resource.ts).
   */
  isSuperuser: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isAuthConfigured ? 'loading' : 'unconfigured');
  // Only the newest session read may set state, so a late answer cannot overwrite a newer one.
  const generation = useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  async function refresh(options: { quiet?: boolean } = {}): Promise<void> {
    if (!isAuthConfigured) {
      setStatus('unconfigured');
      return;
    }
    const current = ++generation.current;
    // Quiet keeps the current screen mounted while the session is re-read.
    if (!options.quiet) setStatus('loading');
    try {
      const { user, session } = await withTimeout(
        (async () => {
          const signedIn = await getCurrentUser();
          return { user: signedIn, session: await fetchAuthSession() };
        })(),
        AUTH_CHECK_TIMEOUT_MS,
        'Reading the Cognito session',
      );
      if (current !== generation.current) return;
      setUserId(user.userId);
      const groups = session.tokens?.idToken?.payload['cognito:groups'];
      const access = adminAccessFromGroups(groups);
      setIsAdmin(access.isAdmin);
      setIsSuperuser(access.isSuperuser);
      setStatus('authenticated');
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof TimeoutError) {
        setStatus('unavailable');
        return;
      }
      setUserId(null);
      setIsAdmin(false);
      setIsSuperuser(false);
      setStatus('unauthenticated');
    }
  }

  useEffect(() => {
    void refresh();
    if (!isAuthConfigured) return;
    const stopListening = Hub.listen('auth', ({ payload }) => {
      // A recent sign-in verification (LAI-0209) signs out and in again on
      // purpose; the page stays as it is and the session is read once it ends.
      if (isReauthenticating()) return;
      if (payload.event === 'signedIn' || payload.event === 'signedOut') {
        void refresh();
      }
    });
    const stopReauth = onReauthenticationEnd(() => void refresh({ quiet: true }));
    return () => {
      stopListening();
      stopReauth();
    };
  }, []);

  async function signOut(): Promise<void> {
    await amplifySignOut();
    await refresh();
  }

  return (
    <AuthContext.Provider
      value={{ status, userId, isAdmin, isSuperuser, refresh: () => refresh(), signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
