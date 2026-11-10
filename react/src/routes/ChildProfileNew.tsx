import { ParentShell } from '../features/portal/shell';
import { PortalButton } from '../features/portal/ui';
import { Link, useNavigate } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { ChildProfileForm } from '../features/child-profile/ChildProfileForm';
import { createChildProfile, getOrCreateParentProfile } from '../features/child-profile/api';
import type { ChildProfileInput } from '../features/child-profile/api';

export function ChildProfileNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: ChildProfileInput) {
    const parentProfile = await getOrCreateParentProfile();
    return createChildProfile(parentProfile.id, input);
  }

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
        <h1 className={styles.parentPageTitle}>Add a child profile</h1>
        <ChildProfileForm
          submitLabel="Create profile"
          onSubmit={handleSubmit}
          onSaved={() => navigate('/home')}
        />
      </div>
    </ParentShell>
  );
}
