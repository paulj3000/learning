import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  assignModel,
  listAssignableModels,
  listModelsByAdventure,
  unassignModel,
  type AdventureModelEntry,
} from '../catalogApi';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
  type Asset,
  type AssetCategory,
} from '../../assets/types';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Label, NativeSelect } from '../ui/FormControls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The Models section of an adventure's admin page
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 16): which existing
 * S3-backed `Asset` records it uses. Assigning links to an asset by id and
 * never copies it. There is no model detail page yet
 * (`/admin/assets/models/:id` is Phase 3+ of the asset manager), so model
 * names are not links.
 */
export function AdventureModelList({ adventureId }: { adventureId: string }) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [entries, setEntries] = useState<AdventureModelEntry[]>([]);
  const [assignable, setAssignable] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [role, setRole] = useState<AssetCategory | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoadState('loading');
      try {
        const [loadedEntries, models] = await Promise.all([
          listModelsByAdventure(adventureId),
          listAssignableModels(),
        ]);
        if (isCancelled()) return;
        setEntries(loadedEntries);
        setAssignable(models);
        setLoadState('ready');
      } catch {
        if (!isCancelled()) setLoadState('error');
      }
    },
    [adventureId],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const assignedIds = new Set(entries.map((entry) => entry.assignment.assetId));
  const options = assignable.filter((asset) => !assignedIds.has(asset.id));

  async function handleAssign(event: FormEvent) {
    event.preventDefault();
    const asset = assignable.find((entry) => entry.id === assetId);
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      const sortOrder =
        entries.reduce((max, entry) => Math.max(max, entry.assignment.sortOrder), 0) + 10;
      const assignment = await assignModel(adventureId, asset.id, role || null, sortOrder);
      setEntries((current) => [...current, { assignment, asset }]);
      setAssetId('');
      setRole('');
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : String(assignError));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(entry: AdventureModelEntry) {
    setBusy(true);
    setError(null);
    try {
      await unassignModel(entry.assignment.id);
      setEntries((current) =>
        current.filter((candidate) => candidate.assignment.id !== entry.assignment.id),
      );
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h2>Models</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : null}
        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading models...</p>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The models could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {loadState === 'ready' && entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No models are currently assigned to this adventure.
          </p>
        ) : null}
        {loadState === 'ready' && entries.length > 0 ? (
          <Table aria-label="Adventure models">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Model</TableHead>
                <TableHead scope="col">Type / Role</TableHead>
                <TableHead scope="col">Asset status</TableHead>
                <TableHead scope="col">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const name = entry.asset?.name ?? 'Missing asset';
                const role = entry.assignment.role ?? entry.asset?.category;
                return (
                  <TableRow key={entry.assignment.id}>
                    <TableHead scope="row" className="text-foreground">
                      {name}
                    </TableHead>
                    <TableCell>{role ? ASSET_CATEGORY_LABELS[role] : ''}</TableCell>
                    <TableCell>
                      {entry.asset ? (
                        <Badge variant="secondary">{ASSET_STATUS_LABELS[entry.asset.status]}</Badge>
                      ) : (
                        <Badge variant="outline">Deleted</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${name}`}
                        onClick={() => void handleRemove(entry)}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}

        {loadState === 'ready' ? (
          options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {assignable.length === 0
                ? 'No models have been uploaded yet. Upload one under Game assets.'
                : 'Every uploaded model is already assigned.'}
            </p>
          ) : (
            <form
              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[2fr_1fr_auto]"
              onSubmit={(event) => void handleAssign(event)}
            >
              <div className="grid gap-2">
                <Label htmlFor="assign-model">Add a model</Label>
                <NativeSelect
                  id="assign-model"
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                >
                  <option value="">Choose a model</option>
                  {options.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="assign-role">Role</Label>
                <NativeSelect
                  id="assign-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as AssetCategory | '')}
                >
                  <option value="">Same as its category</option>
                  {ASSET_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {ASSET_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={busy || !assetId}>
                Add model
              </Button>
            </form>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
