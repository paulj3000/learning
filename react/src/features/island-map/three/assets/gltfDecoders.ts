import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
 * `KHR_meshopt_compression` is not accepted by the validators (Khronos
 * Release Candidate); three's loader would decode it, but no such model can
 * be published.
 */

/** The subset of the meshopt decoder `GLTFLoader` uses; injectable for tests. */
export type MeshoptDecoderLike = Parameters<GLTFLoader['setMeshoptDecoder']>[0];

/** The plain error the loaders surface when a compressed model cannot be decoded. */
export class CompressedModelError extends Error {
  readonly code: 'meshopt_unsupported';

  constructor(code: 'meshopt_unsupported', message: string) {
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

/** Applies every decoder this build ships to `loader`. Returns the same loader. */
export function configureGltfLoader<T extends GLTFLoader>(loader: T): T {
  return registerMeshoptDecoder(loader);
}

const MESHOPT_MISSING = /setMeshoptDecoder must be called/;

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
  return error;
}
