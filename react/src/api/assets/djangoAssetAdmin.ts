import { API_PREFIX, errorFromEnvelope, type ApiClient } from '../client';
import { ApiError } from '../errors';

/**
 * The asset manager's administrator API on Django (AM-14, ADR-042;
 * docs/ASSET_MANAGER.md section 20).
 *
 * The browser never talks to the asset bucket: a model file goes to Django,
 * which checks, stores and records it. Nothing here knows a bucket name, an
 * object key or an AWS credential, and nothing needs Amplify Storage.
 *
 * Django authorizes every call from the Cognito access token's `Admins`
 * group. Every change (create, upload, publish, default, retire, delete) is
 * refused with `sensitive_action_unavailable` until the recent sign-in check
 * (LAI-0209) exists; `assetAdminMessage` explains that to the administrator.
 */

export const ASSET_KINDS = ['character', 'prop', 'collectible', 'kit-piece'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Which browsing categories each runtime kind accepts (Django's `KIND_CATEGORIES`). */
export const KIND_CATEGORIES: Record<AssetKind, readonly string[]> = {
  character: ['character', 'npc', 'creature'],
  prop: ['prop', 'building', 'scenery', 'vehicle', 'equipment', 'other'],
  collectible: ['collectible', 'equipment', 'prop', 'other'],
  'kit-piece': ['building', 'scenery', 'prop', 'other'],
};

export const CATEGORY_LABELS: Record<string, string> = {
  character: 'Character',
  npc: 'NPC',
  creature: 'Creature',
  prop: 'Prop',
  collectible: 'Collectible',
  building: 'Building',
  scenery: 'Scenery and environment',
  vehicle: 'Vehicle',
  equipment: 'Equipment and wearable',
  other: 'Other',
};

/** The storage key's id rule: lowercase letters and digits joined by hyphens. */
export const ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VersionStatus = 'DRAFT' | 'VALIDATED' | 'REJECTED' | 'PUBLISHED' | 'RETIRED';
const VERSION_STATUSES: readonly string[] = [
  'DRAFT',
  'VALIDATED',
  'REJECTED',
  'PUBLISHED',
  'RETIRED',
];

export interface ValidationFinding {
  code: string;
  severity: string;
  message: string;
}

export interface AdminAssetVersion {
  number: number;
  status: VersionStatus;
  originalFilename: string;
  sizeBytes: number;
  format: string;
  clips: string[];
  validationReport: ValidationFinding[];
  createdAt: string | null;
  publishedAt: string | null;
}

export interface AdminAsset {
  assetId: string;
  displayName: string;
  description: string;
  kind: string;
  category: string;
  status: 'ACTIVE' | 'RETIRED';
  origin: string;
  defaultVersion: number | null;
  versionCount: number;
  updatedAt: string | null;
}

export interface AdminAssetDetail extends AdminAsset {
  versions: AdminAssetVersion[];
  publishedReferences: number;
}

export interface NewAssetDefinition {
  assetId: string;
  displayName: string;
  description: string;
  kind: AssetKind;
  category: string;
}

// --- parsing -----------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function invalid(): never {
  throw new ApiError('invalid_response', { code: 'asset_contract' });
}

function parseFindings(value: unknown): ValidationFinding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((finding) => ({
    code: str(finding.code),
    severity: str(finding.severity),
    message: str(finding.message),
  }));
}

export function parseVersion(value: unknown): AdminAssetVersion {
  if (!isRecord(value)) return invalid();
  const number = int(value.number);
  const sizeBytes = int(value.sizeBytes);
  const status = str(value.status);
  if (number === null || sizeBytes === null || !VERSION_STATUSES.includes(status)) invalid();
  return {
    number,
    status: status as VersionStatus,
    originalFilename: str(value.originalFilename),
    sizeBytes,
    format: str(value.format),
    clips: Array.isArray(value.clips) ? value.clips.filter((c) => typeof c === 'string') : [],
    validationReport: parseFindings(value.validationReport),
    createdAt: optionalStr(value.createdAt),
    publishedAt: optionalStr(value.publishedAt),
  };
}

export function parseAsset(value: unknown): AdminAsset {
  if (!isRecord(value)) return invalid();
  const assetId = str(value.assetId);
  const status = str(value.status);
  if (!assetId || (status !== 'ACTIVE' && status !== 'RETIRED')) invalid();
  return {
    assetId,
    displayName: str(value.displayName),
    description: str(value.description),
    kind: str(value.kind),
    category: str(value.category),
    status,
    origin: str(value.origin),
    defaultVersion: int(value.defaultVersion),
    versionCount: int(value.versionCount) ?? 0,
    updatedAt: optionalStr(value.updatedAt),
  };
}

export function parseAssetDetail(value: unknown): AdminAssetDetail {
  const asset = parseAsset(value);
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.versions)) invalid();
  return {
    ...asset,
    versions: body.versions.map(parseVersion),
    publishedReferences: int(body.publishedReferences) ?? 0,
  };
}

// --- calls -------------------------------------------------------------------------------------

const ADMIN_ASSETS = 'admin/assets/';

function assetPath(assetId: string): string {
  return `${ADMIN_ASSETS}${encodeURIComponent(assetId)}/`;
}

function versionPath(assetId: string, number: number, action = ''): string {
  return `${assetPath(assetId)}versions/${number}/${action ? `${action}/` : ''}`;
}

export interface AssetAdminApi {
  listModels(signal?: AbortSignal): Promise<AdminAsset[]>;
  getAsset(assetId: string, signal?: AbortSignal): Promise<AdminAssetDetail>;
  createDefinition(definition: NewAssetDefinition): Promise<AdminAssetDetail>;
  publish(assetId: string, number: number): Promise<AdminAssetVersion>;
  makeDefault(assetId: string, number: number): Promise<AdminAssetVersion>;
  retire(assetId: string, number: number, replacement?: number): Promise<AdminAssetVersion>;
  deleteVersion(assetId: string, number: number): Promise<void>;
}

export function createAssetAdminApi(client: ApiClient): AssetAdminApi {
  return {
    async listModels(signal) {
      const { data } = await client.request('GET', ADMIN_ASSETS, { signal });
      if (!isRecord(data) || !Array.isArray(data.assets)) invalid();
      return data.assets.map(parseAsset);
    },
    async getAsset(assetId, signal) {
      const { data } = await client.request('GET', assetPath(assetId), { signal });
      return parseAssetDetail(data);
    },
    async createDefinition(definition) {
      const { data } = await client.request('POST', ADMIN_ASSETS, {
        body: { ...definition },
      });
      return parseAssetDetail(data);
    },
    async publish(assetId, number) {
      const { data } = await client.request('POST', versionPath(assetId, number, 'publish'));
      return parseVersion(data);
    },
    async makeDefault(assetId, number) {
      const { data } = await client.request('POST', versionPath(assetId, number, 'default'));
      return parseVersion(data);
    },
    async retire(assetId, number, replacement) {
      const { data } = await client.request('POST', versionPath(assetId, number, 'retire'), {
        body: replacement === undefined ? {} : { replacement },
      });
      return parseVersion(data);
    },
    async deleteVersion(assetId, number) {
      try {
        await client.request('DELETE', versionPath(assetId, number));
      } catch (error) {
        // A retry after a lost response finds the version already gone: that is success.
        if (error instanceof ApiError && error.kind === 'not_found') return;
        throw error;
      }
    },
  };
}

// --- upload, with progress ---------------------------------------------------------------------

export interface UploadProgress {
  transferredBytes: number;
  totalBytes: number;
}

export interface UploadOptions {
  baseUrl: string;
  getAccessToken: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  onProgress?: (progress: UploadProgress) => void;
  /** For tests. */
  createRequest?: () => XMLHttpRequest;
}

/** A failed upload. `existingVersion` is set when the file already is that version. */
export class AssetUploadFailure extends Error {
  readonly error: ApiError;
  readonly existingVersion: number | null;
  /** Django's validation findings for a refused model, with their severities. */
  readonly findings: ValidationFinding[];

  constructor(error: ApiError, existingVersion: number | null, findings: ValidationFinding[] = []) {
    super(error.message);
    this.name = 'AssetUploadFailure';
    this.error = error;
    this.existingVersion = existingVersion;
    this.findings = findings;
  }
}

export interface VersionUploadHandle {
  result: Promise<AdminAssetVersion>;
  cancel: () => void;
}

interface RawResponse {
  status: number;
  body: unknown;
}

/**
 * Uploads a model file as the asset's next version (multipart `file`).
 *
 * `fetch` cannot report upload progress, so this one call uses
 * `XMLHttpRequest`, with the same token handling as the API client: one
 * forced refresh after a 401. The bearer token only goes to the configured
 * API origin.
 */
export function uploadAssetVersion(
  assetId: string,
  file: File,
  options: UploadOptions,
): VersionUploadHandle {
  let current: XMLHttpRequest | null = null;
  let canceled = false;
  const url = `${options.baseUrl}${API_PREFIX}${assetPath(assetId)}versions/`;

  function send(token: string): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const request = options.createRequest?.() ?? new XMLHttpRequest();
      current = request;
      request.open('POST', url);
      request.setRequestHeader('Authorization', `Bearer ${token}`);
      request.setRequestHeader('Accept', 'application/json');
      request.upload.onprogress = (event) => {
        options.onProgress?.({
          transferredBytes: event.loaded,
          totalBytes: event.lengthComputable ? event.total : file.size,
        });
      };
      request.onload = () => {
        let body: unknown = null;
        try {
          body = request.responseText ? JSON.parse(request.responseText) : null;
        } catch {
          body = null;
        }
        resolve({ status: request.status, body });
      };
      request.onerror = () => reject(new ApiError('network'));
      request.onabort = () => reject(new ApiError('aborted'));
      const form = new FormData();
      form.append('file', file, file.name);
      request.send(form);
    });
  }

  async function token(forceRefresh: boolean): Promise<string> {
    let value: string | null;
    try {
      value = await options.getAccessToken({ forceRefresh });
    } catch {
      throw new ApiError('unauthenticated', { code: 'token_unavailable' });
    }
    if (!value) throw new ApiError('unauthenticated', { code: 'not_signed_in' });
    return value;
  }

  const result = (async () => {
    let response: RawResponse;
    try {
      response = await send(await token(false));
      if (response.status === 401 && !canceled) response = await send(await token(true));
    } catch (error) {
      throw new AssetUploadFailure(
        error instanceof ApiError ? error : new ApiError('network'),
        null,
      );
    }
    if (response.status >= 200 && response.status < 300) return parseVersion(response.body);
    const error = errorFromEnvelope(response.status, response.body);
    const details =
      isRecord(response.body) && isRecord(response.body.error) ? response.body.error.details : null;
    const existing =
      error.code === 'duplicate_version' && isRecord(details) ? int(details.version) : null;
    const findings = isRecord(details) ? parseFindings(details.findings) : [];
    throw new AssetUploadFailure(error, existing, findings);
  })();

  return {
    result,
    cancel: () => {
      canceled = true;
      current?.abort();
    },
  };
}

/** Validation findings carried by a failed request (an upload, or a publish that re-validated). */
export function findingsFrom(error: unknown): ValidationFinding[] {
  if (error instanceof AssetUploadFailure) return error.findings;
  if (!(error instanceof ApiError)) return [];
  return (error.details.findings ?? []).map((d) => ({
    code: d.code,
    severity: 'error',
    message: d.message,
  }));
}

// --- messages ----------------------------------------------------------------------------------

/** A safe, plain-language explanation of a failed asset request, for an administrator. */
export function assetAdminMessage(error: unknown): string {
  const failure = error instanceof AssetUploadFailure ? error.error : error;
  if (!(failure instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (failure.code) {
    case 'sensitive_action_unavailable':
      return 'Changing assets through this page is turned off until administrator re-authentication is available (LAI-0209). Use Django Admin for now.';
    case 'permission_denied':
      return 'Your account is not an administrator.';
    case 'invalid_model':
      return 'The model did not pass validation. See the findings below.';
    case 'duplicate_version':
      return 'This exact file is already a version of this asset.';
    case 'asset_too_large':
      return 'That file is larger than the upload limit.';
    case 'asset_exists':
      return 'An asset with this id already exists. Choose another id.';
    case 'storage_failed':
      return 'The file could not be stored. Nothing was saved. Please try again.';
    case 'validation_error':
      return 'Some details are not valid. Check the highlighted fields.';
    case 'default_in_use':
      return 'This is the default version. Make another published version the default first.';
    case 'published':
      return 'Published versions are never deleted. Retire it instead.';
    case 'not_validated':
      return 'Only a validated version can be published.';
    case 'not_published':
      return 'Only a published version can do that.';
  }
  switch (failure.kind) {
    case 'unauthenticated':
      return 'Please sign in again.';
    case 'not_found':
      return 'That asset or version no longer exists.';
    case 'aborted':
      return 'The upload was canceled. Nothing was saved.';
    case 'network':
      return 'The request did not reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
