import { Link, useNavigate } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { ChildProfileForm } from '../features/child-profile/ChildProfileForm';
import { createChildProfile, getOrCreateParentProfile } from '../features/child-profile/api';
import type { ChildProfileInput } from '../features/child-profile/api';

export function ChildProfileNew() {
  const navigate = useNavigate();

  async function handleSubmit(input: ChildProfileInput) {
    const parentProfile = await getOrCreateParentProfile();
    await createChildProfile(parentProfile.id, input);
    navigate('/home');
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Add a child profile</h1>
        <Link to="/home">Back to dashboard</Link>
      </header>
      <main className={styles.main} id="main-content">
        <ChildProfileForm submitLabel="Create profile" onSubmit={handleSubmit} />
      </main>
    </div>
  );
}
