import type { ListenerPose } from '../AudioTypes';
import type { PositionReader } from './SpatialEmitters';

/**
 * Structural adapters for Three.js (SM-P7). They accept anything shaped like an `Object3D` or a
 * `Camera`, so this file imports nothing from `three` and the Sound Manager stays free of it.
 * Every function reuses the objects it is given: nothing is allocated per frame.
 */

export interface WorldMatrixObject {
  matrixWorld: { elements: ArrayLike<number> };
  /** `Object3D.updateWorldMatrix(updateParents, updateChildren)`. */
  updateWorldMatrix?(updateParents: boolean, updateChildren: boolean): void;
  parent?: unknown;
}

/**
 * Reads an object's world position. Returns false once the object has been removed from its
 * scene (it has no parent), which makes the emitter forget it. The scene root itself is the one
 * object that legitimately has no parent: pass `{ root: true }` for it.
 */
export function objectPositionReader(
  object: WorldMatrixObject,
  options: { root?: boolean } = {},
): PositionReader {
  return (out) => {
    if (!options.root && (object.parent === null || object.parent === undefined)) return false;
    object.updateWorldMatrix?.(true, false);
    const e = object.matrixWorld.elements;
    out[0] = e[12] as number;
    out[1] = e[13] as number;
    out[2] = e[14] as number;
    return true;
  };
}

/** A fixed place, as a reader. */
export function fixedPosition(x: number, y: number, z: number): PositionReader {
  return (out) => {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return true;
  };
}

/**
 * Makes a reusable listener pose from a camera: position is its world translation, forward is its
 * local -Z axis, up its local Y axis. Call it every frame with the same pose object.
 */
export function createCameraListener(camera: WorldMatrixObject): {
  pose: ListenerPose;
  update(): ListenerPose;
} {
  const position: [number, number, number] = [0, 0, 0];
  const forward: [number, number, number] = [0, 0, -1];
  const up: [number, number, number] = [0, 1, 0];
  const pose: ListenerPose = { position, forward, up };
  return {
    pose,
    update() {
      camera.updateWorldMatrix?.(true, false);
      const e = camera.matrixWorld.elements;
      position[0] = e[12] as number;
      position[1] = e[13] as number;
      position[2] = e[14] as number;
      // `0 - x` rather than `-x`, so a zero stays +0.
      forward[0] = 0 - (e[8] as number);
      forward[1] = 0 - (e[9] as number);
      forward[2] = 0 - (e[10] as number);
      up[0] = e[4] as number;
      up[1] = e[5] as number;
      up[2] = e[6] as number;
      return pose;
    },
  };
}
