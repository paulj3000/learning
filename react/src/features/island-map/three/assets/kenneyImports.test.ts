import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAssetManifestEntry } from './manifest';

/**
 * The import contract for the Kenney CC0 nature props that
 * `scripts/import-kenney-assets.ts` produces - the shared-kit counterpart
 * to `describe('imported castle kit')` in `castleKit.test.ts`.
 *
 * These assets break the generated kit's conventions in exactly one way
 * (they carry a texture atlas, where a generated asset carries none), and
 * hold to every other one, so they get their own checks rather than a
 * loosening of the generated kit's. What they must not do is drift: a
 * re-import that changes the source model, the scale rule or the texture
 * packing has to fail here rather than in a browser.
 *
 * The fit checks deliberately re-derive the rule from the generated file
 * still on disk instead of hard-coding measurements. The generated
 * originals are the revert path - the swap is one manifest url each - so
 * if one of them is ever re-authored, the import must be re-fitted to it,
 * and this test is what says so.
 */

const PUBLIC_DIR = resolve(process.cwd(), 'public');

interface GltfDocument {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: {
    children?: number[];
    mesh?: number;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  accessors: { type: string; min?: number[]; max?: number[] }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  materials?: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }[];
  extensionsRequired?: string[];
}

/** Reads either form off disk: generated `.gltf` JSON, or an imported `.glb`'s JSON chunk. */
function readDocument(relativeUrl: string): GltfDocument {
  const filePath = join(PUBLIC_DIR, relativeUrl.replace(/^\//, ''));
  if (!relativeUrl.endsWith('.glb')) {
    return JSON.parse(readFileSync(filePath, 'utf8')) as GltfDocument;
  }
  const binary = readFileSync(filePath);
  const jsonChunkLength = binary.readUInt32LE(12);
  return JSON.parse(binary.subarray(20, 20 + jsonChunkLength).toString('utf8')) as GltfDocument;
}

function readImported(id: string): GltfDocument {
  return readDocument(getAssetManifestEntry(id).url);
}

/** Column-major 4x4 multiply, glTF's convention. */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) {
        out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
      }
    }
  }
  return out;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function localMatrix(node: GltfDocument['nodes'][number]): number[] {
  if (node.matrix) {
    return node.matrix;
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [x2, y2, z2] = [qx + qx, qy + qy, qz + qz];
  const [xx, xy, xz] = [qx * x2, qx * y2, qx * z2];
  const [yy, yz, zz] = [qy * y2, qy * z2, qz * z2];
  const [wx, wy, wz] = [qw * x2, qw * y2, qw * z2];
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * The **world-space** bounding box: POSITION accessor extents pushed
 * through each node's transform.
 *
 * Two details this cannot skip. POSITION-only, because NORMAL and TANGENT
 * are `VEC3` too and span [-1, 1] on every axis, so filtering on type
 * alone measures the unit cube instead of the model. And node transforms,
 * because `foliage-tree.gltf` is a trunk and a canopy at authored offsets:
 * its accessor extents are each part's own local box, and reading those as
 * the tree's size understates it. All eight corners are transformed, not
 * just min and max, since a rotation can move any of them outward.
 */
function boundingBox(document: GltfDocument): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (index: number, parent: number[]): void => {
    const node = document.nodes[index];
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of document.meshes[node.mesh].primitives) {
        const accessor = document.accessors[primitive.attributes.POSITION];
        if (!accessor?.min || !accessor.max) {
          continue;
        }
        for (let corner = 0; corner < 8; corner++) {
          const local = [
            corner & 1 ? accessor.max[0] : accessor.min[0],
            corner & 2 ? accessor.max[1] : accessor.min[1],
            corner & 4 ? accessor.max[2] : accessor.min[2],
          ];
          for (let axis = 0; axis < 3; axis++) {
            const value =
              world[axis] * local[0] +
              world[4 + axis] * local[1] +
              world[8 + axis] * local[2] +
              world[12 + axis];
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
        }
      }
    }
    for (const child of node.children ?? []) {
      visit(child, world);
    }
  };

  for (const index of document.scenes[document.scene ?? 0].nodes) {
    visit(index, IDENTITY);
  }
  return { min, max };
}

function size(document: GltfDocument): number[] {
  const { min, max } = boundingBox(document);
  return [0, 1, 2].map((index) => max[index] - min[index]);
}

/**
 * Each Kenney import, the manifest id it serves, and the generated file it
 * was fitted against. Both tree levels are fitted to the *near* level's
 * box: the collider belongs to the tree, not to the detail level, and one
 * shared box is what lands both at the same height.
 */
const IMPORTS: readonly { id: string; fittedTo: string }[] = [
  { id: 'rock', fittedTo: '/models/rock.gltf' },
  { id: 'foliage-tree', fittedTo: '/models/foliage-tree.gltf' },
  { id: 'foliage-tree-lod1', fittedTo: '/models/foliage-tree.gltf' },
];

const AXIS_NAMES = ['x', 'y', 'z'];

describe('imported Kenney nature props', () => {
  it('is what the manifest actually points at, so this file cannot pass while testing nothing', () => {
    for (const { id } of IMPORTS) {
      expect(getAssetManifestEntry(id).url, `"${id}" is no longer a Kenney import`).toMatch(
        /^\/models\/kenney-[a-z-]+\.glb$/,
      );
    }
  });

  it('fits inside the box of the generated asset it replaces, on every axis', () => {
    for (const { id, fittedTo } of IMPORTS) {
      const imported = size(readImported(id));
      const generated = size(readDocument(fittedTo));
      for (let axis = 0; axis < 3; axis++) {
        // A mesh larger than the generated original would poke out of the
        // `RectZone` collider authored around that original, which is the
        // one way a pure art swap can change where a child appears to be
        // able to walk.
        expect(
          imported[axis],
          `"${id}" is wider than ${fittedTo} on ${AXIS_NAMES[axis]}`,
        ).toBeLessThanOrEqual(generated[axis] + 1e-3);
      }
    }
  });

  it('is scaled up as far as that box allows, so the fit is tight on one axis', () => {
    for (const { id, fittedTo } of IMPORTS) {
      const imported = size(readImported(id));
      const generated = size(readDocument(fittedTo));
      const touching = [0, 1, 2].some((axis) => Math.abs(imported[axis] - generated[axis]) < 1e-3);
      expect(touching, `"${id}" could be scaled up further inside ${fittedTo}`).toBe(true);
    }
  });

  it('lands both tree levels on the same height, so the LOD swap has no vertical pop', () => {
    const near = size(readImported('foliage-tree'))[1];
    const far = size(readImported('foliage-tree-lod1'))[1];
    expect(far).toBeCloseTo(near, 3);
  });

  it('is ground-pivoted, matching every generated kit piece', () => {
    for (const { id } of IMPORTS) {
      expect(boundingBox(readImported(id)).min[1], `"${id}" does not sit on y=0`).toBeCloseTo(0, 3);
    }
  });

  it('keeps the scale in the vertices, leaving every root transform identity', () => {
    for (const { id } of IMPORTS) {
      const document = readImported(id);
      for (const index of document.scenes[document.scene ?? 0].nodes) {
        const node = document.nodes[index];
        expect(
          node.matrix ?? node.translation ?? node.rotation ?? node.scale,
          `"${id}" root node ${index} carries a transform`,
        ).toBeUndefined();
      }
    }
  });

  it('embeds its texture rather than referencing one beside it', () => {
    for (const { id } of IMPORTS) {
      const images = readImported(id).images ?? [];
      expect(images.length, `"${id}" lost its texture`).toBeGreaterThan(0);
      for (const image of images) {
        // An external uri would resolve relative to /models/ and 404 - the
        // hazard docs/THREE_WORLD_ASSET_CONVENTIONS.md names.
        expect(image.uri, `"${id}" references an external texture`).toBeUndefined();
        expect(image.bufferView, `"${id}" has no embedded image data`).toBeDefined();
        expect(image.mimeType).toBe('image/png');
      }
    }
  });

  it('stays a single mesh with one material, so it survives instancing', () => {
    for (const { id } of IMPORTS) {
      const document = readImported(id);
      // createInstancedMeshFromAsset keeps only the first mesh a traverse
      // finds, silently - a multi-part import renders as a fragment.
      expect(document.meshes, `"${id}" is multi-part`).toHaveLength(1);
      expect(document.meshes[0].primitives, `"${id}" has multiple primitives`).toHaveLength(1);
      expect(document.materials ?? []).toHaveLength(1);
    }
  });

  it('requires no glTF extension, which GLTFLoader would drop in silence', () => {
    for (const { id } of IMPORTS) {
      // An unsupported *required* extension makes GLTFLoader return an
      // incomplete scene rather than throw, so this has to be asserted.
      expect(readImported(id).extensionsRequired ?? []).toEqual([]);
    }
  });

  it('leaves the generated originals on disk, so each swap reverts to one url', () => {
    for (const { fittedTo } of IMPORTS) {
      expect(() => readDocument(fittedTo)).not.toThrow();
    }
    expect(() => readDocument('/models/foliage-tree-lod1.gltf')).not.toThrow();
  });
});
