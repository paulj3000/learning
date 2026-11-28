import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { RequireParent } from '../auth/RequireParent';
import styles from '../auth/AuthForm.module.css';
import { childHomePath } from './ChildSignInForm';
import { useChildSession } from './ChildSessionContext';

/**
 * Guards a child's gameplay page. Either the parent signed in (the existing guard, unchanged)
 * or a child whose server-verified session is for the child in the URL. A child asking for a
 * different child id is sent to their own island; the id used is always the session's. The
 * server still checks every request: this only decides what to draw.
 */
export function RequireChildOrParent({ children }: { children: ReactNode }) {
  const { childId } = useParams<{ childId: string }>();
  const child = useChildSession();

  if (child.status === 'signedIn' && child.child) {
    if (childId !== child.child.id) {
      return <Navigate to={childHomePath(child.child.id)} replace />;
    }
    return <>{children}</>;
  }
  // The provider reports `signedOut` whenever a parent is signed in (parent wins), so
  // `loading` only means the child session is still being read.
  if (child.status === 'loading') {
    return (
      <div className={styles.page}>
        <p className={styles.lead}>Opening the island...</p>
      </div>
    );
  }
  return <RequireParent>{children}</RequireParent>;
}
