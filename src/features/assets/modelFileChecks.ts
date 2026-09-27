import {
  MODEL_FILE_EXTENSION,
  MODEL_MAX_UPLOAD_BYTES,
  MODEL_MAX_UPLOAD_MB,
  MODEL_WARN_UPLOAD_BYTES,
  MODEL_WARN_UPLOAD_MB,
  formatFileSize,
} from './config';
import type { Asset, ModelAssetDetails } from './types';

/**
 * Pre-upload checks for the Model Asset Manager's wizard
 * (docs/android/ASSET_MANAGEMENT.md sections 7 and 25). Pure functions over
 * plain facts, so every rule is testable without a browser `File` or a
 * backend.
 *
 * These are the cheap checks that run before a single byte goes to S3:
 * extension, size, and the 12-byte GLB header. Whether Three.js can
 * actually load the model (scenes, geometry, textures, rig) is Phase 3's
 * GLTFLoader validation, which runs after upload.
 *
 * `error` blocks the upload. `warning` needs the admin's explicit
 * acknowledgement in the wizard, then allows it.
 */

export type CheckSeverity = 'error' | 'warning';

export interface CheckIssue {
  code: string;
  severity: CheckSeverity;
  message: string;
}

export interface ModelFileFacts {
  fileName: string;
  size: number;
  /** The file's first 12 bytes (or fewer, for a tiny file). */
  header: Uint8Array;
}

export const GLB_HEADER_BYTES = 12;
/** "glTF" read as a little-endian uint32 (glTF 2.0 spec, section 4.4.2). */
const GLB_MAGIC = 0x46546c67;
const SUPPORTED_GLB_VERSION = 2;

type ExistingAsset = Pick<Asset, 'id' | 'name' | 'slug' | 'originalFileName'>;

export function hasErrors(issues: readonly CheckIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function warningsOf(issues: readonly CheckIssue[]): CheckIssue[] {
  return issues.filter((issue) => issue.severity === 'warning');
}

function checkGlbHeader(header: Uint8Array, size: number): CheckIssue | null {
  if (header.length < GLB_HEADER_BYTES) {
    return {
      code: 'NOT_GLB',
      severity: 'error',
      message: 'This file is too small to be a GLB model. It may be empty or damaged.',
    };
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return {
      code: 'NOT_GLB',
      severity: 'error',
      message:
        'This file is not a valid GLB model: it does not start with the glTF binary header. Export it from Blender as "glTF Binary (.glb)".',
    };
  }
  const version = view.getUint32(4, true);
  if (version !== SUPPORTED_GLB_VERSION) {
    return {
      code: 'UNSUPPORTED_GLB_VERSION',
      severity: 'error',
      message: `This model uses glTF version ${version}. Only glTF 2.0 models can be uploaded.`,
    };
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== size) {
    return {
      code: 'GLB_LENGTH_MISMATCH',
      severity: 'error',
      message: `This model looks damaged or cut short: its header says ${formatFileSize(declaredLength)}, but the file is ${formatFileSize(size)}.`,
    };
  }
  return null;
}

/** Checks a chosen file before upload. `existing` is every current model asset, for the duplicate check. */
export function checkModelFile(
  facts: ModelFileFacts,
  existing: readonly ExistingAsset[],
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  if (!facts.fileName.toLowerCase().endsWith(MODEL_FILE_EXTENSION)) {
    issues.push({
      code: 'WRONG_EXTENSION',
      severity: 'error',
      message:
        'Only .glb files can be uploaded. Export the model from Blender as "glTF Binary (.glb)".',
    });
    return issues;
  }

  if (facts.size === 0) {
    issues.push({ code: 'EMPTY_FILE', severity: 'error', message: 'This file is empty.' });
    return issues;
  }

  if (facts.size > MODEL_MAX_UPLOAD_BYTES) {
    issues.push({
      code: 'TOO_LARGE',
      severity: 'error',
      message: `This model is ${formatFileSize(facts.size)}. The upload limit is ${MODEL_MAX_UPLOAD_MB} MB. Reduce texture sizes or polygon count and export again.`,
    });
    return issues;
  }

  const headerIssue = checkGlbHeader(facts.header, facts.size);
  if (headerIssue) {
    issues.push(headerIssue);
    return issues;
  }

  if (facts.size > MODEL_WARN_UPLOAD_BYTES) {
    issues.push({
      code: 'LARGE_FILE',
      severity: 'warning',
      message: `This model is ${formatFileSize(facts.size)}, above the ${MODEL_WARN_UPLOAD_MB} MB recommendation. Large models load slowly on children's tablets.`,
    });
  }

  const sameFile = existing.find(
    (asset) => asset.originalFileName.toLowerCase() === facts.fileName.toLowerCase(),
  );
  if (sameFile) {
    issues.push({
      code: 'DUPLICATE_FILE_NAME',
      severity: 'warning',
      message: `A file named ${facts.fileName} was already uploaded as "${sameFile.name}". If this is a newer version of that model, replace it there instead of creating a second asset.`,
    });
  }

  return issues;
}

/** Turns a display name into a URL- and id-safe slug, e.g. "Pirate Captain (v3)" -> "pirate-captain-v3". */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

export const MODEL_NAME_MAX_LENGTH = 80;

/** Checks the wizard's details step. The slug must be unique, since game content may look an asset up by it. */
export function checkModelDetails(
  details: Pick<ModelAssetDetails, 'name'>,
  existing: readonly ExistingAsset[],
): CheckIssue[] {
  const name = details.name.trim();
  if (!name) {
    return [{ code: 'NAME_REQUIRED', severity: 'error', message: 'Give the model a name.' }];
  }
  if (name.length > MODEL_NAME_MAX_LENGTH) {
    return [
      {
        code: 'NAME_TOO_LONG',
        severity: 'error',
        message: `Keep the name to ${MODEL_NAME_MAX_LENGTH} characters or fewer.`,
      },
    ];
  }
  const slug = slugify(name);
  if (!slug) {
    return [
      {
        code: 'NAME_NEEDS_LETTERS',
        severity: 'error',
        message: 'The name needs at least one letter or number.',
      },
    ];
  }
  const clash = existing.find((asset) => asset.slug === slug);
  if (clash) {
    return [
      {
        code: 'DUPLICATE_SLUG',
        severity: 'error',
        message: `The name "${name}" is too close to the existing asset "${clash.name}". Choose a different name.`,
      },
    ];
  }
  return [];
}
