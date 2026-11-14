import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cognitoAuth, isCognitoConfigured } from '../../lib/cognito';
import { TimeoutError, withTimeout } from '../../lib/withTimeout';
import { AUTH_CHECK_TIMEOUT_MS } from './authNoticeCopy';
import { isReauthenticating, onReauthenticationEnd } from './recentSignIn/recentSignIn';

/**
 * - `unconfigured`: this build has no Cognito pool and client (`VITE_COGNITO_*`).
 * - `unavailable`: Cognito did not answer in time; the parent can try again. Never treated
 *   as signed out, so a slow network does not bounce a parent to the sign-in page.
 */
export type AuthStatus =
  | 'unconfigured'
  | 'loading'
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /**
   * Whether the signed-in user belongs to the Cognito `Admins` group
   * (created with the user pool; granted out of band, `scripts/grant-admin.ts`). Read from the ID token's `cognito:groups`
   * claim rather than a separate call, since the session is already read
   * once per sign-in to get a fresh token. Always `false` while
   * unauthenticated/unconfigured — `RequireAdmin` (src/features/auth/RequireAdmin.tsx)
   * is what actually gates the admin section, this is just the signal it reads.
   */
  isAdmin: boolean;
  /**
   * Whether the signed-in admin is also in `Superusers` (ADR-031), which is
   * what unlocks destructive admin actions such as deleting an adventure.
   * Only ever `true` alongside `isAdmin`; the backend enforces the same rule
   * on its own (Django checks the same group claim).
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
  const [status, setStatus] = useState<AuthStatus>(
    isCognitoConfigured ? 'loading' : 'unconfigured',
  );
  // Only the newest session read may set state, so a late answer cannot overwrite a newer one.
  const generation = useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  async function refresh(options: { quiet?: boolean } = {}): Promise<void> {
    if (!isCognitoConfigured) {
      setStatus('unconfigured');
      return;
    }
    const current = ++generation.current;
    // Quiet keeps the current screen mounted while the session is re-read.
    if (!options.quiet) setStatus('loading');
    try {
      const auth = cognitoAuth();
      // Bounded: reading the session can refresh tokens over the network.
      const { user, tokens } = await withTimeout(
        (async () => {
          const signedIn = await auth.getCurrentUser();
          return { user: signedIn, tokens: await auth.getTokens() };
        })(),
        AUTH_CHECK_TIMEOUT_MS,
        'Reading the Cognito session',
      );
      if (current !== generation.current) return;
      setUserId(user.userId);
      const groups = tokens?.idClaims?.['cognito:groups'];
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
    if (!isCognitoConfigured) return;
    const stopListening = cognitoAuth().onEvent((event) => {
      // A recent sign-in verification (LAI-0209) signs out and in again on
      // purpose; the page stays as it is and the session is read once it ends.
      if (isReauthenticating()) return;
      if (event === 'signedIn' || event === 'signedOut') {
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
    if (isCognitoConfigured) await cognitoAuth().signOut();
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
