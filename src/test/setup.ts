import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';

/**
 * A narrow `fetch` override for `docs/ROADMAP.md` Phase 34's asset loader
 * tests: intercepts `/models/*.gltf` requests (the only real, external,
 * checked-in assets this codebase loads) and serves them from disk, so
 * `assetLoader.test.ts` can exercise the real `GLTFLoader.load()`
 * (fetch-based) path against real generated files instead of only the
 * `GLTFLoader.parse()` path every other glTF test uses. Everything else
 * passes through to the real `fetch` Vitest's jsdom environment already
 * provides. See `docs/THREE_WORLD_ASSET_CONVENTIONS.md` for why this
 * exists instead of mocking `GLTFLoader` itself.
 */
const PUBLIC_DIR = resolve(process.cwd(), 'public');
const realFetch = globalThis.fetch?.bind(globalThis);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  const pathname = new URL(requestUrl, 'http://localhost/').pathname;

  if (pathname.startsWith('/models/') && pathname.endsWith('.gltf')) {
    const text = readFileSync(resolve(PUBLIC_DIR, pathname.slice(1)), 'utf-8');
    return {
      status: 200,
      statusText: 'OK',
      url: requestUrl,
      body: undefined,
      headers: { get: () => null },
      text: async () => text,
      json: async () => JSON.parse(text) as unknown,
      // `TextEncoder.encode(...).buffer` is a Node-realm ArrayBuffer, which
      // fails `instanceof ArrayBuffer` inside jsdom-realm code (this is
      // exactly what `GLTFLoader.parse()` checks to tell JSON from binary
      // GLB) - copying into a `Uint8Array` constructed from this module's
      // own (jsdom) realm fixes the identity.
      arrayBuffer: async () => {
        const encoded = new TextEncoder().encode(text);
        const local = new Uint8Array(encoded.length);
        local.set(encoded);
        return local.buffer;
      },
    } as unknown as Response;
  }

  if (!realFetch) {
    throw new Error(`no real fetch available to handle ${requestUrl}`);
  }
  return realFetch(input, init);
}) as typeof fetch;
