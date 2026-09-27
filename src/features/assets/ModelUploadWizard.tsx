import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { MODEL_FILE_EXTENSION, MODEL_MAX_UPLOAD_MB, formatFileSize } from './config';
import {
  GLB_HEADER_BYTES,
  checkModelDetails,
  checkModelFile,
  hasErrors,
  warningsOf,
  type CheckIssue,
} from './modelFileChecks';
import {
  AssetUploadError,
  progressPercent,
  startModelUpload,
  type ModelUploadHandle,
} from './modelUpload';
import {
  ASSET_CATEGORIES,
  ASSET_CATEGORY_LABELS,
  ASSET_SOURCES,
  ASSET_SOURCE_LABELS,
  type Asset,
  type AssetCategory,
  type AssetSource,
  type ModelAssetDetails,
} from './types';
import { WORLD_DEFINITIONS } from '../worlds/worlds';
import { ISLAND_LOCATIONS } from '../island/locations';
import { Alert } from '../admin/ui/Alert';
import { Button } from '../admin/ui/Button';
import { FieldHint, Input, Label, NativeSelect, Textarea } from '../admin/ui/FormControls';
import { cn } from '../admin/ui/cn';
import { alertVariants } from '../admin/ui/variants';

type Step = 'file' | 'details' | 'upload';
type UploadState = 'uploading' | 'failed';

const STEPS: { id: Step; label: string }[] = [
  { id: 'file', label: '1. Select model' },
  { id: 'details', label: '2. Basic information' },
  { id: 'upload', label: '3. Upload' },
];

const EMPTY_DETAILS: ModelAssetDetails = {
  name: '',
  description: '',
  category: 'PROP',
  worldId: '',
  regionId: '',
  source: 'THIRD_PARTY_PACK',
  sourceNotes: '',
};

interface ModelUploadWizardProps {
  /** Every existing model asset, for the duplicate-name and duplicate-file checks. */
  existingAssets: readonly Asset[];
  /** The signed-in admin's Cognito user id. */
  uploadedBy: string;
  onUploaded: (asset: Asset) => void;
  onCancel: () => void;
}

function IssueList({ issues }: { issues: readonly CheckIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {issues.map((issue) => (
        <li
          key={issue.code}
          className={alertVariants({
            variant: issue.severity === 'error' ? 'destructive' : 'warning',
          })}
          role={issue.severity === 'error' ? 'alert' : undefined}
        >
          <span className="font-semibold">
            {issue.severity === 'error' ? 'Error: ' : 'Warning: '}
          </span>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** The white panel each step's form sits in. */
const PANEL_CLASS = 'grid max-w-2xl gap-5 rounded-xl border bg-card p-6 shadow-sm';

/**
 * The three-step model upload wizard (docs/android/ASSET_MANAGEMENT.md
 * section 7): pick a GLB, describe it, upload it. File checks run as soon
 * as a file is chosen; errors block, warnings need a tick in the
 * acknowledgement box. The upload itself is `startModelUpload`, which
 * creates the asset as a draft only once S3 has the bytes.
 */
export function ModelUploadWizard({
  existingAssets,
  uploadedBy,
  onUploaded,
  onCancel,
}: ModelUploadWizardProps) {
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileIssues, setFileIssues] = useState<CheckIssue[]>([]);
  const [isCheckingFile, setIsCheckingFile] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [details, setDetails] = useState<ModelAssetDetails>(EMPTY_DETAILS);
  const [detailIssues, setDetailIssues] = useState<CheckIssue[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>('uploading');
  const [percent, setPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const handleRef = useRef<ModelUploadHandle | null>(null);

  // Leaving the page mid-upload cancels it, so nothing half-finished is left behind.
  useEffect(() => () => handleRef.current?.cancel(), []);

  const fileWarnings = warningsOf(fileIssues);
  const regions = ISLAND_LOCATIONS.filter((location) => location.worldSlug === details.worldId);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setFileIssues([]);
    setWarningsAcknowledged(false);
    if (!chosen) return;

    setIsCheckingFile(true);
    try {
      const header = new Uint8Array(await chosen.slice(0, GLB_HEADER_BYTES).arrayBuffer());
      setFileIssues(
        checkModelFile({ fileName: chosen.name, size: chosen.size, header }, existingAssets),
      );
    } catch {
      setFileIssues([
        { code: 'UNREADABLE', severity: 'error', message: 'This file could not be read.' },
      ]);
    } finally {
      setIsCheckingFile(false);
    }
  }

  function handleFileNext(event: FormEvent) {
    event.preventDefault();
    if (!file || isCheckingFile || hasErrors(fileIssues)) return;
    if (fileWarnings.length > 0 && !warningsAcknowledged) return;
    if (!details.name) {
      const baseName = file.name
        .replace(/\.glb$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      setDetails((current) => ({ ...current, name: baseName }));
    }
    setStep('details');
  }

  function updateDetail<K extends keyof ModelAssetDetails>(key: K, value: ModelAssetDetails[K]) {
    setDetails((current) => ({
      ...current,
      [key]: value,
      // A region only makes sense inside its own world.
      ...(key === 'worldId' ? { regionId: '' } : {}),
    }));
  }

  function beginUpload() {
    if (!file) return;
    setUploadState('uploading');
    setUploadError(null);
    setPercent(0);
    const handle = startModelUpload({
      file,
      details,
      uploadedBy,
      onProgress: (progress) => setPercent(progressPercent(progress)),
    });
    handleRef.current = handle;
    handle.result.then(
      (asset) => {
        handleRef.current = null;
        onUploaded(asset);
      },
      (error: unknown) => {
        handleRef.current = null;
        setUploadState('failed');
        setUploadError(
          error instanceof AssetUploadError
            ? error.message
            : 'The model could not be uploaded. Nothing was saved.',
        );
      },
    );
  }

  function handleDetailsSubmit(event: FormEvent) {
    event.preventDefault();
    const issues = checkModelDetails(details, existingAssets);
    setDetailIssues(issues);
    if (hasErrors(issues)) return;
    setStep('upload');
    beginUpload();
  }

  return (
    <div className="grid gap-6">
      <ol className="flex flex-wrap gap-2" aria-label="Upload steps">
        {STEPS.map(({ id, label }) => (
          <li
            key={id}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              id === step
                ? 'border-primary bg-card font-semibold text-foreground'
                : 'text-muted-foreground',
            )}
            aria-current={id === step ? 'step' : undefined}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 'file' ? (
        <form className={PANEL_CLASS} onSubmit={handleFileNext} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="model-file">Model file</Label>
            <Input
              id="model-file"
              type="file"
              accept={`${MODEL_FILE_EXTENSION},model/gltf-binary`}
              onChange={(event) => void handleFileChange(event)}
            />
            <FieldHint>GLB (glTF Binary) only, up to {MODEL_MAX_UPLOAD_MB} MB.</FieldHint>
          </div>
          {file ? (
            <p className="text-sm text-muted-foreground">
              {file.name} &middot; {formatFileSize(file.size)}
            </p>
          ) : null}
          {isCheckingFile ? <FieldHint>Checking the file...</FieldHint> : null}
          <IssueList issues={fileIssues} />
          {fileWarnings.length > 0 && !hasErrors(fileIssues) ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                className="mt-0.5 size-4 accent-primary"
                type="checkbox"
                checked={warningsAcknowledged}
                onChange={(event) => setWarningsAcknowledged(event.target.checked)}
              />
              I have reviewed the warnings and want to continue.
            </label>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={
                !file ||
                isCheckingFile ||
                hasErrors(fileIssues) ||
                (fileWarnings.length > 0 && !warningsAcknowledged)
              }
            >
              Next
            </Button>
            <Button variant="outline" type="button" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'details' ? (
        <form className={PANEL_CLASS} onSubmit={handleDetailsSubmit} noValidate>
          <div className="grid gap-2">
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              value={details.name}
              onChange={(event) => updateDetail('name', event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model-description">Description</Label>
            <Textarea
              id="model-description"
              rows={3}
              value={details.description}
              onChange={(event) => updateDetail('description', event.target.value)}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="model-category">Category</Label>
              <NativeSelect
                id="model-category"
                value={details.category}
                onChange={(event) => updateDetail('category', event.target.value as AssetCategory)}
              >
                {ASSET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {ASSET_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-source">Source</Label>
              <NativeSelect
                id="model-source"
                value={details.source}
                onChange={(event) => updateDetail('source', event.target.value as AssetSource)}
              >
                {ASSET_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {ASSET_SOURCE_LABELS[source]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-world">World (optional)</Label>
              <NativeSelect
                id="model-world"
                value={details.worldId}
                onChange={(event) => updateDetail('worldId', event.target.value)}
              >
                <option value="">Any world (reusable)</option>
                {WORLD_DEFINITIONS.map((world) => (
                  <option key={world.slug} value={world.slug}>
                    {world.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-region">Region (optional)</Label>
              <NativeSelect
                id="model-region"
                value={details.regionId}
                disabled={!details.worldId}
                onChange={(event) => updateDetail('regionId', event.target.value)}
              >
                <option value="">Any region</option>
                {regions.map((location) => (
                  <option key={location.slug} value={location.slug}>
                    {location.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="model-source-notes">Source notes (optional)</Label>
            <Textarea
              id="model-source-notes"
              rows={2}
              value={details.sourceNotes}
              onChange={(event) => updateDetail('sourceNotes', event.target.value)}
            />
            <FieldHint>
              Pack name, artist, and licence. Record the licence in docs/ASSET_LICENCES.md too.
            </FieldHint>
          </div>
          <IssueList issues={detailIssues} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Upload model</Button>
            <Button variant="outline" type="button" onClick={() => setStep('file')}>
              Back
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'upload' ? (
        <div className={PANEL_CLASS}>
          {uploadState === 'uploading' ? (
            <>
              <p className="text-sm font-medium" role="status">
                Uploading... {percent}%
              </p>
              <progress
                className="h-2 w-full accent-primary"
                max={100}
                value={percent}
                aria-label="Upload progress"
              />
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" type="button" onClick={() => handleRef.current?.cancel()}>
                  Cancel upload
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert variant="destructive" role="alert">
                {uploadError}
              </Alert>
              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={beginUpload}>
                  Try again
                </Button>
                <Button variant="outline" type="button" onClick={() => setStep('details')}>
                  Back to details
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
