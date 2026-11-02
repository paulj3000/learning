import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  CATEGORY_LABELS,
  assetAdminMessage,
  findingsFrom,
  type AdminAssetDetail,
  type AdminAssetVersion,
  type ValidationFinding,
} from '../../../api/assets/djangoAssetAdmin';
import { AdminPageHeader } from '../../admin/AdminPageHeader';
import { Alert } from '../../admin/ui/Alert';
import { Badge } from '../../admin/ui/Badge';
import { Button } from '../../admin/ui/Button';
import { Input, Label } from '../../admin/ui/FormControls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../admin/ui/Table';
import { isRecentAuthRequired } from '../../auth/recentSignIn/recentSignIn';
import type { SensitivePrompt } from '../../auth/recentSignIn/RecentSignInDialog';
import { useSensitiveAction } from '../../auth/recentSignIn/useSensitiveAction';
import type { DjangoAssetManager } from '../assetBackend';
import { formatFileSize } from '../config';
import type { DjangoAssetsLocationState } from './DjangoModelAssets';
import { FindingsList } from './FindingsList';
import { useVersionUpload } from './useVersionUpload';

const STATUS_LABELS: Record<AdminAssetVersion['status'], string> = {
  DRAFT: 'Draft',
  VALIDATED: 'Validated, not published',
  REJECTED: 'Rejected',
  PUBLISHED: 'Published',
  RETIRED: 'Retired',
};

const DELETABLE: ReadonlySet<AdminAssetVersion['status']> = new Set([
  'DRAFT',
  'VALIDATED',
  'REJECTED',
]);

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

interface Message {
  variant: 'success' | 'destructive';
  text: string;
  findings?: ValidationFinding[];
}

/**
 * `/admin/assets/models/:assetId` in a build with the Django API (AM-15): an
 * asset's versions, and the publish, default, retire and delete actions of
 * the Django lifecycle (docs/ASSET_MANAGER.md section 3). Django enforces
 * every rule; the buttons only offer what the current state allows.
 */
export function DjangoModelAssetDetail({ manager }: { manager: DjangoAssetManager }) {
  const { assetId = '' } = useParams();
  const location = useLocation();
  const notice = (location.state as DjangoAssetsLocationState | null)?.notice;
  const upload = useVersionUpload(manager);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [asset, setAsset] = useState<AdminAssetDetail | null>(null);
  const [message, setMessage] = useState<Message | null>(
    notice ? { variant: 'success', text: notice } : null,
  );
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const sensitive = useSensitiveAction();

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const loaded = await manager.api.getAsset(assetId, signal);
        if (signal?.aborted) return;
        setAsset(loaded);
        setState({ kind: 'ready' });
      } catch (error) {
        if (signal?.aborted) return;
        setState({ kind: 'error', message: assetAdminMessage(error) });
      }
    },
    [manager, assetId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function act(
    key: string,
    success: string,
    action: () => Promise<unknown>,
    prompt: SensitivePrompt,
  ) {
    setPending(key);
    setMessage(null);
    try {
      // Every change needs a recent sign-in (LAI-0209); the dialog asks, then confirms.
      const result = await sensitive.run(action, prompt);
      if (result.status === 'done') setMessage({ variant: 'success', text: success });
    } catch (error) {
      setMessage({
        variant: 'destructive',
        text: assetAdminMessage(error),
        findings: findingsFrom(error),
      });
    } finally {
      setPending(null);
      setConfirmDelete(null);
      await load();
    }
  }

  async function uploadVersion() {
    if (!file) return;
    setMessage(null);
    const chosen = file;
    const attempt = async () => {
      const result = await upload.start(assetId, chosen);
      if (!result.ok && isRecentAuthRequired(result.error)) throw result.error;
      return result;
    };
    let outcome: Awaited<ReturnType<typeof attempt>>;
    try {
      // The chosen file stays selected while the administrator signs in again (LAI-0209).
      const result = await sensitive.run(attempt, {
        title: `Upload ${chosen.name}`,
        description: 'Upload this file as a new version of the model.',
        confirmLabel: 'Upload',
      });
      if (result.status === 'cancelled') return;
      outcome = result.value;
    } catch (error) {
      outcome = { ok: false, error };
    }
    if (outcome.ok) {
      setFile(null);
      setMessage({
        variant: 'success',
        text: outcome.alreadyUploaded
          ? `This file is already version ${outcome.version}.`
          : `Uploaded version ${outcome.version}. Publish it to make it available to scenes.`,
      });
      await load();
    } else {
      setMessage({
        variant: 'destructive',
        text: assetAdminMessage(outcome.error),
        findings: findingsFrom(outcome.error),
      });
    }
  }

  const title = asset ? asset.displayName || asset.assetId : 'Model';

  return (
    <>
      <AdminPageHeader
        title={title}
        back={{ to: '/admin/assets/models', label: 'Back to models' }}
      />
      <div className="grid grid-cols-1 gap-4">
        {message ? (
          <Alert
            variant={message.variant}
            role={message.variant === 'success' ? 'status' : 'alert'}
          >
            <div className="grid gap-2">
              <p>{message.text}</p>
              <FindingsList findings={message.findings ?? []} />
            </div>
          </Alert>
        ) : null}
        {state.kind === 'loading' ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : null}
        {state.kind === 'error' ? (
          <Alert variant="destructive" role="alert">
            This model could not be loaded. {state.message}
          </Alert>
        ) : null}
        {asset ? (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-medium">Asset id</dt>
              <dd>{asset.assetId}</dd>
              <dt className="font-medium">Kind</dt>
              <dd>
                {asset.kind}, {CATEGORY_LABELS[asset.category] ?? asset.category}
              </dd>
              <dt className="font-medium">Status</dt>
              <dd>{asset.status === 'ACTIVE' ? 'Active' : 'Retired'}</dd>
              <dt className="font-medium">Used in published 3D Areas</dt>
              <dd>{asset.publishedReferences}</dd>
            </dl>
            {asset.description ? <p className="text-sm">{asset.description}</p> : null}

            <div className="rounded-xl border bg-card shadow-sm">
              <Table aria-label="Versions">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Version</TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">File</TableHead>
                    <TableHead scope="col">Size</TableHead>
                    <TableHead scope="col">Animations</TableHead>
                    <TableHead scope="col">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {asset.versions.map((version) => {
                    const isDefault = asset.defaultVersion === version.number;
                    const busy = pending !== null || upload.uploading;
                    const label = `version ${version.number}`;
                    return (
                      <TableRow key={version.number}>
                        <TableHead scope="row" className="text-foreground">
                          v{version.number}
                        </TableHead>
                        <TableCell>
                          <Badge variant="secondary">{STATUS_LABELS[version.status]}</Badge>
                          {isDefault ? (
                            <Badge variant="outline" className="ml-2">
                              Default
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{version.originalFilename}</TableCell>
                        <TableCell>{formatFileSize(version.sizeBytes)}</TableCell>
                        <TableCell>{version.clips.join(', ') || 'None'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            {version.status === 'VALIDATED' ? (
                              <Button
                                size="sm"
                                type="button"
                                disabled={busy}
                                aria-label={`Publish ${label}`}
                                onClick={() =>
                                  void act(
                                    `publish-${version.number}`,
                                    `Published ${label}.`,
                                    () => manager.api.publish(assetId, version.number),
                                    {
                                      title: `Publish ${label}`,
                                      description: 'Published versions can be used by scenes.',
                                      confirmLabel: 'Publish',
                                    },
                                  )
                                }
                              >
                                Publish
                              </Button>
                            ) : null}
                            {version.status === 'PUBLISHED' && !isDefault ? (
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={busy}
                                aria-label={`Make ${label} the default`}
                                onClick={() =>
                                  void act(
                                    `default-${version.number}`,
                                    `Version ${version.number} is now the default.`,
                                    () => manager.api.makeDefault(assetId, version.number),
                                    {
                                      title: `Make ${label} the default`,
                                      description:
                                        'Scenes that use this model will load this version.',
                                      confirmLabel: 'Make default',
                                    },
                                  )
                                }
                              >
                                Make default
                              </Button>
                            ) : null}
                            {version.status === 'PUBLISHED' && !isDefault ? (
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={busy}
                                aria-label={`Retire ${label}`}
                                onClick={() =>
                                  void act(
                                    `retire-${version.number}`,
                                    `Retired ${label}.`,
                                    () => manager.api.retire(assetId, version.number),
                                    {
                                      title: `Retire ${label}`,
                                      description:
                                        'Retired versions are no longer offered to scenes.',
                                      confirmLabel: 'Retire',
                                      destructive: true,
                                    },
                                  )
                                }
                              >
                                Retire
                              </Button>
                            ) : null}
                            {DELETABLE.has(version.status) && confirmDelete !== version.number ? (
                              <Button
                                size="sm"
                                variant="outline"
                                type="button"
                                disabled={busy}
                                aria-label={`Delete ${label}`}
                                onClick={() => setConfirmDelete(version.number)}
                              >
                                Delete
                              </Button>
                            ) : null}
                            {confirmDelete === version.number ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void act(
                                      `delete-${version.number}`,
                                      `Deleted ${label}.`,
                                      () => manager.api.deleteVersion(assetId, version.number),
                                      {
                                        title: `Delete ${label}`,
                                        description:
                                          'This deletes the unpublished file. This cannot be undone.',
                                        confirmLabel: 'Delete',
                                        destructive: true,
                                      },
                                    )
                                  }
                                >
                                  Confirm delete
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => setConfirmDelete(null)}
                                >
                                  Keep
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {asset.versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions yet.</p>
            ) : null}

            {asset.status === 'ACTIVE' ? (
              <div className="grid max-w-xl gap-2">
                <Label htmlFor="version-file">Upload a new version</Label>
                <Input
                  id="version-file"
                  type="file"
                  accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                  disabled={upload.uploading}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {upload.percent !== null ? (
                  <>
                    <output className="block text-sm font-medium">
                      Uploading... {upload.percent}%
                    </output>
                    <progress
                      className="h-2 w-full accent-primary"
                      max={100}
                      value={upload.percent}
                      aria-label="Upload progress"
                    />
                  </>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={!file || upload.uploading || pending !== null}
                    onClick={() => void uploadVersion()}
                  >
                    Upload
                  </Button>
                  {upload.uploading ? (
                    <Button variant="outline" type="button" onClick={upload.cancel}>
                      Cancel upload
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {sensitive.dialog}
    </>
  );
}
