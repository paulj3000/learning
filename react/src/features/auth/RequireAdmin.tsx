import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import styles from './AuthForm.module.css';

/**
 * Gates the admin section (`src/features/admin/`) to Cognito `Admins`-group
 * members, mirroring `RequireParent`'s state handling. Unlike `RequireParent`,
 * an authenticated-but-non-admin parent is not redirected — they see a plain
 * "not authorized" message, since redirecting silently would be more
 * confusing than telling them why the page did not load. There is no
 * self-serve way to become an admin (CLAUDE.md section 10); group membership
 * is granted out-of-band (see the comment in amplify/auth/resource.ts).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { status, isAdmin } = useAuth();
  const location = useLocation();

  if (status === 'unconfigured') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.heading}>The island is not connected yet</h1>
          <p className={styles.lead}>
            The admin section needs a running Amplify backend. Run <code>npm run sandbox</code>{' '}
            locally to enable sign-in.
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

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Not authorized</h1>
          <p className={styles.lead}>Your account does not have access to the admin section.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
