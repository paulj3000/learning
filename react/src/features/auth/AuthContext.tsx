import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getCurrentAuthSession,
  isAuthConfigured,
  onAuthChange,
  signOut as authSignOut,
} from '../../api/auth';

export type AuthStatus = 'unconfigured' | 'loading' | 'authenticated' | 'unauthenticated';

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
  const [status, setStatus] = useState<AuthStatus>(
    isAuthConfigured ? 'loading' : 'unconfigured',
  );
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperuser, setIsSuperuser] = useState(false);

  async function refresh(): Promise<void> {
    if (!isAuthConfigured) {
      setStatus('unconfigured');
      return;
    }
    setStatus('loading');
    const session = await getCurrentAuthSession();
    if (session) {
      setUserId(session.userId);
      const access = adminAccessFromGroups(session.groups);
      setIsAdmin(access.isAdmin);
      setIsSuperuser(access.isSuperuser);
      setStatus('authenticated');
    } else {
      setUserId(null);
      setIsAdmin(false);
      setIsSuperuser(false);
      setStatus('unauthenticated');
    }
  }

  useEffect(() => {
    void refresh();
    return onAuthChange(() => void refresh());
  }, []);

  async function signOut(): Promise<void> {
    await authSignOut();
    await refresh();
  }

  return (
    <AuthContext.Provider value={{ status, userId, isAdmin, isSuperuser, refresh, signOut }}>
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
