import { InstancedMesh, LOD, Mesh, Object3D, type Material } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getAssetManifestEntry } from './manifest';

/**
 * The runtime half of `docs/ROADMAP.md` Phase 34: loads assets from
 * `manifest.ts` through the real `GLTFLoader.load()` (fetch-based) path -
 * unlike `placeholderNpcGltf.ts`'s retired `.parse()`-on-an-inline-string
 * approach, this fetches real files from `public/models/`, cached by id so
 * placing the same asset many times (kit pieces, foliage) only parses it
 * once. `sceneKit.ts` is the only caller that should reach directly into
 * scene construction; everything else goes through `loadAsset`/
 * `instantiateAsset` here.
 */

const loader = new GLTFLoader();
const pendingById = new Map<string, Promise<GLTF>>();

/** Resolves a manifest url to an absolute URL when a `window.location` is available (browser and jsdom tests alike), so `GLTFLoader.load()` never depends on an implicit relative-URL base. */
function resolveUrl(url: string): string {
  if (typeof window !== 'undefined' && window.location) {
    return new URL(url, window.location.href).href;
  }
  return url;
}

/** Loads (and caches) the raw parsed `GLTF` result for a manifest id. */
export function loadAsset(id: string): Promise<GLTF> {
  let pending = pendingById.get(id);
  if (!pending) {
    pending = new Promise<GLTF>((resolve, reject) => {
      let entry;
      try {
        entry = getAssetManifestEntry(id);
      } catch (error) {
        reject(error);
        return;
      }
      loader.load(resolveUrl(entry.url), resolve, undefined, (error: unknown) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
    });
    pendingById.set(id, pending);
  }
  return pending;
}

/** A fresh, independently-placeable clone of an asset's scene graph. */
export async function instantiateAsset(id: string): Promise<Object3D> {
  const gltf = await loadAsset(id);
  return gltf.scene.clone(true);
}

function findFirstMesh(root: Object3D): Mesh | undefined {
  let found: Mesh | undefined;
  root.traverse((child) => {
    if (!found && (child as Mesh).isMesh) {
      found = child as Mesh;
    }
  });
  return found;
}

export interface InstancePlacement {
  position: { x: number; y: number; z: number };
  rotationY?: number;
  /** Non-uniform scale, e.g. stretching one `wall` kit piece to match different buildings' widths/heights. Defaults to 1 on every axis. */
  scale?: { x?: number; y?: number; z?: number };
}

/**
 * Builds one `InstancedMesh` from a single-mesh kit piece placed at many
 * positions (roadmap: "instancing for repeated props") - one draw call
 * instead of one per placement, the same win the crate cluster already
 * proved with an inline `BoxGeometry` (`welcomeHarborScene.ts`), now
 * sourced from a loaded asset instead.
 *
 * Bakes the source mesh's authored node transform into the geometry
 * (`geometry.applyMatrix4(mesh.matrixWorld)`) before instancing: an
 * `InstancedMesh` consumes raw vertex data, so a non-identity transform on
 * the glTF node would otherwise be silently dropped.
 */
export async function createInstancedMeshFromAsset(
  id: string,
  placements: readonly InstancePlacement[],
): Promise<InstancedMesh> {
  const gltf = await loadAsset(id);
  const sourceMesh = findFirstMesh(gltf.scene);
  if (!sourceMesh) {
    throw new Error(`asset "${id}" has no mesh to instance`);
  }
  sourceMesh.updateMatrixWorld(true);
  const geometry = sourceMesh.geometry.clone();
  geometry.applyMatrix4(sourceMesh.matrixWorld);
  const material = (
    Array.isArray(sourceMesh.material) ? sourceMesh.material[0] : sourceMesh.material
  ) as Material;

  const instanced = new InstancedMesh(geometry, material, placements.length);
  const transform = new Object3D();
  placements.forEach((placement, index) => {
    transform.position.set(placement.position.x, placement.position.y, placement.position.z);
    transform.rotation.set(0, placement.rotationY ?? 0, 0);
    transform.scale.set(placement.scale?.x ?? 1, placement.scale?.y ?? 1, placement.scale?.z ?? 1);
    transform.updateMatrix();
    instanced.setMatrixAt(index, transform.matrix);
  });
  instanced.instanceMatrix.needsUpdate = true;
  return instanced;
}

/**
 * Builds a `THREE.LOD` from a manifest entry's `lod` declaration (roadmap:
 * "LOD variants"), falling back to a plain instantiated asset when the
 * entry declares no lower-detail variant. Only `foliage-tree` declares one
 * in the first pack - proving the mechanism on one real case rather than
 * inventing detail levels for assets too small to benefit.
 */
export async function instantiateWithLod(id: string): Promise<Object3D> {
  const entry = getAssetManifestEntry(id);
  if (!entry.lod) {
    return instantiateAsset(id);
  }
  const [highDetail, lowDetail] = await Promise.all([
    instantiateAsset(id),
    instantiateAsset(entry.lod.lowDetailId),
  ]);
  const lod = new LOD();
  lod.addLevel(highDetail, 0);
  lod.addLevel(lowDetail, entry.lod.distanceMeters);
  return lod;
}
