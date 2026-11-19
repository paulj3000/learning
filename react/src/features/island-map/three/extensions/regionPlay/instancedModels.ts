import { Box3, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { BufferGeometry, Material, Mesh, Object3D } from 'three';
import type { LoadedModel } from '../../runtime/extensionRegistry';
import { hashPhase } from './proceduralScenery';

/**
 * Environment models drawn from the asset library, instanced (TR-PALM-05, TR-ENV-07).
 *
 * Every placement sharing a model is one `InstancedMesh` per mesh in it (a palm's trunk and
 * crown, a barrel's staves, bands and lid), so the cove's palms, barrels and logs cost a few draw
 * calls per model, and each model is fetched and parsed once (the asset loader caches by id). The
 * geometry is cloned with the mesh's own transform baked in; materials and textures stay the
 * loader's, shared, and are never disposed here.
 *
 * A placement is turned by `rotationZ` (a barrel on its side) and then `rotationY`, scaled
 * uniformly (to `height` metres when given, measured from the model, else by `scale`), and stood
 * on the ground: the lowest point of the turned model at y = 0. Nothing floats or sinks whatever
 * the model's own origin.
 *
 * `onDrawn(assetId, ids)` says which placements a model now draws, once it has loaded; the caller
 * hides stand-ins and adds colliders then. A model that fails changes nothing, with a warning.
 *
 * `tick` sways placements of a set built with `sway` about their foot, each on its own phase
 * (palms); the caller skips it when the device asks for reduced motion. Colliders are never these
 * meshes, so neither canopies nor the sway change where a child can walk.
 */

export interface ModelPlacement {
  id: string;
  assetId: string;
  x: number;
  z: number;
  rotationY?: number;
  rotationZ?: number;
  /** Overall height in metres; wins over `scale`. */
  height?: number;
  scale?: number;
}

export interface InstancedModels {
  root: Group;
  /** Resolves when every model has loaded or failed (tests, and nothing else, wait on it). */
  settled: Promise<void>;
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export interface InstancedModelOptions {
  /** Names the root, and each model's meshes `${name}:${assetId}`. */
  name: string;
  /** The largest lean of the sway in radians; 0 or absent keeps the set still. */
  sway?: number;
  onDrawn?(assetId: string, ids: readonly string[]): void;
}

interface Batch {
  placements: readonly ModelPlacement[];
  meshes: InstancedMesh[];
  scales: number[];
  /** Per placement: the lift that stands the turned, scaled model on the ground. */
  lifts: number[];
  phases: number[];
}

const corner = new Vector3();

/** The lowest y of `bounds` once turned by `rotationZ` about Z (yaw never changes heights). */
function lowestAfterTilt(bounds: Box3, rotationZ: number): number {
  if (!rotationZ) return bounds.min.y;
  const cos = Math.cos(rotationZ);
  const sin = Math.sin(rotationZ);
  let lowest = Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      corner.set(x, y, 0);
      lowest = Math.min(lowest, corner.x * sin + corner.y * cos);
    }
  }
  return lowest;
}

export function mountInstancedModels(
  placements: readonly ModelPlacement[],
  loadModel: (assetId: string) => Promise<LoadedModel>,
  options: InstancedModelOptions,
): InstancedModels {
  const root = new Group();
  root.name = options.name;
  const sway = options.sway ?? 0;
  const byAsset = new Map<string, ModelPlacement[]>();
  for (const placement of placements) {
    const list = byAsset.get(placement.assetId) ?? [];
    list.push(placement);
    byAsset.set(placement.assetId, list);
  }

  const batches: Batch[] = [];
  const geometries: BufferGeometry[] = [];
  let disposed = false;
  let time = 0;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const at = new Vector3();
  const size = new Vector3();

  const place = (batch: Batch) => {
    batch.placements.forEach((placement, index) => {
      const phase = batch.phases[index] ?? 0;
      const swayX = sway ? Math.sin(time * 0.8 + phase) * sway * 0.5 : 0;
      const swayZ = sway ? Math.sin(time * 0.9 + phase * 1.7) * sway : 0;
      euler.set(swayX, placement.rotationY ?? 0, (placement.rotationZ ?? 0) + swayZ);
      rotation.setFromEuler(euler);
      const scale = batch.scales[index] ?? 1;
      at.set(placement.x, batch.lifts[index] ?? 0, placement.z);
      matrix.compose(at, rotation, size.setScalar(scale));
      for (const mesh of batch.meshes) mesh.setMatrixAt(index, matrix);
    });
    for (const mesh of batch.meshes) mesh.instanceMatrix.needsUpdate = true;
  };

  const build = (assetId: string, list: ModelPlacement[], model: LoadedModel) => {
    const scene: Object3D = model.scene;
    scene.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(scene);
    const modelHeight = bounds.max.y - bounds.min.y;
    const sources: Mesh[] = [];
    scene.traverse((object) => {
      if ((object as Mesh).isMesh) sources.push(object as Mesh);
    });
    if (!(modelHeight > 0) || sources.length === 0) {
      throw new Error(`"${assetId}" has no visible geometry`);
    }
    const meshes = sources.map((source, index) => {
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      geometries.push(geometry);
      const material = (
        Array.isArray(source.material) ? source.material[0] : source.material
      ) as Material;
      const mesh = new InstancedMesh(geometry, material, list.length);
      mesh.name = `${options.name}:${assetId}`;
      mesh.userData.part = index;
      return mesh;
    });
    const scales = list.map((placement) =>
      placement.height !== undefined ? placement.height / modelHeight : (placement.scale ?? 1),
    );
    const batch: Batch = {
      placements: list,
      meshes,
      scales,
      lifts: list.map(
        (placement, index) =>
          -lowestAfterTilt(bounds, placement.rotationZ ?? 0) * (scales[index] ?? 1),
      ),
      phases: list.map((placement) => hashPhase(placement.id)),
    };
    place(batch);
    for (const mesh of meshes) {
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    batches.push(batch);
  };

  const settled = Promise.all(
    [...byAsset].map(([assetId, list]) =>
      loadModel(assetId)
        .then((model) => {
          if (disposed) return;
          build(assetId, list, model);
          options.onDrawn?.(
            assetId,
            list.map((placement) => placement.id),
          );
        })
        .catch((error: unknown) => {
          if (disposed) return;
          console.warn(
            `[region-play] ${options.name}: could not draw "${assetId}"; keeping what stands in for it`,
            error,
          );
        }),
    ),
  ).then(() => undefined);

  return {
    root,
    settled,
    tick(deltaSeconds) {
      if (!sway) return;
      time += deltaSeconds;
      for (const batch of batches) place(batch);
    },
    dispose() {
      disposed = true;
      root.removeFromParent();
      for (const batch of batches) for (const mesh of batch.meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      batches.length = 0;
      geometries.length = 0;
    },
  };
}
