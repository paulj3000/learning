import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { isAmplifyConfigured } from '../../lib/amplify-config';

export type AuthStatus = 'unconfigured' | 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isAmplifyConfigured ? 'loading' : 'unconfigured',
  );
  const [userId, setUserId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!isAmplifyConfigured) {
      setStatus('unconfigured');
      return;
    }
    setStatus('loading');
    try {
      const user = await getCurrentUser();
      setUserId(user.userId);
      setStatus('authenticated');
    } catch {
      setUserId(null);
      setStatus('unauthenticated');
    }
  }

  useEffect(() => {
    void refresh();
    if (!isAmplifyConfigured) return;
    const stopListening = Hub.listen('auth', ({ payload }) => {
      if (payload.event === 'signedIn' || payload.event === 'signedOut') {
        void refresh();
      }
    });
    return stopListening;
  }, []);

  async function signOut(): Promise<void> {
    await amplifySignOut();
    await refresh();
  }

  return (
    <AuthContext.Provider value={{ status, userId, refresh, signOut }}>
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
