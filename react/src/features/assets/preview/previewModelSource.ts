import { LoadingManager, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Fetching and parsing a model for the Django Admin preview (LAI-2200 AM-10,
 * `docs/ASSET_MANAGER.md` section 17). The preview page is server-rendered by
 * Django; this module only turns its staff-only file route into a parsed
 * scene, or into a `PreviewError` an administrator can read.
 *
 * The bytes are fetched here, not by `GLTFLoader.load()`, so the short-lived
 * preview token travels in a request header (never in a URL) and each refusal
 * from the server keeps its meaning.
 */

export type PreviewErrorCode =
  | 'forbidden'
  | 'missing'
  | 'expired'
  | 'not_previewable'
  | 'too_large'
  | 'checksum_mismatch'
  | 'storage'
  | 'network'
  | 'unsupported_format'
  | 'invalid_model'
  | 'empty_model'
  | 'webgl_unavailable';

const MESSAGES: Record<PreviewErrorCode, string> = {
  forbidden: 'You do not have access to model previews. Sign in again with a staff account.',
  missing: 'This model version was not found. It may have been deleted.',
  expired: 'This preview has expired. Reload the page to view the model.',
  not_previewable: 'This version cannot be previewed in its current state.',
  too_large: 'This model is larger than the upload limit, so it is not previewed.',
  checksum_mismatch: 'The stored file does not match its recorded checksum, so it is not shown.',
  storage: 'The stored file could not be read. Try again later.',
  network: 'The model could not be downloaded. Check your connection and reload the page.',
  unsupported_format: 'Only .glb and self-contained .gltf models can be previewed.',
  invalid_model: 'The file could not be read as a glTF 2.0 model.',
  empty_model: 'The model has no visible geometry to show.',
  webgl_unavailable: 'This browser cannot show 3D graphics (WebGL is unavailable or disabled).',
};

/** A failure with a fixed, safe message. Never carries a stack trace or server detail to the page. */
export class PreviewError extends Error {
  readonly code: PreviewErrorCode;

  constructor(code: PreviewErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PreviewError';
    this.code = code;
  }
}

export function toPreviewError(error: unknown, fallback: PreviewErrorCode): PreviewError {
  return error instanceof PreviewError ? error : new PreviewError(fallback);
}

export type PreviewFormat = 'glb' | 'gltf';

export function isPreviewFormat(value: string | undefined): value is PreviewFormat {
  return value === 'glb' || value === 'gltf';
}

export interface FetchPreviewModelOptions {
  url: string;
  tokenHeader: string;
  token: string;
  /** The upload limit; a response larger than this is refused before it is parsed. */
  maxBytes: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const STATUS_CODES: Record<number, PreviewErrorCode> = {
  401: 'forbidden',
  403: 'forbidden',
  404: 'missing',
  409: 'not_previewable',
  410: 'expired',
  413: 'too_large',
  503: 'storage',
};

/** The server's error code when it sent one (`{"error": {"code": ...}}`), else null. */
async function serverCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const error = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

export async function fetchPreviewModel(options: FetchPreviewModelOptions): Promise<ArrayBuffer> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error', // an expired session redirects to the login page: treat it as refused
      headers: { [options.tokenHeader]: options.token },
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new PreviewError('network');
  }
  if (!response.ok) {
    const code = await serverCode(response);
    if (code === 'checksum_mismatch') throw new PreviewError('checksum_mismatch');
    if (code === 'too_large') throw new PreviewError('too_large');
    throw new PreviewError(STATUS_CODES[response.status] ?? 'storage');
  }
  const declared = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    throw new PreviewError('too_large');
  }
  let data: ArrayBuffer;
  try {
    data = await response.arrayBuffer();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new PreviewError('network');
  }
  if (data.byteLength > options.maxBytes) throw new PreviewError('too_large');
  return data;
}

const GLB_MAGIC = 0x46546c67; // "glTF", little-endian

/** The format the bytes are, by content (as the server decides it), or null for anything else. */
export function sniffFormat(data: ArrayBuffer): PreviewFormat | null {
  if (data.byteLength >= 12 && new DataView(data).getUint32(0, true) === GLB_MAGIC) return 'glb';
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(data.byteLength, 64)));
  return head.trimStart().startsWith('{') ? 'gltf' : null;
}

/** Only resources embedded in the file itself: `data:` URIs, and the `blob:` URLs GLTFLoader makes for GLB images. */
function isEmbedded(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

/**
 * Parses validated bytes into a scene. The file must be the format the server
 * recorded. A reference to anything outside the file is refused rather than
 * fetched (validation already forbids them; this keeps the browser from ever
 * following one).
 */
export async function parsePreviewModel(
  data: ArrayBuffer,
  format: PreviewFormat,
): Promise<{ scene: Object3D; clipNames: string[] }> {
  if (sniffFormat(data) !== format) throw new PreviewError('invalid_model');
  let external = false;
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (isEmbedded(url)) return url;
    external = true;
    return 'data:application/octet-stream;base64,';
  });
  const loader = new GLTFLoader(manager);
  let gltf;
  try {
    gltf = await loader.parseAsync(data, '');
  } catch {
    throw new PreviewError('invalid_model');
  }
  if (external) throw new PreviewError('invalid_model');
  return { scene: gltf.scene, clipNames: gltf.animations.map((clip) => clip.name) };
}
