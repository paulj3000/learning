import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  countModelsByAdventure,
  listAdventures,
  listIslands,
  setAdventureActive,
  type Adventure,
  type Island,
} from '../features/admin/catalogApi';
import type { CatalogFlashState } from '../features/admin/catalog/formValues';
import { formatDate } from '../features/admin/catalog/formValues';
import { ActiveBadge } from '../features/admin/catalog/ActiveBadge';
import {
  filterAdventures,
  type AdventureFilters,
  type StatusFilter,
} from '../features/admin/catalog/filterAdventures';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Button } from '../features/admin/ui/Button';
import { Input, Label, NativeSelect } from '../features/admin/ui/FormControls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../features/admin/ui/Table';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * `/admin/adventures`: every adventure on every island, active or not
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 13), with search and
 * island/status filters.
 */
export function AdminAdventures() {
  const { userId } = useAuth();
  const location = useLocation();
  const flash = (location.state as CatalogFlashState | null)?.flash;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [adventures, setAdventures] = useState<Adventure[]>([]);
  const [islands, setIslands] = useState<Island[]>([]);
  const [modelCounts, setModelCounts] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<AdventureFilters>({
    search: '',
    islandId: '',
    status: 'all',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoadState('loading');
    try {
      const [loadedAdventures, loadedIslands, counts] = await Promise.all([
        listAdventures(),
        listIslands(),
        countModelsByAdventure(),
      ]);
      if (isCancelled()) return;
      setAdventures(loadedAdventures);
      setIslands(loadedIslands);
      setModelCounts(counts);
      setLoadState('ready');
    } catch {
      if (!isCancelled()) setLoadState('error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const islandById = useMemo(
    () => new Map(islands.map((island) => [island.id, island])),
    [islands],
  );
  const visible = filterAdventures(adventures, filters);

  async function toggleActive(adventure: Adventure) {
    if (!userId) return;
    setBusyId(adventure.id);
    setMessage(null);
    try {
      const updated = await setAdventureActive(adventure.id, !adventure.active, userId);
      setAdventures((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      setMessage({
        kind: 'success',
        text: `${updated.name} is now ${updated.active ? 'active' : 'inactive'}.`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Adventures"
        description="Every adventure on every island. An adventure is playable only when both it and its island are active."
        actions={
          <Button asChild>
            <Link to="/admin/adventures/new">Create Adventure</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4">
        {flash ? (
          <Alert variant="success" role="status">
            {flash}
          </Alert>
        ) : null}
        {message ? (
          <Alert
            variant={message.kind === 'success' ? 'success' : 'destructive'}
            role={message.kind === 'success' ? 'status' : 'alert'}
          >
            {message.text}
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="adventure-search">Search</Label>
            <Input
              id="adventure-search"
              type="search"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adventure-island-filter">Island</Label>
            <NativeSelect
              id="adventure-island-filter"
              value={filters.islandId}
              onChange={(event) => setFilters({ ...filters, islandId: event.target.value })}
            >
              <option value="">All islands</option>
              {islands.map((island) => (
                <option key={island.id} value={island.id}>
                  {island.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="adventure-status-filter">Status</Label>
            <NativeSelect
              id="adventure-status-filter"
              value={filters.status}
              onChange={(event) =>
                setFilters({ ...filters, status: event.target.value as StatusFilter })
              }
            >
              <option value="all">Active and inactive</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
          </div>
        </div>

        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading adventures...</p>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The adventure list could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
        {loadState === 'ready' && adventures.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adventures have been created yet.</p>
        ) : null}
        {loadState === 'ready' && adventures.length > 0 && visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No adventures match these filters.</p>
        ) : null}
        {loadState === 'ready' && visible.length > 0 ? (
          <div className="rounded-xl border bg-card shadow-sm">
            <Table aria-label="Adventures">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Adventure</TableHead>
                  <TableHead scope="col">Island</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col" className="text-right">
                    Models
                  </TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((adventure) => {
                  const island = islandById.get(adventure.islandId);
                  return (
                    <TableRow key={adventure.id}>
                      <TableHead scope="row">
                        <Link
                          className="font-medium text-primary hover:underline"
                          to={`/admin/adventures/${adventure.id}`}
                        >
                          {adventure.name}
                        </Link>
                      </TableHead>
                      <TableCell>
                        {island ? (
                          <Link className="hover:underline" to={`/admin/islands/${island.id}`}>
                            {island.name}
                          </Link>
                        ) : (
                          'Missing island'
                        )}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={adventure.active} />
                      </TableCell>
                      <TableCell className="text-right">
                        {modelCounts.get(adventure.id) ?? 0}
                      </TableCell>
                      <TableCell>{formatDate(adventure.updatedAt)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={busyId === adventure.id}
                          aria-label={`${adventure.active ? 'Deactivate' : 'Activate'} ${adventure.name}`}
                          onClick={() => void toggleActive(adventure)}
                        >
                          {adventure.active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>
    </>
  );
}
