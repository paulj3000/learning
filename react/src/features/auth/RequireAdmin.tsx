import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { NotFound } from '../../routes/NotFound';
import styles from './AuthForm.module.css';

/**
 * Gates the admin section (`src/features/admin/`) to Cognito `Admins`-group
 * members, mirroring `RequireParent`'s state handling. An
 * authenticated-but-non-admin parent gets the app's ordinary `NotFound`
 * page, exactly what an unknown URL shows, so the admin section's existence
 * and route structure are not disclosed to them
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 6). Nothing admin is rendered
 * while auth is still loading. There is no self-serve way to become an admin
 * (CLAUDE.md section 10); group membership is granted out-of-band (see the
 * comment in amplify/auth/resource.ts). This is only the UI gate: every
 * admin read and write is also refused by the backend's group rules.
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
    return <NotFound />;
  }

  return <>{children}</>;
}
