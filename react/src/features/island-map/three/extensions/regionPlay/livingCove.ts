import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  Points,
  PointsMaterial,
  type Material,
  type Object3D,
  type Scene,
} from 'three';
import type { RegionPlayFirefliesConfig } from '../../../../region-play/regionPlayConfig';

/**
 * The living cove (TR-18): water that shimmers and fireflies that drift. Decoration only, never
 * game state, never interactive. Cheap on purpose: all the fireflies are one `Points` draw call
 * and the water is a slow colour change on materials this module clones, so shared materials are
 * never touched. `tick` is not called when the device asks for reduced motion, so both stay
 * where they were first drawn.
 */

export const FIREFLIES_NAME = 'region-play:fireflies';

const FIREFLY_COLOR = 0xfff2a0;
const FIREFLY_SIZE = 0.16;
/** How far from its home a firefly wanders, as a fraction of the cloud's radius. */
const WANDER = 0.35;

/** A stable 0..1 number for `index` in `salt`, so every firefly has its own path. */
export function unit(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export interface FireflyPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Where firefly `index` of `cloud` is at `time` seconds. Always inside the cloud's disc and
 * between 0.4 m and `height` + 0.6 m above the ground, whatever the time.
 */
export function fireflyPosition(
  cloud: Pick<RegionPlayFirefliesConfig, 'x' | 'z' | 'radius' | 'height'>,
  index: number,
  time: number,
): FireflyPoint {
  const angle = unit(index, 1) * Math.PI * 2;
  const home = Math.sqrt(unit(index, 2)) * cloud.radius * (1 - WANDER);
  const wander = cloud.radius * WANDER;
  const speed = 0.25 + unit(index, 3) * 0.35;
  const phase = unit(index, 4) * Math.PI * 2;
  // One angle for both axes, so the wander is a circle of radius `wander` and the firefly can
  // never leave the cloud: home + wander is at most the radius.
  const drift = time * speed + phase;
  const x = cloud.x + Math.cos(angle) * home + Math.sin(drift) * wander;
  const z = cloud.z + Math.sin(angle) * home + Math.cos(drift) * wander;
  const y = 0.4 + unit(index, 5) * cloud.height + Math.sin(time * speed * 1.7 + phase) * 0.3 + 0.3;
  return { x, y, z };
}

export interface LivingCove {
  tick(deltaSeconds: number): void;
  dispose(): void;
}

/** Every cloud as one `Points` object. Empty for no clouds. */
export function buildFireflies(
  clouds: readonly RegionPlayFirefliesConfig[],
  scene: Scene,
): LivingCove {
  const total = clouds.reduce((sum, cloud) => sum + cloud.count, 0);
  if (total === 0) return { tick() {}, dispose() {} };
  const positions = new Float32Array(total * 3);
  const place = (time: number) => {
    let offset = 0;
    for (const cloud of clouds) {
      for (let index = 0; index < cloud.count; index += 1) {
        const point = fireflyPosition(cloud, index, time);
        positions[offset] = point.x;
        positions[offset + 1] = point.y;
        positions[offset + 2] = point.z;
        offset += 3;
      }
    }
  };
  place(0);
  const attribute = new BufferAttribute(positions, 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attribute);
  geometry.computeBoundingSphere();
  const material = new PointsMaterial({
    color: FIREFLY_COLOR,
    size: FIREFLY_SIZE,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.name = FIREFLIES_NAME;
  points.frustumCulled = false; // they drift; the bounding sphere is the first frame's
  scene.add(points);
  let time = 0;
  return {
    tick(deltaSeconds) {
      time += deltaSeconds;
      place(time);
      attribute.needsUpdate = true;
    },
    dispose() {
      points.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Makes the named water scenery shimmer, by clone: each mesh gets its own copy of its material
 * and its colour drifts a little lighter and darker. Ids that are not in the scene are skipped.
 */
export function shimmerWater(roots: readonly (Object3D | undefined)[]): LivingCove {
  const surfaces: { material: Material & { color: Color }; base: Color; phase: number }[] = [];
  roots.forEach((root, rootIndex) => {
    root?.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const original = child.material as Material & { color?: Color };
      if (Array.isArray(original) || !original.color) return;
      const copy = original.clone() as Material & { color: Color };
      child.material = copy;
      surfaces.push({ material: copy, base: copy.color.clone(), phase: rootIndex * 1.3 });
    });
  });
  const hsl = { h: 0, s: 0, l: 0 };
  let time = 0;
  return {
    tick(deltaSeconds) {
      time += deltaSeconds;
      for (const surface of surfaces) {
        surface.base.getHSL(hsl);
        const wave = Math.sin(time * 0.9 + surface.phase) * 0.035;
        surface.material.color.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + wave)));
      }
    },
    dispose() {
      for (const surface of surfaces) surface.material.dispose();
    },
  };
}
