import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type { RegionPlayDrawnConfig, StandInShape } from '../../../../region-play/regionPlayConfig';

/**
 * Stand-ins for models that are not published yet (Firepeak FP-3, TR-7a's friendlier cousin).
 *
 * The runtime's missing-model box is deliberately loud magenta, for developers. A child-facing
 * 3D Area whose art has not been delivered instead gets a recognisable shape (a tent, a
 * telescope, a crystal) in a sensible colour, named `stand-in:<entity>` so it is clearly labelled
 * as temporary. When an administrator publishes a GLB for the entity's asset id, the next visit
 * loads it in place of the stand-in (`drawEntity`), with no code change.
 *
 * Pure Three.js: geometry and materials only, every one owned and disposed by the caller.
 */

export interface Owned {
  geometries: BufferGeometry[];
  materials: Material[];
}

export function ownedMesh(
  owned: Owned,
  geometry: BufferGeometry,
  color: number,
  options: { emissive?: number; emissiveIntensity?: number; opacity?: number } = {},
): Mesh {
  const material = new MeshStandardMaterial({
    color,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.opacity !== undefined,
    opacity: options.opacity ?? 1,
    roughness: 0.8,
  });
  owned.geometries.push(geometry);
  owned.materials.push(material);
  return new Mesh(geometry, material);
}

/** A stand-in for one shape, sized to the placement's placeholder box, standing on y = 0. */
export function buildStandIn(
  shape: StandInShape,
  color: number,
  size: { width: number; height: number; depth: number },
  owned: Owned,
): Group {
  const group = new Group();
  group.name = `stand-in:${shape.toLowerCase()}`;
  const { width, height, depth } = size;
  const add = (mesh: Mesh, y: number) => {
    mesh.position.y = y;
    group.add(mesh);
    return mesh;
  };
  switch (shape) {
    case 'TENT': {
      const tent = add(ownedMesh(owned, new ConeGeometry(width / 2, height, 4), color), height / 2);
      tent.rotation.y = Math.PI / 4;
      tent.scale.z = depth / width;
      break;
    }
    case 'TELESCOPE': {
      add(
        ownedMesh(owned, new CylinderGeometry(0.05, 0.25, height * 0.6, 8), 0x4a3b2a),
        height * 0.3,
      );
      const tube = add(
        ownedMesh(owned, new CylinderGeometry(0.09, 0.12, 0.9, 12), color),
        height * 0.75,
      );
      tube.rotation.x = Math.PI / 3;
      break;
    }
    case 'PIPE': {
      const pipe = add(
        ownedMesh(owned, new CylinderGeometry(depth / 2, depth / 2, width, 12), color),
        height / 2,
      );
      pipe.rotation.z = Math.PI / 2;
      break;
    }
    case 'PEDESTAL': {
      add(
        ownedMesh(owned, new CylinderGeometry(width * 0.35, width * 0.5, height, 8), color),
        height / 2,
      );
      add(ownedMesh(owned, new BoxGeometry(width, 0.08, depth), 0x4f4b59), height);
      break;
    }
    case 'CRYSTAL': {
      const crystal = add(
        ownedMesh(owned, new OctahedronGeometry(Math.max(width, depth) / 2), color, {
          emissive: color,
          emissiveIntensity: 0.8,
        }),
        height / 2,
      );
      crystal.scale.y = height / Math.max(width, depth);
      break;
    }
    case 'PORTAL': {
      add(
        ownedMesh(owned, new TorusGeometry(width / 2, 0.08, 8, 24), color, {
          emissive: color,
          emissiveIntensity: 0.6,
        }),
        height / 2,
      );
      add(ownedMesh(owned, new CylinderGeometry(0.04, 0.04, height, 6), 0x7a5c3a), height / 2);
      break;
    }
    case 'STONE': {
      const stone = add(ownedMesh(owned, new BoxGeometry(width, height, depth), color), height / 2);
      stone.rotation.y = 0.15;
      break;
    }
    case 'VALVE': {
      add(ownedMesh(owned, new CylinderGeometry(0.06, 0.06, height, 8), 0x6b6b6b), height / 2);
      const wheel = add(ownedMesh(owned, new TorusGeometry(width / 2, 0.06, 8, 16), color), height);
      wheel.name = 'valve-wheel';
      break;
    }
    case 'MARKER': {
      const ring = add(
        ownedMesh(owned, new RingGeometry(width * 0.35, width * 0.5, 4), color, {
          emissive: color,
          emissiveIntensity: 0.5,
          opacity: 0.8,
        }),
        0.05,
      );
      ring.rotation.x = -Math.PI / 2;
      ring.rotation.z = Math.PI / 4;
      ring.name = 'marker-ring';
      break;
    }
    case 'FIGURE': {
      add(
        ownedMesh(owned, new CylinderGeometry(0.3, 0.35, height * 0.7, 12), color),
        height * 0.35,
      );
      add(ownedMesh(owned, new SphereGeometry(height * 0.15, 12, 8), color), height * 0.85);
      break;
    }
    case 'BOX':
      add(ownedMesh(owned, new BoxGeometry(width, height, depth), color), height / 2);
      break;
  }
  return group;
}

export interface DrawnEntity {
  root: Object3D;
  /** The stand-in, or the model once it has loaded. */
  current(): Object3D;
}

/**
 * Draws one extension-owned entity: its stand-in at once, then its published model in its place
 * if one can be delivered and it loads. A model that fails to load keeps the stand-in, and the
 * cause is reported, as the runtime does for a missing model.
 */
export function drawEntity(
  root: Object3D,
  drawn: RegionPlayDrawnConfig,
  owned: Owned,
  loadModel: (assetId: string) => Promise<{ scene: Object3D }>,
  clone: (scene: Object3D) => Object3D,
  isDisposed: () => boolean,
): DrawnEntity {
  let current: Object3D = buildStandIn(drawn.shape, drawn.color, drawn.size, owned);
  current.name = `stand-in:${drawn.entityId}`;
  root.add(current);
  if (drawn.assetId) {
    const assetId = drawn.assetId;
    loadModel(assetId)
      .then((asset) => {
        if (isDisposed()) return;
        const model = clone(asset.scene);
        model.scale.setScalar(drawn.scale);
        root.remove(current);
        root.add(model);
        current = model;
      })
      .catch((error: unknown) => {
        console.warn(
          `[region-play] ${drawn.entityId}: could not load "${assetId}"; keeping its stand-in`,
          error,
        );
      });
  }
  return { root, current: () => current };
}
