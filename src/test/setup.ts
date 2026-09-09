import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';

/**
 * A narrow `fetch` override for `docs/ROADMAP.md` Phase 34's asset loader
 * tests: intercepts `/models/*.gltf` and `/models/*.glb` requests (the only
 * real, external, checked-in assets this codebase loads) and serves them
 * from disk, so `assetLoader.test.ts` can exercise the real
 * `GLTFLoader.load()` (fetch-based) path against real files instead of only
 * the `GLTFLoader.parse()` path every other glTF test uses. Everything else
 * passes through to the real `fetch` Vitest's jsdom environment already
 * provides. See `docs/THREE_WORLD_ASSET_CONVENTIONS.md` for why this
 * exists instead of mocking `GLTFLoader` itself.
 *
 * `.glb` arrived with the first imported (rather than generated) assets -
 * see `docs/ASSET_LICENCES.md`. A GLB is binary and carries its texture
 * inside itself, so it is read as a `Buffer` and never decoded as utf-8;
 * `stubImageDecoding` below is the other half of making one loadable here.
 */
const PUBLIC_DIR = resolve(process.cwd(), 'public');
const realFetch = globalThis.fetch?.bind(globalThis);

/**
 * The texture test path ADR-020 named as the prerequisite for the first
 * textured asset, built here because that asset has now landed.
 *
 * A GLB carries its texture as a `bufferView` PNG. `GLTFLoader` turns that
 * into a `Blob`, takes an object URL for it, and hands the URL to
 * `ImageLoader`, which sets `img.src` and waits for a `load` event. jsdom
 * has no image decoder, so that event never fires and the whole
 * `GLTFLoader.load()` promise hangs rather than failing - which is what a
 * textured file does to `assetLoader.test.ts` without this.
 *
 * These two stubs let the image half resolve so the rest of the round trip
 * stays under test. **What this proves and does not prove:** it proves the
 * file is fetched, its container parsed, its `bufferView` image found, and
 * its material and texture wired onto the mesh. It does not prove the PNG
 * bytes decode to a valid image - jsdom cannot rasterise one at any level
 * of effort, so that check belongs to a browser (Playwright) run, not here.
 */
function stubImageDecoding(): void {
  if (typeof URL.createObjectURL !== 'function') {
    let nextId = 0;
    URL.createObjectURL = () => `blob:asset-test/${(nextId += 1)}`;
    URL.revokeObjectURL = () => {};
  }

  const imagePrototype = globalThis.HTMLImageElement?.prototype;
  if (!imagePrototype) return;
  Object.defineProperty(imagePrototype, 'src', {
    configurable: true,
    enumerable: true,
    get(this: HTMLImageElement) {
      return this.getAttribute('src') ?? '';
    },
    set(this: HTMLImageElement, value: string) {
      this.setAttribute('src', value);
      queueMicrotask(() => this.dispatchEvent(new Event('load')));
    },
  });
}

stubImageDecoding();

/** A jsdom-realm `ArrayBuffer` holding `bytes`, so `instanceof ArrayBuffer` holds inside `GLTFLoader.parse()` (which is exactly how it tells JSON from binary GLB). A Node-realm `Buffer.buffer` fails that check. */
function toLocalArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const local = new Uint8Array(bytes.length);
  local.set(bytes);
  return local.buffer;
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  const pathname = new URL(requestUrl, 'http://localhost/').pathname;

  if (pathname.startsWith('/models/') && /\.(gltf|glb)$/.test(pathname)) {
    const filePath = resolve(PUBLIC_DIR, pathname.slice(1));
    const bytes = readFileSync(filePath);
    // Only a `.gltf` document is text; decoding a `.glb`'s binary chunk as
    // utf-8 would corrupt it, so `text`/`json` are refused for one.
    const asText = () => {
      if (pathname.endsWith('.glb')) {
        throw new Error(`${pathname} is binary glTF and has no text form`);
      }
      return bytes.toString('utf-8');
    };
    return {
      status: 200,
      statusText: 'OK',
      url: requestUrl,
      body: undefined,
      headers: { get: () => null },
      text: async () => asText(),
      json: async () => JSON.parse(asText()) as unknown,
      arrayBuffer: async () => toLocalArrayBuffer(bytes),
    } as unknown as Response;
  }

  if (!realFetch) {
    throw new Error(`no real fetch available to handle ${requestUrl}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
