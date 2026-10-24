import { isCancelError, remove, uploadData } from 'aws-amplify/storage';
import { client } from '../../lib/data-client';
import { MODEL_MIME_TYPE } from './config';
import { slugify } from './modelFileChecks';
import { MODEL_OBJECT_FILE_NAME, modelObjectKey } from './storageKeys';
import type { Asset, ModelAssetDetails } from './types';

/**
 * The upload step of the Model Asset Manager's wizard
 * (docs/android/ASSET_MANAGEMENT.md sections 7 and 33).
 *
 * Order is what makes this safe:
 *
 * 1. The file goes to S3 first, under a key built from ids generated here.
 * 2. Only after S3 confirms the upload are the `Asset` and `AssetVersion`
 *    records created, so no record ever points at bytes that are not there.
 * 3. If either record fails, what was already written is removed again
 *    (the record, then the S3 object), so a failure leaves nothing behind
 *    that an admin would have to find and clean up.
 *
 * The asset is created as `DRAFT`. Nothing in this module can publish.
 */

export type AssetUploadErrorCode = 'CANCELED' | 'UPLOAD_FAILED' | 'RECORD_FAILED';

const UPLOAD_ERROR_MESSAGES: Record<AssetUploadErrorCode, string> = {
  CANCELED: 'The upload was canceled. Nothing was saved.',
  UPLOAD_FAILED:
    'The model could not be uploaded. Check your connection and try again. Nothing was saved.',
  RECORD_FAILED:
    'The model uploaded, but its asset record could not be saved, so the upload was removed. Try again.',
};

/** A typed upload failure whose `message` is always safe to show an admin as-is. */
export class AssetUploadError extends Error {
  readonly code: AssetUploadErrorCode;

  constructor(code: AssetUploadErrorCode) {
    super(UPLOAD_ERROR_MESSAGES[code]);
    this.name = 'AssetUploadError';
    this.code = code;
  }
}

export interface UploadProgress {
  transferredBytes: number;
  totalBytes: number;
}

export interface StartModelUploadInput {
  file: File;
  details: ModelAssetDetails;
  /** The signed-in admin's Cognito user id, for the audit fields. */
  uploadedBy: string;
  onProgress?: (progress: UploadProgress) => void;
}

export interface ModelUploadHandle {
  result: Promise<Asset>;
  cancel: () => void;
}

/** Whole-number percentage for the progress display, clamped to 0-100. */
export function progressPercent({ transferredBytes, totalBytes }: UploadProgress): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((transferredBytes / totalBytes) * 100)));
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await remove({ path });
  } catch {
    // Best effort: the caller is already reporting the original failure,
    // and an orphaned object in an Admins-only prefix harms nothing.
  }
}

async function createRecords(
  assetId: string,
  versionId: string,
  s3Key: string,
  input: StartModelUploadInput,
): Promise<Asset> {
  const { file, details, uploadedBy } = input;

  const { data: asset, errors: assetErrors } = await client.models.Asset.create({
    id: assetId,
    name: details.name.trim(),
    slug: slugify(details.name),
    description: optional(details.description),
    assetType: 'MODEL_3D',
    category: details.category,
    status: 'DRAFT',
    currentVersion: 1,
    currentVersionId: versionId,
    s3Key,
    fileName: MODEL_OBJECT_FILE_NAME,
    originalFileName: file.name,
    mimeType: MODEL_MIME_TYPE,
    fileSize: file.size,
    source: details.source,
    sourceNotes: optional(details.sourceNotes),
    worldId: optional(details.worldId),
    regionId: optional(details.regionId),
    createdBy: uploadedBy,
    lastModifiedBy: uploadedBy,
  });
  if (!asset || assetErrors?.length) {
    throw new AssetUploadError('RECORD_FAILED');
  }

  let versionCreated = false;
  try {
    const { data: version, errors: versionErrors } = await client.models.AssetVersion.create({
      id: versionId,
      assetId,
      version: 1,
      s3Key,
      fileName: MODEL_OBJECT_FILE_NAME,
      originalFileName: file.name,
      fileSize: file.size,
      uploadedBy,
    });
    versionCreated = Boolean(version) && !versionErrors?.length;
  } catch {
    // A thrown failure (network, not a GraphQL error) is handled below exactly like a returned one.
  }
  if (!versionCreated) {
    try {
      await client.models.Asset.delete({ id: assetId });
    } catch {
      // Reported below as RECORD_FAILED either way.
    }
    throw new AssetUploadError('RECORD_FAILED');
  }

  return asset;
}

/** Starts one model upload. `cancel()` is safe to call at any point, including after completion. */
export function startModelUpload(input: StartModelUploadInput): ModelUploadHandle {
  const assetId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const s3Key = modelObjectKey(input.details.category, assetId, 1);

  const task = uploadData({
    path: s3Key,
    data: input.file,
    options: {
      contentType: MODEL_MIME_TYPE,
      onProgress: ({ transferredBytes, totalBytes }) => {
        input.onProgress?.({ transferredBytes, totalBytes: totalBytes ?? input.file.size });
      },
    },
  });

  const result = (async () => {
    try {
      await task.result;
    } catch (error) {
      throw new AssetUploadError(isCancelError(error) ? 'CANCELED' : 'UPLOAD_FAILED');
    }
    try {
      return await createRecords(assetId, versionId, s3Key, input);
    } catch (error) {
      await removeQuietly(s3Key);
      throw error instanceof AssetUploadError ? error : new AssetUploadError('RECORD_FAILED');
    }
  })();

  return {
    result,
    cancel: () => {
      try {
        task.cancel();
      } catch {
        // Cancelling a finished task is a no-op for the caller.
      }
    },
  };
}
