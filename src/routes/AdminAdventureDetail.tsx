import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import {
  deleteAdventure,
  getAdventure,
  getDeleteBlockReason,
  getIsland,
  hasGameContent,
  setAdventureActive,
  type Adventure,
  type Island,
} from '../features/admin/catalogApi';
import type { CatalogFlashState } from '../features/admin/catalog/formValues';
import { formatDate } from '../features/admin/catalog/formValues';
import { ActiveBadge } from '../features/admin/catalog/ActiveBadge';
import { AdventureModelList } from '../features/admin/catalog/AdventureModelList';
import { DeleteAdventureConfirm } from '../features/admin/catalog/DeleteAdventureConfirm';
import { isAdventurePlayable } from '../features/catalog/availability';
import { AdminPageHeader } from '../features/admin/AdminPageHeader';
import { Alert } from '../features/admin/ui/Alert';
import { Button } from '../features/admin/ui/Button';
import { Card, CardContent } from '../features/admin/ui/Card';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

interface DeleteState {
  checking: boolean;
  blockReason: string | null;
  deleting: boolean;
  error: string | null;
}

/**
 * `/admin/adventures/:adventureId` (docs/ISLAND_ADVENTURE_MANAGEMENT.md
 * sections 15, 16 and 18). Delete is shown only to Superusers, and the
 * backend refuses it for everyone else regardless.
 */
export function AdminAdventureDetail() {
  const { adventureId = '' } = useParams<{ adventureId: string }>();
  const { userId, isSuperuser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const flash = (location.state as CatalogFlashState | null)?.flash;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [adventure, setAdventure] = useState<Adventure | null>(null);
  const [island, setIsland] = useState<Island | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);

  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoadState('loading');
      try {
        const loaded = await getAdventure(adventureId);
        if (isCancelled()) return;
        if (!loaded) {
          setLoadState('not-found');
          return;
        }
        const loadedIsland = await getIsland(loaded.islandId);
        if (isCancelled()) return;
        setAdventure(loaded);
        setIsland(loadedIsland);
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

  async function toggleActive() {
    if (!adventure || !userId) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await setAdventureActive(adventure.id, !adventure.active, userId);
      setAdventure(updated);
      setMessage({
        kind: 'success',
        text: `${updated.name} is now ${updated.active ? 'active' : 'inactive'}.`,
      });
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openDelete() {
    if (!adventure) return;
    setDeleteState({ checking: true, blockReason: null, deleting: false, error: null });
    try {
      const blockReason = await getDeleteBlockReason(adventure);
      setDeleteState({ checking: false, blockReason, deleting: false, error: null });
    } catch (error) {
      setDeleteState({
        checking: false,
        blockReason: null,
        deleting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function confirmDelete() {
    if (!adventure || !deleteState) return;
    setDeleteState({ ...deleteState, deleting: true, error: null });
    try {
      await deleteAdventure(adventure);
      const state: CatalogFlashState = { flash: `Deleted ${adventure.name}.` };
      navigate(island ? `/admin/islands/${island.id}` : '/admin/adventures', { state });
    } catch (error) {
      setDeleteState({
        ...deleteState,
        deleting: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const back = { to: '/admin/adventures', label: 'Back to adventures' };

  if (loadState !== 'ready' || !adventure) {
    return (
      <>
        <AdminPageHeader title="Adventure" back={back} />
        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading the adventure...</p>
        ) : null}
        {loadState === 'not-found' ? (
          <Alert variant="destructive" role="alert">
            That adventure does not exist.
          </Alert>
        ) : null}
        {loadState === 'error' ? (
          <div className="grid justify-items-start gap-3">
            <Alert variant="destructive" role="alert">
              The adventure could not be loaded. Check your connection and try again.
            </Alert>
            <Button variant="outline" type="button" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  const playable = isAdventurePlayable(island ?? { active: true }, adventure);
  const linkedContent = hasGameContent(adventure);

  return (
    <>
      <AdminPageHeader
        title={adventure.name}
        back={back}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/admin/adventures/${adventure.id}/edit`}>Edit Adventure</Link>
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={busy}
              onClick={() => void toggleActive()}
            >
              {adventure.active ? 'Deactivate' : 'Activate'}
            </Button>
            {isSuperuser ? (
              <Button
                variant="destructive"
                type="button"
                disabled={deleteState !== null}
                onClick={() => void openDelete()}
              >
                Delete Adventure
              </Button>
            ) : null}
          </>
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
        {isSuperuser && deleteState ? (
          <DeleteAdventureConfirm
            adventureName={adventure.name}
            blockReason={deleteState.blockReason}
            checking={deleteState.checking}
            deleting={deleteState.deleting}
            error={deleteState.error}
            onCancel={() => setDeleteState(null)}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
        {adventure.active && island && !island.active ? (
          <Alert variant="warning">
            This adventure is active, but its island is inactive, so children cannot play it.
          </Alert>
        ) : null}

        <Card>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium">Island</dt>
                <dd>
                  {island ? (
                    <Link
                      className="text-primary hover:underline"
                      to={`/admin/islands/${island.id}`}
                    >
                      {island.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Missing island</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-medium">Status</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <ActiveBadge active={adventure.active} />
                  <span className="text-muted-foreground">
                    {playable && linkedContent
                      ? 'Playable'
                      : !linkedContent
                        ? 'No game content yet'
                        : 'Not playable'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="font-medium">Slug</dt>
                <dd className="text-muted-foreground">{adventure.slug}</dd>
              </div>
              <div>
                <dt className="font-medium">Sort order</dt>
                <dd className="text-muted-foreground">{adventure.sortOrder}</dd>
              </div>
              <div>
                <dt className="font-medium">Created</dt>
                <dd className="text-muted-foreground">{formatDate(adventure.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-medium">Last updated</dt>
                <dd className="text-muted-foreground">{formatDate(adventure.updatedAt)}</dd>
              </div>
            </dl>
            <div className="grid gap-1">
              <h2 className="text-sm font-medium">Short description</h2>
              <p className="text-sm text-muted-foreground">
                {adventure.shortDescription ?? 'No short description yet.'}
              </p>
            </div>
            <div className="grid gap-1">
              <h2 className="text-sm font-medium">Full description</h2>
              <p className="text-sm whitespace-pre-line text-muted-foreground">
                {adventure.description ?? 'No description yet.'}
              </p>
            </div>
          </CardContent>
        </Card>

        <AdventureModelList adventureId={adventure.id} />
      </div>
    </>
  );
}
