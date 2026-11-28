import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ParentShell } from '../features/portal/shell';
import { PortalButton } from '../features/portal/ui';
import { getChildProfile } from '../features/child-profile/api';
import { ChildSignInPanel } from '../features/child-auth/ChildSignInPanel';
import styles from './ParentDashboard.module.css';

/** `/home/children/:childId/sign-in`: the parent's controls for a child's own sign-in. */
export function ChildSignInManagement() {
  const { childId } = useParams<{ childId: string }>();
  const [nickname, setNickname] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNickname(null);
    setFailed(false);
    if (!childId) {
      setFailed(true);
      return;
    }
    getChildProfile(childId)
      .then((profile) => {
        if (cancelled) return;
        if (profile) setNickname(profile.nickname);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  return (
    <ParentShell
      mainClassName={styles.main}
      actions={
        <PortalButton asChild tone="quiet">
          <Link to="/home">Back to dashboard</Link>
        </PortalButton>
      }
    >
      <div className={styles.parentPage}>
        <h1 className={styles.parentPageTitle}>Sign-in and devices</h1>
        {failed ? <p role="alert">We could not find that child profile.</p> : null}
        {!failed && nickname === null ? <p>Loading profile...</p> : null}
        {childId && nickname !== null ? (
          <ChildSignInPanel childId={childId} nickname={nickname} />
        ) : null}
      </div>
    </ParentShell>
  );
}
