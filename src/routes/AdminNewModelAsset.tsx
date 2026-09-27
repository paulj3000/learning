import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { listModelAssets } from '../features/assets/assetService';
import { ModelUploadWizard } from '../features/assets/ModelUploadWizard';
import type { Asset } from '../features/assets/types';
import type { ModelAssetsLocationState } from './AdminModelAssets';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';

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
    <>
      <AdminPageHeader
        title="Upload a model"
        back={{ to: '/admin/assets/models', label: 'Back to models' }}
      />
      {loadState === 'loading' ? (
        <p className="text-sm text-muted-foreground">Loading existing models...</p>
      ) : null}
      {loadState === 'error' ? (
        <Alert variant="destructive" role="alert">
          The existing model list could not be loaded, so duplicates cannot be checked. Go back and
          try again.
        </Alert>
      ) : null}
      {loadState === 'ready' && !userId ? (
        <Alert variant="destructive" role="alert">
          Your admin session could not be read. Sign out, sign in again, and retry.
        </Alert>
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
    </>
  );
}
