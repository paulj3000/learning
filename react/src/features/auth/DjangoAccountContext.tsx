import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAccessToken } from '../../api/auth';
import { createApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { provisionDjangoAccount } from '../../api/djangoAdmin';
import { useAuth } from './AuthContext';

/**
 * The signed-in parent's Django account (LAI-0404, ADR-034).
 *
 * In a build with the Django API on, every sign-in sends one
 * `POST /api/v1/me/`, which creates the parent's Django account the first
 * time (Cognito sign-up itself never reaches Django) and reports whether it
 * is Django Admin staff. Builds without the Django API never call it.
 */
interface DjangoAccountValue {
  /** The Django account id once provisioned for the current sign-in, else null. */
  accountId: string | null;
  /** Active Django Admin staff, per Django. Only ever true with an `accountId`. */
  djangoAdmin: boolean;
}

const SIGNED_OUT: DjangoAccountValue = { accountId: null, djangoAdmin: false };
const DjangoAccountContext = createContext<DjangoAccountValue>(SIGNED_OUT);

export function DjangoAccountProvider({
  children,
  config = DJANGO_API_CONFIG,
}: {
  children: ReactNode;
  config?: DjangoApiConfig;
}) {
  const { status, userId } = useAuth();
  const [result, setResult] = useState<(DjangoAccountValue & { userId: string }) | null>(null);
  const ready = config.enabled && status === 'authenticated' && !!userId;
  const baseUrl = config.enabled ? config.baseUrl : '';

  useEffect(() => {
    if (!ready || !userId) return;
    const controller = new AbortController();
    const client = createApiClient({ baseUrl, getAccessToken });
    void provisionDjangoAccount(client, controller.signal).then((account) => {
      if (controller.signal.aborted) return;
      setResult(
        account ? { userId, accountId: account.id, djangoAdmin: account.djangoAdmin } : null,
      );
    });
    return () => controller.abort();
  }, [ready, baseUrl, userId]);

  const value = ready && result && result.userId === userId ? result : SIGNED_OUT;
  return (
    <DjangoAccountContext.Provider
      value={{ accountId: value.accountId, djangoAdmin: value.djangoAdmin }}
    >
      {children}
    </DjangoAccountContext.Provider>
  );
}

/** Outside a provider (and in Amplify-only builds) this is always the signed-out value. */
export function useDjangoAccount(): DjangoAccountValue {
  return useContext(DjangoAccountContext);
}
