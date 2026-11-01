import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AdminAsset } from '../../../api/assets/djangoAssetAdmin';
import { CATEGORY_LABELS, assetAdminMessage } from '../../../api/assets/djangoAssetAdmin';
import { AdminPageHeader } from '../../admin/AdminPageHeader';
import { Alert } from '../../admin/ui/Alert';
import { Badge } from '../../admin/ui/Badge';
import { Button } from '../../admin/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../admin/ui/Table';
import type { DjangoAssetManager } from '../assetBackend';

/** Set by the Django asset pages when they navigate here after a change. */
export interface DjangoAssetsLocationState {
  notice?: string;
}

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

/**
 * `/admin/assets/models` in a build with the Django API (AM-15): every asset
 * definition in the Django asset manager. Files and records live in Django;
 * this page never touches storage.
 */
export function DjangoModelAssets({ manager }: { manager: DjangoAssetManager }) {
  const location = useLocation();
  const notice = (location.state as DjangoAssetsLocationState | null)?.notice;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [assets, setAssets] = useState<AdminAsset[]>([]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ kind: 'loading' });
      try {
        const loaded = await manager.api.listModels(signal);
        if (signal?.aborted) return;
        setAssets(loaded);
        setState({ kind: 'ready' });
      } catch (error) {
        if (signal?.aborted) return;
        setState({ kind: 'error', message: assetAdminMessage(error) });
      }
    },
    [manager],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <AdminPageHeader
        title="Models"
        description="3D models in the Django asset manager, referenced by asset id."
        back={{ to: '/admin/assets', label: 'Back to assets' }}
        actions={
          <Button asChild>
            <Link to="/admin/assets/models/new">Add a model</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {notice ? (
          <Alert variant="success" aria-live="polite">
            {notice}
          </Alert>
        ) : null}
        {state.kind === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading models...</p>
        ) : null}
        {state.kind === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The model list could not be loaded. {state.message}
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {state.kind === 'ready' && assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models yet.</p>
        ) : null}
        {state.kind === 'ready' && assets.length > 0 ? (
          <div className="rounded-xl border bg-card shadow-sm">
            <Table aria-label="Models">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Asset id</TableHead>
                  <TableHead scope="col">Kind</TableHead>
                  <TableHead scope="col">Category</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">Default</TableHead>
                  <TableHead scope="col">Versions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.assetId}>
                    <TableHead scope="row" className="text-foreground">
                      <Link
                        className="underline-offset-4 hover:underline"
                        to={`/admin/assets/models/${encodeURIComponent(asset.assetId)}`}
                      >
                        {asset.displayName || asset.assetId}
                      </Link>
                    </TableHead>
                    <TableCell>{asset.assetId}</TableCell>
                    <TableCell>{asset.kind}</TableCell>
                    <TableCell>{CATEGORY_LABELS[asset.category] ?? asset.category}</TableCell>
                    <TableCell>
                      <Badge variant={asset.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                        {asset.status === 'ACTIVE' ? 'Active' : 'Retired'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {asset.defaultVersion === null ? 'None' : `v${asset.defaultVersion}`}
                    </TableCell>
                    <TableCell>{asset.versionCount}</TableCell>
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
