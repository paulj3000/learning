import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { cognitoAuth, isCognitoConfigured } from '../../lib/cognito';
import { isReauthenticating, onReauthenticationEnd } from './recentSignIn/recentSignIn';

export type AuthStatus = 'unconfigured' | 'loading' | 'authenticated' | 'unauthenticated';

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
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  async function refresh(options: { quiet?: boolean } = {}): Promise<void> {
    if (!isCognitoConfigured) {
      setStatus('unconfigured');
      return;
    }
    // Quiet keeps the current screen mounted while the session is re-read.
    if (!options.quiet) setStatus('loading');
    try {
      const auth = cognitoAuth();
      const user = await auth.getCurrentUser();
      setUserId(user.userId);
      const tokens = await auth.getTokens();
      const groups = tokens?.idClaims?.['cognito:groups'];
      const access = adminAccessFromGroups(groups);
      setIsAdmin(access.isAdmin);
      setIsSuperuser(access.isSuperuser);
      setStatus('authenticated');
    } catch {
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
