import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from '../features/assets/AssetAdmin.module.css';
import { useAuth } from '../features/auth/AuthContext';
import { listModelAssets } from '../features/assets/assetService';
import { ModelUploadWizard } from '../features/assets/ModelUploadWizard';
import type { Asset } from '../features/assets/types';
import type { ModelAssetsLocationState } from './AdminModelAssets';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/admin/assets/models/new`. Loads the existing models first because the
 * wizard's duplicate checks need them: without that list it could not tell
 * an admin they are about to upload the same file twice, so a failed load
 * blocks the wizard rather than silently skipping the check.
 */
export function AdminNewModelAsset() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [existing, setExisting] = useState<Asset[]>([]);

  useEffect(() => {
    let cancelled = false;
    listModelAssets().then(
      (assets) => {
        if (cancelled) return;
        setExisting(assets);
        setLoadState('ready');
      },
      () => {
        if (!cancelled) setLoadState('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>Upload a model</h1>
        <Link to="/admin/assets/models">Back to models</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading existing models...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.error} role="alert">
            The existing model list could not be loaded, so duplicates cannot be checked. Go back
            and try again.
          </p>
        ) : null}
        {loadState === 'ready' && !userId ? (
          <p className={styles.error} role="alert">
            Your admin session could not be read. Sign out, sign in again, and retry.
          </p>
        ) : null}
        {loadState === 'ready' && userId ? (
          <ModelUploadWizard
            existingAssets={existing}
            uploadedBy={userId}
            onUploaded={(asset) => {
              const state: ModelAssetsLocationState = { uploadedName: asset.name };
              navigate('/admin/assets/models', { state });
            }}
            onCancel={() => navigate('/admin/assets/models')}
          />
        ) : null}
      </main>
    </div>
  );
}
