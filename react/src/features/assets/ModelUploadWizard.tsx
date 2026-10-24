import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import styles from './AssetAdmin.module.css';
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
    <ul className={styles.issues}>
      {issues.map((issue) => (
        <li
          key={issue.code}
          className={issue.severity === 'error' ? styles.error : styles.warning}
          role={issue.severity === 'error' ? 'alert' : undefined}
        >
          {issue.severity === 'error' ? 'Error: ' : 'Warning: '}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

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
    <div className={styles.content}>
      <ol className={styles.steps} aria-label="Upload steps">
        {STEPS.map(({ id, label }) => (
          <li
            key={id}
            className={id === step ? styles.stepCurrent : undefined}
            aria-current={id === step ? 'step' : undefined}
          >
            {label}
          </li>
        ))}
      </ol>

      {step === 'file' ? (
        <form className={styles.form} onSubmit={handleFileNext} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-file">
              Model file
            </label>
            <input
              id="model-file"
              className={styles.input}
              type="file"
              accept={`${MODEL_FILE_EXTENSION},model/gltf-binary`}
              onChange={(event) => void handleFileChange(event)}
            />
            <p className={styles.hint}>GLB (glTF Binary) only, up to {MODEL_MAX_UPLOAD_MB} MB.</p>
          </div>
          {file ? (
            <p className={styles.fileFacts}>
              {file.name} &middot; {formatFileSize(file.size)}
            </p>
          ) : null}
          {isCheckingFile ? <p className={styles.hint}>Checking the file...</p> : null}
          <IssueList issues={fileIssues} />
          {fileWarnings.length > 0 && !hasErrors(fileIssues) ? (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={warningsAcknowledged}
                onChange={(event) => setWarningsAcknowledged(event.target.checked)}
              />
              I have reviewed the warnings and want to continue.
            </label>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="submit"
              disabled={
                !file ||
                isCheckingFile ||
                hasErrors(fileIssues) ||
                (fileWarnings.length > 0 && !warningsAcknowledged)
              }
            >
              Next
            </button>
            <button className={styles.buttonSecondary} type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {step === 'details' ? (
        <form className={styles.form} onSubmit={handleDetailsSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-name">
              Name
            </label>
            <input
              id="model-name"
              className={styles.input}
              value={details.name}
              onChange={(event) => updateDetail('name', event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-description">
              Description
            </label>
            <textarea
              id="model-description"
              className={styles.input}
              rows={3}
              value={details.description}
              onChange={(event) => updateDetail('description', event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-category">
              Category
            </label>
            <select
              id="model-category"
              className={styles.input}
              value={details.category}
              onChange={(event) => updateDetail('category', event.target.value as AssetCategory)}
            >
              {ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {ASSET_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-world">
              World (optional)
            </label>
            <select
              id="model-world"
              className={styles.input}
              value={details.worldId}
              onChange={(event) => updateDetail('worldId', event.target.value)}
            >
              <option value="">Any world (reusable)</option>
              {WORLD_DEFINITIONS.map((world) => (
                <option key={world.slug} value={world.slug}>
                  {world.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-region">
              Region (optional)
            </label>
            <select
              id="model-region"
              className={styles.input}
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
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-source">
              Source
            </label>
            <select
              id="model-source"
              className={styles.input}
              value={details.source}
              onChange={(event) => updateDetail('source', event.target.value as AssetSource)}
            >
              {ASSET_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {ASSET_SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-source-notes">
              Source notes (optional)
            </label>
            <textarea
              id="model-source-notes"
              className={styles.input}
              rows={2}
              value={details.sourceNotes}
              onChange={(event) => updateDetail('sourceNotes', event.target.value)}
            />
            <p className={styles.hint}>
              Pack name, artist, and licence. Record the licence in docs/ASSET_LICENCES.md too.
            </p>
          </div>
          <IssueList issues={detailIssues} />
          <div className={styles.actions}>
            <button className={styles.button} type="submit">
              Upload model
            </button>
            <button
              className={styles.buttonSecondary}
              type="button"
              onClick={() => setStep('file')}
            >
              Back
            </button>
          </div>
        </form>
      ) : null}

      {step === 'upload' ? (
        <div className={styles.form}>
          {uploadState === 'uploading' ? (
            <>
              <p role="status">Uploading... {percent}%</p>
              <progress
                className={styles.progress}
                max={100}
                value={percent}
                aria-label="Upload progress"
              />
              <div className={styles.actions}>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => handleRef.current?.cancel()}
                >
                  Cancel upload
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.error} role="alert">
                {uploadError}
              </p>
              <div className={styles.actions}>
                <button className={styles.button} type="button" onClick={beginUpload}>
                  Try again
                </button>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => setStep('details')}
                >
                  Back to details
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
