import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import styles from './AuthForm.module.css';

export function RequireParent({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'unconfigured') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.heading}>The island is not connected yet</h1>
          <p className={styles.lead}>
            Parent accounts need sign-in settings. Set <code>VITE_COGNITO_USER_POOL_ID</code> and{' '}
            <code>VITE_COGNITO_CLIENT_ID</code> to enable sign-in.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.lead}>Loading your account...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
