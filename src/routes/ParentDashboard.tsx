import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { useAuth } from '../features/auth/AuthContext';
import { ChildProfileList } from '../features/child-profile/ChildProfileList';
import {
  getOrCreateParentProfile,
  listChildProfiles,
  setChildProfileActive,
} from '../features/child-profile/api';
import { deleteAccountAndAllData } from '../features/child-profile/deletion';
import type { ChildProfile, ParentProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'error';

export function ParentDashboard() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const parent = await getOrCreateParentProfile();
        const children = await listChildProfiles();
        if (cancelled) return;
        setParentProfile(parent);
        setChildProfiles(children);
        setLoadState('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Something went wrong.');
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleActive(child: ChildProfile) {
    const updated = await setChildProfileActive(child.id, !child.active);
    setChildProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteAccountAndAllData();
      navigate('/');
    } catch (deleteError) {
      setDeleteAccountError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete your account.',
      );
      setDeletingAccount(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          {parentProfile ? `Welcome, ${parentProfile.displayName}` : 'Parent dashboard'}
        </h1>
        <button className={styles.signOut} type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main className={styles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading your family's island...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {loadState === 'ready' ? (
          <div className={styles.content}>
            <ChildProfileList childProfiles={childProfiles} onToggleActive={handleToggleActive} />
            <p>
              <Link to="/parent/coop/new">
                Play together (shared adventure between two children)
              </Link>
            </p>
            <section className={styles.dangerZone}>
              <h2 className={styles.dangerHeading}>Delete account</h2>
              <p className={styles.hint}>
                Permanently deletes your parent account and every child profile, adventure, saved
                story, and record beneath it. This cannot be undone.
              </p>
              {deleteAccountError ? (
                <p className={styles.error} role="alert">
                  {deleteAccountError}
                </p>
              ) : null}
              {confirmingDeleteAccount ? (
                <div className={styles.confirm} role="alert">
                  <p className={styles.confirmText}>
                    Delete your account and all family data for good?
                  </p>
                  <button
                    className={styles.buttonDanger}
                    type="button"
                    disabled={deletingAccount}
                    onClick={() => void handleDeleteAccount()}
                  >
                    Yes, delete everything
                  </button>
                  <button
                    className={styles.buttonSecondary}
                    type="button"
                    onClick={() => setConfirmingDeleteAccount(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className={styles.buttonDanger}
                  type="button"
                  onClick={() => setConfirmingDeleteAccount(true)}
                >
                  Delete my account
                </button>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
