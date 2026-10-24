import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { listModelAssets } from '../features/assets/assetService';
import { formatFileSize } from '../features/assets/config';
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, type Asset } from '../features/assets/types';
import { getWorld } from '../features/worlds/worlds';
import { ISLAND_LOCATIONS } from '../features/island/locations';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Badge } from '../features/admin/ui/Badge';
import { Button } from '../features/admin/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../features/admin/ui/Table';

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
    <>
      <AdminPageHeader
        title="Models"
        description="GLB models stored in S3, referenced by asset id."
        back={{ to: '/admin/assets', label: 'Back to assets' }}
        actions={
          <Button asChild>
            <Link to="/admin/assets/models/new">Upload a model</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {uploadedName ? (
          <Alert variant="success" role="status">
            Uploaded "{uploadedName}" as a draft. It is not visible to children.
          </Alert>
        ) : null}

        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading models...</p>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The model list could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {loadState === 'ready' && assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models have been uploaded yet.</p>
        ) : null}
        {loadState === 'ready' && assets.length > 0 ? (
          <div className="rounded-xl border bg-card shadow-sm">
            <Table aria-label="Uploaded models">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Category</TableHead>
                  <TableHead scope="col">World</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Version</TableHead>
                  <TableHead scope="col">File size</TableHead>
                  <TableHead scope="col">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableHead scope="row" className="text-foreground">
                      {asset.name}
                    </TableHead>
                    <TableCell>{ASSET_CATEGORY_LABELS[asset.category]}</TableCell>
                    <TableCell>{placeLabel(asset)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ASSET_STATUS_LABELS[asset.status]}</Badge>
                    </TableCell>
                    <TableCell>v{asset.currentVersion}</TableCell>
                    <TableCell>{formatFileSize(asset.fileSize)}</TableCell>
                    <TableCell>{formatUpdated(asset.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </>
  );
}
