import { describe, expect, it } from 'vitest';
import { createCameraListener, fixedPosition, objectPositionReader } from './threeBindings';

const matrix = (tx: number, ty: number, tz: number) => ({
  elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1],
});

describe('Three.js bindings', () => {
  it('reads an object world position without importing three', () => {
    const object = { matrixWorld: matrix(3, 4, 5), parent: {} };
    const out: [number, number, number] = [0, 0, 0];
    expect(objectPositionReader(object)(out)).toBe(true);
    expect(out).toEqual([3, 4, 5]);
  });

  it('asks the object to refresh its world matrix', () => {
    let calls = 0;
    const object = {
      matrixWorld: matrix(0, 0, 0),
      parent: {},
      updateWorldMatrix: () => void (calls += 1),
    };
    objectPositionReader(object)([0, 0, 0]);
    expect(calls).toBe(1);
  });

  it('reports a removed object (no parent) as gone, but not the scene root', () => {
    const detached = { matrixWorld: matrix(1, 1, 1), parent: null };
    expect(objectPositionReader(detached)([0, 0, 0])).toBe(false);
    expect(objectPositionReader(detached, { root: true })([0, 0, 0])).toBe(true);
  });

  it('gives a camera listener pose that is reused every frame', () => {
    // A camera looking down -Z from (1, 2, 3): identity rotation.
    const camera = { matrixWorld: matrix(1, 2, 3) };
    const listener = createCameraListener(camera);
    const first = listener.update();
    expect(first.position).toEqual([1, 2, 3]);
    expect(first.forward).toEqual([-0, -0, -1].map((v) => v + 0));
    expect(first.up).toEqual([0, 1, 0]);
    camera.matrixWorld.elements[12] = 9;
    const second = listener.update();
    expect(second).toBe(first); // the same object: no per-frame allocation
    expect(second.position[0]).toBe(9);
  });

  it('turns the listener forward vector with the camera', () => {
    // Rotated 90 degrees about Y: local -Z points along -X.
    const camera = { matrixWorld: { elements: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1] } };
    expect(createCameraListener(camera).update().forward).toEqual([-1, -0, -0].map((v) => v + 0));
  });

  it('fixedPosition always reports the same place', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(fixedPosition(1, 2, 3)(out)).toBe(true);
    expect(out).toEqual([1, 2, 3]);
  });
});
