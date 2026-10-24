import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAssetManifestEntry } from './manifest';

/**
 * Authoring checks for Pirate Builder Bay's dock kit
 * (`scripts/generate-world-assets.ts`), in the same spirit as
 * `castleKit.test.ts`: read the generated documents off disk and assert
 * properties of the authoring rather than of the runtime.
 *
 * The one that actually bites is the single-mesh rule.
 * `createInstancedMeshFromAsset` instances only an asset's *first* mesh
 * (`assetLoader.ts`), so a multi-part crate would silently render as its
 * first part alone, everywhere it is placed - and every one of these
 * pieces is placed by instancing.
 */

const PUBLIC_DIR = resolve(process.cwd(), 'public');

interface GltfDocument {
  meshes: { primitives: unknown[] }[];
  accessors: { type: string; min?: number[]; max?: number[] }[];
}

function readGltf(id: string): GltfDocument {
  const entry = getAssetManifestEntry(id);
  return JSON.parse(
    readFileSync(join(PUBLIC_DIR, entry.url.replace(/^\//, '')), 'utf8'),
  ) as GltfDocument;
}

function meshSpaceBounds(document: GltfDocument): { minY: number; maxY: number } {
  const ys = document.accessors
    .filter((accessor) => accessor.type === 'VEC3' && accessor.min && accessor.max)
    .flatMap((accessor) => [accessor.min![1], accessor.max![1]]);
  return { minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('Pirate Builder Bay dock kit', () => {
  it.each(['crate', 'barrel', 'mooring-post'])(
    'authors %s as a single mesh, so instancing places all of it',
    (id) => {
      const document = readGltf(id);
      expect(document.meshes).toHaveLength(1);
      expect(document.meshes[0].primitives).toHaveLength(1);
    },
  );

  it.each(['crate', 'barrel', 'mooring-post'])(
    'ground-pivots %s, so a placement at y=0 sits on the sand',
    (id) => {
      expect(meshSpaceBounds(readGltf(id)).minY).toBeCloseTo(0);
    },
  );

  /** The cove's landmark has to read as a wreck from across the channel, roughly 6m away. */
  it('makes the shipwreck a multi-part piece tall enough to be a landmark', () => {
    const document = readGltf('shipwreck');
    expect(document.meshes.length).toBeGreaterThan(1);
    expect(meshSpaceBounds(document).maxY).toBeGreaterThan(3);
  });

  it('keeps a crate small enough for a child to read as cargo, not architecture', () => {
    const { maxY } = meshSpaceBounds(readGltf('crate'));
    expect(maxY).toBeGreaterThan(0.5);
    expect(maxY).toBeLessThan(1.2);
  });
});
