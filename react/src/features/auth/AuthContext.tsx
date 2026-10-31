import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthMode } from '../../api/authMode';
import { authAdapterFor, type AuthAdapter } from './authAdapters';

export { adminAccessFromGroups } from './authAdapters';

export type AuthStatus = 'unconfigured' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /**
   * Whether the signed-in user belongs to the Cognito `Admins` group
   * (amplify/auth/resource.ts). Read from the ID token's `cognito:groups`
   * claim rather than a separate call, since `fetchAuthSession` already
   * has to run once per sign-in to get a fresh token. Always `false` while
   * unauthenticated/unconfigured, and in Django sign-in mode — `RequireAdmin`
   * (src/features/auth/RequireAdmin.tsx) is what actually gates the admin
   * section, this is just the signal it reads.
   */
  isAdmin: boolean;
  /**
   * Whether the signed-in admin is also in `Superusers` (ADR-031), which is
   * what unlocks destructive admin actions such as deleting an adventure.
   * Only ever `true` alongside `isAdmin`; the backend enforces the same rule
   * on its own (`allow.group('Superusers')` in amplify/data/resource.ts).
   */
  isSuperuser: boolean;
  /** Which sign-in this build uses (ADR-038). Absent means `cognito`. */
  mode?: AuthMode;
  /**
   * Django sign-in mode only: signs in with a local username and password.
   * Throws `LocalSignInError` when refused. Absent in Cognito mode, where the
   * Amplify forms sign in.
   */
  signInLocally?: (username: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEFAULT_ADAPTER = authAdapterFor();

/**
 * The signed-in parent, from whichever adapter this build uses (Cognito or,
 * for local development, Django; see authAdapters.ts). Route guards read
 * `status`; nothing here grants a permission.
 */
export function AuthProvider({
  children,
  adapter = DEFAULT_ADAPTER,
}: {
  children: ReactNode;
  adapter?: AuthAdapter;
}) {
  const [status, setStatus] = useState<AuthStatus>(adapter.configured ? 'loading' : 'unconfigured');
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  async function refresh(): Promise<void> {
    if (!adapter.configured) {
      setStatus('unconfigured');
      return;
    }
    setStatus('loading');
    const user = await adapter.getCurrentUser();
    setUserId(user?.userId ?? null);
    setIsAdmin(user?.isAdmin ?? false);
    setIsSuperuser(user?.isSuperuser ?? false);
    setStatus(user ? 'authenticated' : 'unauthenticated');
  }

  useEffect(() => {
    void refresh();
    return adapter.listen(() => void refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per adapter
  }, [adapter]);

  async function signOut(): Promise<void> {
    await adapter.logout();
    await refresh();
  }

  const login = adapter.login;
  const signInLocally = login
    ? async (username: string, password: string) => {
        await login(username, password);
        await refresh();
      }
    : undefined;

  return (
    <AuthContext.Provider
      value={{
        status,
        userId,
        isAdmin,
        isSuperuser,
        mode: adapter.mode,
        signInLocally,
        refresh,
        signOut,
      }}
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
