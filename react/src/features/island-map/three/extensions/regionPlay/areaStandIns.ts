import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
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
    case 'TREE': {
      // A charred trunk under a squat cone of ash-green leaves: cheap and readable from afar.
      const trunk = Math.min(width, depth) * 0.12;
      add(
        ownedMesh(owned, new CylinderGeometry(trunk * 0.8, trunk, height * 0.45, 6), 0x4a2f22),
        height * 0.225,
      );
      add(
        ownedMesh(owned, new ConeGeometry(width / 2, height * 0.65, 7), color),
        height * 0.45 + height * 0.325,
      );
      break;
    }
    case 'LOG': {
      // Lies along x; the cut ends are a lighter ring-wood disc.
      const radius = Math.min(height, depth) / 2;
      const log = add(
        ownedMesh(owned, new CylinderGeometry(radius, radius, width, 8), color),
        radius,
      );
      log.rotation.z = Math.PI / 2;
      break;
    }
    case 'GEAR': {
      // A flat toothed wheel on its side, in a child `gear-spin` the scene turns slowly.
      const spin = new Group();
      spin.name = 'gear-spin';
      spin.position.y = height / 2;
      const radius = Math.max(width, depth) / 2;
      const body = ownedMesh(
        owned,
        new CylinderGeometry(radius * 0.8, radius * 0.8, 0.12, 16),
        color,
      );
      body.rotation.x = Math.PI / 2;
      spin.add(body);
      for (let tooth = 0; tooth < 8; tooth += 1) {
        const angle = (tooth / 8) * Math.PI * 2;
        const cog = ownedMesh(owned, new BoxGeometry(radius * 0.3, radius * 0.3, 0.12), color);
        cog.position.set(Math.cos(angle) * radius * 0.9, Math.sin(angle) * radius * 0.9, 0);
        cog.rotation.z = angle;
        spin.add(cog);
      }
      group.add(spin);
      break;
    }
    case 'SWITCH': {
      add(ownedMesh(owned, new BoxGeometry(width, height * 0.4, depth), 0x4f4b59), height * 0.2);
      const lever = add(
        ownedMesh(owned, new CylinderGeometry(0.04, 0.04, height * 0.7, 6), 0x6b6b6b),
        height * 0.4 + height * 0.3,
      );
      lever.rotation.z = -0.4;
      add(
        ownedMesh(owned, new SphereGeometry(0.09, 8, 6), color, {
          emissive: color,
          emissiveIntensity: 0.4,
        }),
        height * 0.4 + height * 0.62,
      ).position.x = 0.16;
      break;
    }
    case 'ROCK': {
      const rock = add(
        ownedMesh(owned, new DodecahedronGeometry(Math.max(width, depth) / 2, 0), color),
        height / 2,
      );
      rock.scale.set(1, height / Math.max(width, depth), depth / Math.max(width, depth));
      rock.rotation.y = 0.4;
      break;
    }
    case 'ARCH': {
      // Two posts and a half-torus lintel; the opening is real space to walk through.
      const post = Math.max(0.12, width * 0.1);
      const rise = Math.max(0, height - width / 2);
      for (const side of [-1, 1]) {
        add(ownedMesh(owned, new BoxGeometry(post, rise, depth), color), rise / 2).position.x =
          (side * (width - post)) / 2;
      }
      const top = add(
        ownedMesh(owned, new TorusGeometry((width - post) / 2, post / 2, 6, 14, Math.PI), color),
        rise,
      );
      top.scale.z = depth / post / 2;
      break;
    }
    case 'PINE': {
      // A stack of three cones on a short trunk, snow-white tips are the config colour's job.
      const trunkHeight = height * 0.14;
      add(
        ownedMesh(
          owned,
          new CylinderGeometry(width * 0.06, width * 0.08, trunkHeight, 6),
          0x5a3b26,
        ),
        trunkHeight / 2,
      );
      const tiers = 3;
      const tierHeight = (height - trunkHeight) / (tiers - 0.8);
      for (let tier = 0; tier < tiers; tier += 1) {
        const radius = (width / 2) * (1 - tier * 0.28);
        add(
          ownedMesh(owned, new ConeGeometry(radius, tierHeight, 8), color),
          trunkHeight + tier * tierHeight * 0.62 + tierHeight / 2,
        );
      }
      break;
    }
    case 'STAR': {
      // An extruded five-point star standing upright, glowing.
      const outer = Math.min(width, height) / 2;
      const inner = outer * 0.45;
      const shape = new Shape();
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 === 0 ? outer : inner;
        const angle = Math.PI / 2 + (point / 10) * Math.PI * 2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (point === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      }
      shape.closePath();
      const thickness = Math.max(0.05, depth * 0.4);
      const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      geometry.translate(0, 0, -thickness / 2);
      add(
        ownedMesh(owned, geometry, color, { emissive: color, emissiveIntensity: 0.9 }),
        height / 2,
      );
      break;
    }
    case 'GIFT': {
      const box = Math.min(width, depth);
      add(ownedMesh(owned, new BoxGeometry(width, height, depth), color), height / 2);
      const ribbon = 0xf5f1e6;
      add(
        ownedMesh(owned, new BoxGeometry(box * 0.18, height * 1.02, depth * 1.02), ribbon),
        height / 2,
      );
      add(
        ownedMesh(owned, new BoxGeometry(width * 1.02, height * 1.02, box * 0.18), ribbon),
        height / 2,
      );
      add(
        ownedMesh(owned, new BoxGeometry(box * 0.3, height * 0.1, box * 0.3), ribbon),
        height * 1.04,
      );
      break;
    }
    case 'SNOWMAN': {
      const base = Math.min(width, depth) / 2;
      const sizes = [base, base * 0.72, base * 0.5];
      let y = 0;
      sizes.forEach((radius, index) => {
        y += index === 0 ? radius : sizes[index - 1] * 0.7 + radius * 0.7;
        add(ownedMesh(owned, new SphereGeometry(radius, 10, 8), color), y);
      });
      // A carrot nose, so it reads as a face from afar.
      const nose = add(ownedMesh(owned, new ConeGeometry(base * 0.08, base * 0.4, 6), 0xe8782a), y);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = sizes[2] + base * 0.15;
      break;
    }
    case 'CANE': {
      // A striped cane: a straight shaft of stacked cylinders and a hook of torus.
      const radius = Math.max(0.05, Math.min(width, depth) * 0.12);
      const shaft = height - width / 2;
      const stripes = 6;
      for (let stripe = 0; stripe < stripes; stripe += 1) {
        add(
          ownedMesh(
            owned,
            new CylinderGeometry(radius, radius, shaft / stripes, 8),
            stripe % 2 === 0 ? color : 0xf5f1e6,
          ),
          (stripe + 0.5) * (shaft / stripes),
        ).position.x = -width / 4;
      }
      const hook = add(
        ownedMesh(owned, new TorusGeometry(width / 4, radius, 6, 10, Math.PI), color),
        shaft,
      );
      hook.position.x = 0;
      break;
    }
    case 'LANTERN': {
      add(
        ownedMesh(owned, new CylinderGeometry(0.05, 0.07, height * 0.8, 6), 0x3a3a44),
        height * 0.4,
      );
      add(
        ownedMesh(owned, new BoxGeometry(width * 0.5, height * 0.2, depth * 0.5), color, {
          emissive: color,
          emissiveIntensity: 1,
        }),
        height * 0.9,
      );
      add(ownedMesh(owned, new ConeGeometry(width * 0.4, height * 0.08, 4), 0x3a3a44), height);
      break;
    }
    case 'HOUSE': {
      const wall = height * 0.6;
      add(ownedMesh(owned, new BoxGeometry(width, wall, depth), color), wall / 2);
      // A prism roof: a three-sided cylinder lying along z.
      const roofHeight = height - wall;
      const roof = add(
        ownedMesh(
          owned,
          new CylinderGeometry(width * 0.62, width * 0.62, depth * 1.1, 3),
          0xf5f1e6,
        ),
        wall + roofHeight * 0.4,
      );
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, (roofHeight / (width * 0.62)) * 1.2);
      add(
        ownedMesh(owned, new BoxGeometry(width * 0.22, wall * 0.55, 0.06), 0x5a3b26),
        wall * 0.275,
      ).position.z = depth / 2;
      break;
    }
    case 'DOME': {
      const base = height * 0.25;
      add(ownedMesh(owned, new CylinderGeometry(width / 2, width / 2, base, 16), color), base / 2);
      const dome = add(
        ownedMesh(
          owned,
          new SphereGeometry(width / 2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
          color,
        ),
        base,
      );
      dome.scale.y = (height - base) / (width / 2);
      break;
    }
    case 'SLEIGH': {
      const runnerY = height * 0.08;
      for (const side of [-1, 1]) {
        add(ownedMesh(owned, new BoxGeometry(width, 0.06, 0.08), 0xc9a24a), runnerY).position.z =
          (side * depth) / 2.4;
      }
      add(
        ownedMesh(owned, new BoxGeometry(width * 0.9, height * 0.3, depth * 0.8), color),
        height * 0.3,
      );
      add(
        ownedMesh(owned, new BoxGeometry(width * 0.12, height * 0.45, depth * 0.8), color),
        height * 0.5,
      ).position.x = -width * 0.4;
      const front = add(
        ownedMesh(owned, new BoxGeometry(width * 0.25, height * 0.2, depth * 0.8), color),
        height * 0.5,
      );
      front.position.x = width * 0.42;
      front.rotation.z = -0.4;
      break;
    }
    case 'ANIMAL': {
      // A simple quadruped: body, head, and four legs, standing along x.
      const leg = height * 0.4;
      add(
        ownedMesh(owned, new BoxGeometry(width * 0.6, height * 0.35, depth * 0.5), color),
        leg + height * 0.175,
      );
      const head = add(
        ownedMesh(owned, new BoxGeometry(width * 0.22, height * 0.28, depth * 0.3), color),
        leg + height * 0.4,
      );
      head.position.x = width * 0.4;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const part = add(
            ownedMesh(owned, new BoxGeometry(width * 0.08, leg, depth * 0.1), color),
            leg / 2,
          );
          part.position.x = sx * width * 0.22;
          part.position.z = sz * depth * 0.18;
        }
      }
      break;
    }
    case 'SIGN': {
      add(
        ownedMesh(owned, new CylinderGeometry(0.05, 0.05, height * 0.85, 6), 0x5a3b26),
        height * 0.425,
      );
      add(ownedMesh(owned, new BoxGeometry(width, height * 0.35, 0.08), color), height * 0.72);
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
