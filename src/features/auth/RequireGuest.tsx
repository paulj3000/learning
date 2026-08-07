import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import styles from './AuthForm.module.css';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Mirror of RequireParent, guarding the other direction: keeps an
 * already-authenticated parent off the sign-in/sign-up screens instead of
 * letting them submit and hit Cognito's real `UserAlreadyAuthenticatedException`
 * (a real error class with no friendly copy in errors.ts by design — the
 * fix is never reaching Cognito in that state, not adding a message for it).
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const state = location.state as LocationState | null;

  if (status === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.lead}>Loading your account...</p>
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to={state?.from?.pathname ?? '/parent'} replace />;
  }

  return <>{children}</>;
}
