import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AuthStatusNotice } from './AuthStatusNotice';
import styles from './AuthForm.module.css';

export function RequireParent({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const location = useLocation();

  if (status === 'unconfigured' || status === 'unavailable') {
    return <AuthStatusNotice status={status} onRetry={() => void refresh()} />;
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
