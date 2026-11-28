import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { registerChildPrincipalHandlers, setChildPrincipal } from '../../api/childPrincipal';
import { useAuth } from '../auth/AuthContext';
import {
  childSessionApi,
  type ChildSession,
  type ChildSessionApi,
  type ChildSessionChild,
} from './childSessionApi';

/**
 * The child who signed in on their own, as the server verified it (LAI-AUTH child sign-in, ADR-075).
 *
 * Identity here is only ever what the server answered (`GET /child-auth/session/` or a
 * sign-in/restore body). Nothing is read from the URL, local storage or a form, and a child
 * session never makes `useAuth()` authenticated: parent privileges come only from the parent's
 * own Cognito sign-in. When a parent is signed in, any child session is set aside (the parent
 * wins), so the two principals never mix in one request.
 */
export type ChildSessionStatus = 'loading' | 'signedIn' | 'signedOut';

interface ChildSessionValue {
  status: ChildSessionStatus;
  child: ChildSessionChild | null;
  csrfToken: string | null;
  /** Called by the sign-in form once the server created the session. */
  adopt: (session: ChildSession) => void;
  /** Ends the session on the server (and forgets this device), then clears it here. */
  signOut: () => Promise<void>;
}

const SIGNED_OUT: ChildSessionValue = {
  status: 'signedOut',
  child: null,
  csrfToken: null,
  adopt: () => undefined,
  signOut: async () => undefined,
};

const ChildSessionContext = createContext<ChildSessionValue>(SIGNED_OUT);

export function ChildSessionProvider({
  children,
  api,
}: {
  children: ReactNode;
  /** Injected in tests. */
  api?: ChildSessionApi;
}) {
  const { status: parentStatus } = useAuth();
  const client = api ?? childSessionApi();
  const [state, setState] = useState<{ status: ChildSessionStatus; session: ChildSession | null }>({
    status: 'loading',
    session: null,
  });
  const sessionRef = useRef<ChildSession | null>(null);
  const restoring = useRef<Promise<string | null> | null>(null);
  const bootstrapped = useRef(false);

  const apply = useCallback((session: ChildSession | null) => {
    sessionRef.current = session;
    setChildPrincipal(session?.csrfToken ?? null);
    setState({ status: session ? 'signedIn' : 'signedOut', session });
  }, []);

  /** One restore at a time; resolves the new CSRF token or null. */
  const restore = useCallback((): Promise<string | null> => {
    restoring.current ??= client
      .restore()
      .then((result) => {
        if (!result.ok) return null;
        apply(result.session);
        return result.session.csrfToken;
      })
      .finally(() => {
        restoring.current = null;
      });
    return restoring.current;
  }, [apply, client]);

  useEffect(() => {
    registerChildPrincipalHandlers({ restore, expired: () => apply(null) });
    return () => registerChildPrincipalHandlers(null);
  }, [restore, apply]);

  // Read the session once the parent's own state is known: read it, and if there is none try
  // the remembered device once.
  useEffect(() => {
    if (parentStatus === 'loading' || bootstrapped.current) return;
    bootstrapped.current = true;
    if (parentStatus === 'authenticated') {
      apply(null);
      return;
    }
    void (async () => {
      const read = await client.read();
      if (read.ok) {
        apply(read.session);
        return;
      }
      if (read.failure === 'no_session') {
        const restored = await restore();
        if (restored !== null) return;
      }
      if (sessionRef.current === null) apply(null);
    })();
  }, [parentStatus, apply, client, restore]);

  // A parent who signs in takes over: the child session is set aside locally.
  useEffect(() => {
    if (parentStatus === 'authenticated' && sessionRef.current) apply(null);
  }, [parentStatus, apply]);

  const signOut = useCallback(async () => {
    const csrf = sessionRef.current?.csrfToken;
    apply(null);
    if (csrf) await client.end(csrf);
  }, [apply, client]);

  const value = useMemo<ChildSessionValue>(() => {
    const parentWins = parentStatus === 'authenticated';
    const session = parentWins ? null : state.session;
    return {
      status: parentWins ? 'signedOut' : state.status,
      child: session?.child ?? null,
      csrfToken: session?.csrfToken ?? null,
      adopt: apply,
      signOut,
    };
  }, [parentStatus, state, apply, signOut]);

  return <ChildSessionContext.Provider value={value}>{children}</ChildSessionContext.Provider>;
}

/** Outside a provider this is always signed out. */
export function useChildSession(): ChildSessionValue {
  return useContext(ChildSessionContext);
}
