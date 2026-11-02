import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ASSET_ID_PATTERN,
  ASSET_KINDS,
  AssetUploadFailure,
  CATEGORY_LABELS,
  KIND_CATEGORIES,
  assetAdminMessage,
  findingsFrom,
  type AssetKind,
  type ValidationFinding,
} from '../../../api/assets/djangoAssetAdmin';
import { ApiError } from '../../../api/errors';
import { AdminPageHeader } from '../../admin/AdminPageHeader';
import { Alert } from '../../admin/ui/Alert';
import { Button } from '../../admin/ui/Button';
import { FieldHint, Input, Label, NativeSelect, Textarea } from '../../admin/ui/FormControls';
import { isRecentAuthRequired } from '../../auth/recentSignIn/recentSignIn';
import { useSensitiveAction } from '../../auth/recentSignIn/useSensitiveAction';
import type { DjangoAssetManager } from '../assetBackend';
import { formatFileSize } from '../config';
import { slugify } from '../modelFileChecks';
import type { DjangoAssetsLocationState } from './DjangoModelAssets';
import { FindingsList } from './FindingsList';
import { useVersionUpload } from './useVersionUpload';

const ACCEPT = '.glb,.gltf,model/gltf-binary,model/gltf+json';

interface Failure {
  message: string;
  fields: Record<string, string>;
  findings: ValidationFinding[];
}

function failureOf(error: unknown): Failure {
  const apiError = error instanceof AssetUploadFailure ? error.error : error;
  const fields: Record<string, string> = {};
  if (apiError instanceof ApiError) {
    for (const [field, details] of Object.entries(apiError.details)) {
      if (field !== 'findings' && details[0]) fields[field] = details[0].message;
    }
  }
  return { message: assetAdminMessage(error), fields, findings: findingsFrom(error) };
}

/**
 * `/admin/assets/models/new` in a build with the Django API (AM-15): define a
 * model asset and upload its first version. Django validates and stores the
 * file; nothing is published from here.
 *
 * Retry-safe: once the definition exists, a retry only uploads (it never
 * tries to create the definition again), and a file Django already holds
 * counts as uploaded.
 */
export function DjangoNewModelAsset({ manager }: { manager: DjangoAssetManager }) {
  const navigate = useNavigate();
  const upload = useVersionUpload(manager);
  const [displayName, setDisplayName] = useState('');
  const [assetId, setAssetId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<AssetKind>('prop');
  const [category, setCategory] = useState('prop');
  const [file, setFile] = useState<File | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const sensitive = useSensitiveAction();

  const effectiveId = createdId ?? (idEdited ? assetId : slugify(displayName));
  const idValid = ASSET_ID_PATTERN.test(effectiveId);
  const categories = KIND_CATEGORIES[kind];

  function chooseKind(next: AssetKind) {
    setKind(next);
    if (!KIND_CATEGORIES[next].includes(category)) setCategory(KIND_CATEGORIES[next][0]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || !idValid || !displayName.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    const chosen = file;
    let created = createdId !== null;
    // Both steps need a recent sign-in (LAI-0209). If Django asks for one, the dialog keeps
    // this form, its fields and the chosen file as they are, and after the administrator
    // signs in and confirms, runs the remaining steps once more. A definition already
    // created is not created again.
    const attempt = async () => {
      if (!created) {
        await manager.api.createDefinition({
          assetId: effectiveId,
          displayName: displayName.trim(),
          description: description.trim(),
          kind,
          category,
        });
        created = true;
        setCreatedId(effectiveId);
      }
      const result = await upload.start(effectiveId, chosen);
      if (!result.ok && isRecentAuthRequired(result.error)) throw result.error;
      return result;
    };
    try {
      const run = await sensitive.run(attempt, {
        title: `Add "${displayName.trim()}"`,
        description: 'Create this model and upload the chosen file as its first version.',
        confirmLabel: 'Add model',
      });
      if (run.status === 'cancelled') return;
      const outcome = run.value;
      if (!outcome.ok) {
        setFailure(failureOf(outcome.error));
        return;
      }
      const state: DjangoAssetsLocationState = {
        notice: `Uploaded "${displayName.trim()}" as version ${outcome.version}. It is not visible to children until it is published.`,
      };
      navigate(`/admin/assets/models/${encodeURIComponent(effectiveId)}`, { state });
    } catch (error) {
      setFailure(failureOf(error));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (name: string) => failure?.fields[name];

  return (
    <>
      <AdminPageHeader
        title="Add a model"
        back={{ to: '/admin/assets/models', label: 'Back to models' }}
      />
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        <div className="grid gap-2">
          <Label htmlFor="asset-name">Name</Label>
          <Input
            id="asset-name"
            value={displayName}
            maxLength={120}
            disabled={createdId !== null}
            aria-invalid={Boolean(fieldError('displayName'))}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          {fieldError('displayName') ? <FieldHint>{fieldError('displayName')}</FieldHint> : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="asset-id">Asset id</Label>
          <Input
            id="asset-id"
            value={effectiveId}
            disabled={createdId !== null}
            aria-invalid={!idValid || Boolean(fieldError('assetId'))}
            aria-describedby="asset-id-hint"
            onChange={(event) => {
              setIdEdited(true);
              setAssetId(event.target.value);
            }}
          />
          <FieldHint id="asset-id-hint">
            {fieldError('assetId') ??
              'Lowercase letters and digits joined by hyphens. Scenes refer to the model by this id, and it cannot change later.'}
          </FieldHint>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="asset-description">Description</Label>
          <Textarea
            id="asset-description"
            value={description}
            maxLength={1000}
            disabled={createdId !== null}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="asset-kind">Kind</Label>
            <NativeSelect
              id="asset-kind"
              value={kind}
              disabled={createdId !== null}
              onChange={(event) => chooseKind(event.target.value as AssetKind)}
            >
              {ASSET_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="asset-category">Category</Label>
            <NativeSelect
              id="asset-category"
              value={category}
              disabled={createdId !== null}
              aria-invalid={Boolean(fieldError('category'))}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option] ?? option}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="asset-file">Model file (.glb or self-contained .gltf)</Label>
          <Input
            id="asset-file"
            type="file"
            accept={ACCEPT}
            disabled={upload.uploading}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <FieldHint>
              {file.name}, {formatFileSize(file.size)}. Django checks the file before storing it.
            </FieldHint>
          ) : null}
        </div>

        {upload.percent !== null ? (
          <div className="grid gap-2">
            <output className="block text-sm font-medium">Uploading... {upload.percent}%</output>
            <progress
              className="h-2 w-full accent-primary"
              max={100}
              value={upload.percent}
              aria-label="Upload progress"
            />
            <div>
              <Button variant="outline" type="button" onClick={upload.cancel}>
                Cancel upload
              </Button>
            </div>
          </div>
        ) : null}

        {failure ? (
          <Alert variant="destructive" role="alert">
            <div className="grid gap-2">
              <p>{failure.message}</p>
              {createdId !== null ? (
                <p>The asset "{createdId}" was created. Trying again only uploads the file.</p>
              ) : null}
              <FindingsList findings={failure.findings} />
            </div>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy || !file || !idValid || !displayName.trim()}>
            {createdId === null ? 'Add and upload' : 'Try the upload again'}
          </Button>
          <Button variant="outline" type="button" onClick={() => navigate('/admin/assets/models')}>
            {createdId === null ? 'Cancel' : 'Back to models'}
          </Button>
        </div>
      </form>
      {sensitive.dialog}
    </>
  );
}
