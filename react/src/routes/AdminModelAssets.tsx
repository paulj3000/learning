import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from '../features/assets/AssetAdmin.module.css';
import { listModelAssets } from '../features/assets/assetService';
import { formatFileSize } from '../features/assets/config';
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, type Asset } from '../features/assets/types';
import { getWorld } from '../features/worlds/worlds';
import { ISLAND_LOCATIONS } from '../features/island/locations';

type LoadState = 'loading' | 'ready' | 'error';

/** Set by `AdminNewModelAsset` when it navigates here after a successful upload. */
export interface ModelAssetsLocationState {
  uploadedName?: string;
}

function placeLabel(asset: Asset): string {
  if (!asset.worldId) return 'Any world';
  const world = getWorld(asset.worldId)?.title ?? asset.worldId;
  if (!asset.regionId) return world;
  const region =
    ISLAND_LOCATIONS.find((location) => location.slug === asset.regionId)?.title ?? asset.regionId;
  return `${world} / ${region}`;
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

/**
 * `/admin/assets/models`: every uploaded model, newest first
 * (docs/android/ASSET_MANAGEMENT.md section 18). Search, filters,
 * thumbnails, and triangle/animation columns arrive with Phases 3 and 9,
 * once validation has extracted those statistics.
 */
export function AdminModelAssets() {
  const location = useLocation();
  const uploadedName = (location.state as ModelAssetsLocationState | null)?.uploadedName;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [assets, setAssets] = useState<Asset[]>([]);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadState('loading');
    try {
      const loaded = await listModelAssets();
      if (isCancelled()) return;
      setAssets([...loaded].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setLoadState('ready');
    } catch {
      if (isCancelled()) return;
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>Models</h1>
        <Link to="/admin/assets">Back to assets</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        <div className={styles.content}>
          {uploadedName ? (
            <p className={styles.notice} role="status">
              Uploaded "{uploadedName}" as a draft. It is not visible to children.
            </p>
          ) : null}
          <div className={styles.toolbar}>
            <p className={styles.hint}>GLB models stored in S3, referenced by asset id.</p>
            <Link className={styles.button} to="/admin/assets/models/new">
              Upload a model
            </Link>
          </div>

          {loadState === 'loading' ? <p>Loading models...</p> : null}
          {loadState === 'error' ? (
            <div className={styles.actions}>
              <p className={styles.error} role="alert">
                The model list could not be loaded. Check your connection and try again.
              </p>
              <button className={styles.buttonSecondary} type="button" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : null}
          {loadState === 'ready' && assets.length === 0 ? (
            <p className={styles.hint}>No models have been uploaded yet.</p>
          ) : null}
          {loadState === 'ready' && assets.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table} aria-label="Uploaded models">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Category</th>
                    <th scope="col">World</th>
                    <th scope="col">Status</th>
                    <th scope="col">Version</th>
                    <th scope="col">File size</th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <th scope="row">{asset.name}</th>
                      <td>{ASSET_CATEGORY_LABELS[asset.category]}</td>
                      <td>{placeLabel(asset)}</td>
                      <td>
                        <span className={styles.status}>{ASSET_STATUS_LABELS[asset.status]}</span>
                      </td>
                      <td>v{asset.currentVersion}</td>
                      <td>{formatFileSize(asset.fileSize)}</td>
                      <td>{formatUpdated(asset.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
