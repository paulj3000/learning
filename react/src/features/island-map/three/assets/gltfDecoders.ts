import { LoadingManager, type WebGLRenderer } from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import basisTranscoderJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import basisTranscoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';

/**
 * Decoder configuration for every `GLTFLoader` the app builds (ADR-070).
 *
 * Meshopt (`EXT_meshopt_compression`): the decoder is three's own
 * `meshopt_decoder.module.js`, bundled by Vite with its WASM embedded in the
 * module (no separate file, no CDN, no extra request). It is registered on
 * every loader, unconditionally: a loader that can decode is the prerequisite
 * for the server ever accepting a compressed model (the compatibility-gated
 * release, ADR-071), and an uncompressed GLB never touches it. Whether staff
 * may upload and publish Meshopt models is decided server side by
 * `LAI_GLB_MESHOPT` (default off), not here.
 *
 * KTX2 (`KHR_texture_basisu`): `KTX2Loader` needs the live renderer to pick a
 * GPU format (`detectSupport`), so it is attached when a renderer exists
 * (`createKtx2Loader`, used by `assetLoader.enableKtx2Textures`). The Basis
 * transcoder (`basis_transcoder.js` + `.wasm`, from the installed three) is
 * bundled by Vite through `?url` imports: hashed, same origin, no CDN. It is
 * downloaded only when a KTX2 texture is first decoded. Server side,
 * `LAI_GLB_KTX2` (default off) decides whether such models exist at all.
 *
 * `KHR_meshopt_compression` is not accepted by the validators (Khronos
 * Release Candidate); three's loader would decode it, but no such model can
 * be published.
 */

/** The subset of the meshopt decoder `GLTFLoader` uses; injectable for tests. */
export type MeshoptDecoderLike = Parameters<GLTFLoader['setMeshoptDecoder']>[0];

export type CompressedModelErrorCode = 'meshopt_unsupported' | 'ktx2_unavailable';

/** The plain error the loaders surface when a compressed model cannot be decoded. */
export class CompressedModelError extends Error {
  readonly code: CompressedModelErrorCode;

  constructor(code: CompressedModelErrorCode, message: string) {
    super(message);
    this.name = 'CompressedModelError';
    this.code = code;
  }
}

/** True when the browser can run the decoder (WebAssembly present). */
export function meshoptSupported(decoder: MeshoptDecoderLike = MeshoptDecoder): boolean {
  return Boolean((decoder as { supported?: boolean }).supported);
}

/**
 * Registers the Meshopt decoder on `loader` and returns it. When the browser
 * cannot run WebAssembly the decoder reports `supported: false`; it is still
 * registered, so `GLTFLoader` refuses a model that *requires* the extension
 * with its own message, which `describeGltfLoadError` turns into a clear one.
 */
export function registerMeshoptDecoder<T extends GLTFLoader>(
  loader: T,
  decoder: MeshoptDecoderLike = MeshoptDecoder,
): T {
  loader.setMeshoptDecoder(decoder);
  return loader;
}

export interface GltfLoaderDecoders {
  /** A ready `KTX2Loader` (from `createKtx2Loader`), or null for none yet. */
  ktx2?: KTX2Loader | null;
}

/** Applies every decoder this build ships to `loader`. Returns the same loader. */
export function configureGltfLoader<T extends GLTFLoader>(
  loader: T,
  decoders: GltfLoaderDecoders = {},
): T {
  registerMeshoptDecoder(loader);
  if (decoders.ktx2 !== undefined) loader.setKTX2Loader(decoders.ktx2);
  return loader;
}

/** The transcoder file names `KTX2Loader` requests, mapped to the bundled URLs. */
export const BASIS_TRANSCODER_URLS: Readonly<Record<string, string>> = {
  'basis_transcoder.js': basisTranscoderJsUrl,
  'basis_transcoder.wasm': basisTranscoderWasmUrl,
};

/** A path no real file lives under; only the URL modifier below resolves it. */
export const BASIS_TRANSCODER_PATH = '/__lai_basis_transcoder__/';

/**
 * Maps `KTX2Loader`'s fixed transcoder file names to the bundled, hashed
 * URLs, and lets texture data (`blob:` / `data:` URLs that GLTFLoader makes
 * for embedded images) through. Any other URL is refused, so a KTX2 loader
 * can never be used to fetch an external texture.
 */
export function ktx2UrlModifier(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (url.startsWith(BASIS_TRANSCODER_PATH)) {
    const name = url.slice(BASIS_TRANSCODER_PATH.length);
    const mapped = BASIS_TRANSCODER_URLS[name];
    if (mapped) return mapped;
  }
  return 'data:application/octet-stream;base64,';
}

/** What `KTX2Loader.detectSupport` needs; the live `WebGLRenderer` in the app. */
export type Ktx2Renderer = Parameters<KTX2Loader['detectSupport']>[0];

export interface Ktx2LoaderOptions {
  /** Transcoder workers; each holds its own WASM instance, so tablets keep this small. */
  workerLimit?: number;
  /** Test seam: the loader class. */
  create?: (manager: LoadingManager) => KTX2Loader;
}

/**
 * A `KTX2Loader` configured for this app: bundled transcoder, at most two
 * workers, GPU format chosen from `renderer` (ASTC, ETC2, BC7, ...; RGBA8
 * when the device exposes none). Call `dispose()` when the renderer goes.
 */
export function createKtx2Loader(
  renderer: Ktx2Renderer | WebGLRenderer,
  options: Ktx2LoaderOptions = {},
): KTX2Loader {
  const manager = new LoadingManager();
  manager.setURLModifier(ktx2UrlModifier);
  const loader = options.create ? options.create(manager) : new KTX2Loader(manager);
  loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
  loader.setWorkerLimit(options.workerLimit ?? 2);
  loader.detectSupport(renderer as Ktx2Renderer);
  return loader;
}

const MESHOPT_MISSING = /setMeshoptDecoder must be called/;
const KTX2_MISSING = /setKTX2Loader must be called/;

/**
 * Turns `GLTFLoader`'s decoder messages into a typed, readable error. Any
 * other error is returned unchanged.
 */
export function describeGltfLoadError(error: Error): Error {
  if (MESHOPT_MISSING.test(error.message)) {
    return new CompressedModelError(
      'meshopt_unsupported',
      'This model uses Meshopt compression, which this browser cannot decode (WebAssembly is unavailable).',
    );
  }
  if (KTX2_MISSING.test(error.message)) {
    return new CompressedModelError(
      'ktx2_unavailable',
      'This model uses KTX2 textures, which need the 3D view to be ready before the model loads.',
    );
  }
  return error;
}
