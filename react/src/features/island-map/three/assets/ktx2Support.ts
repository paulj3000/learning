import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { createKtx2Loader, type Ktx2LoaderOptions, type Ktx2Renderer } from './gltfDecoders';

/**
 * One app-wide KTX2 loader for every game `GLTFLoader` (ADR-070).
 *
 * `KTX2Loader` must know the GPU it transcodes for (`detectSupport(renderer)`),
 * and its transcoder workers are expensive, so the app keeps ONE, long-lived,
 * renderer-bound and reference counted:
 *
 * - `attachKtx2Renderer(renderer)` (each location engine, right after it
 *   creates its renderer) creates the shared loader on the first attachment
 *   and only counts later ones (every renderer on a page sees the same GPU);
 *   the returned function detaches once.
 * - Every game fetcher (`assetLoader.createGltfFetcher`: the bundled loader,
 *   every `createAssetLoader`, Django published models in region play, the NPC
 *   loader) picks up `currentKtx2Loader()` immediately before each load, so a
 *   loader created before or after the attachment, single-use or cached, can
 *   decode KTX2 while any renderer is attached.
 * - The shared loader is disposed only when the last attachment is gone AND no
 *   parse is in flight (`beginParse`): a detach during a parse never strands
 *   the parse on terminated workers. Never-settling loads are bounded
 *   separately by the fetcher's timeout.
 */

interface Shared {
  loader: KTX2Loader;
  refs: number;
}

type Factory = (renderer: Ktx2Renderer, options: Ktx2LoaderOptions) => KTX2Loader;

let shared: Shared | null = null;
let inFlight = 0;
let retiring: KTX2Loader[] = [];
let factory: Factory = (renderer, options) => createKtx2Loader(renderer, options);

/** The shared KTX2 loader while a renderer is attached, else null. */
export function currentKtx2Loader(): KTX2Loader | null {
  return shared?.loader ?? null;
}

function flush(): void {
  if (inFlight > 0) return;
  const done = retiring;
  retiring = [];
  for (const loader of done) {
    try {
      loader.dispose();
    } catch (error) {
      console.warn('KTX2 loader dispose failed', error);
    }
  }
}

/**
 * Attach a live renderer. Returns the detach (idempotent). Throws only when
 * the first loader cannot be created (the caller decides whether to go on
 * without KTX2).
 */
export function attachKtx2Renderer(
  renderer: Ktx2Renderer | unknown,
  options: Ktx2LoaderOptions = {},
): () => void {
  if (shared) {
    shared.refs += 1;
  } else {
    shared = { loader: factory(renderer as Ktx2Renderer, options), refs: 1 };
  }
  const mine = shared;
  let attached = true;
  return () => {
    if (!attached) return;
    attached = false;
    mine.refs -= 1;
    if (mine.refs === 0 && shared === mine) {
      shared = null;
      retiring.push(mine.loader);
      flush();
    }
  };
}

/** Mark one parse as in flight; call the returned function once it settles. */
export function beginParse(): () => void {
  inFlight += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    inFlight -= 1;
    flush();
  };
}

/** Test and diagnostics view of the shared state. */
export function ktx2Status(): {
  attached: boolean;
  refs: number;
  inFlight: number;
  retiring: number;
} {
  return {
    attached: shared !== null,
    refs: shared?.refs ?? 0,
    inFlight,
    retiring: retiring.length,
  };
}

/** Test seam: replace the loader factory (null restores the real one) and reset all state. */
export function resetKtx2ForTests(next: Factory | null = null): void {
  shared = null;
  inFlight = 0;
  retiring = [];
  factory = next ?? ((renderer, options) => createKtx2Loader(renderer, options));
}
