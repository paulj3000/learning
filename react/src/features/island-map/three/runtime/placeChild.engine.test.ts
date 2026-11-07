import { describe, expect, it } from 'vitest';
import { mount } from './testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';

/**
 * The generic position API (SC-R03-02): the accessible equivalent of
 * walking. It is deliberately tested on Welcome Harbor, not the castle, to
 * show it belongs to the runtime. A region decides where and whether (rooms,
 * locks); the runtime only decides whether the spot is standable.
 */

/** Welcome Harbor with one known solid box, so the refusal case is explicit. */
const SOLID = { id: 'test-solid', minX: 2, maxX: 3, minZ: 2, maxZ: 3 };
const MANIFEST = {
  ...WELCOME_HARBOR_MANIFEST,
  colliders: [{ rect: SOLID, minY: 0, maxY: 2 }],
};

const harness = () => {
  const h = mount({ manifest: MANIFEST });
  h.runFrames(1);
  return h;
};

const solidPoint = () => ({ x: (SOLID.minX + SOLID.maxX) / 2, z: (SOLID.minZ + SOLID.maxZ) / 2 });

describe('LocationEngine.placeChild', () => {
  it('moves the child to open ground and reports where they now are', () => {
    const h = harness();
    expect(h.engine.placeChild({ x: 0.5, z: 0.5, yaw: 1.25 })).toBe(true);
    expect(h.engine.childPlacement()).toEqual({ x: 0.5, z: 0.5, yaw: 1.25 });
    h.runFrames(1);
    expect(h.camera().position.x).toBeCloseTo(0.5);
    expect(h.camera().position.z).toBeCloseTo(0.5);
  });

  it('keeps the heading when none is given', () => {
    const h = harness();
    h.engine.placeChild({ x: 0, z: 0, yaw: 0.9 });
    expect(h.engine.placeChild({ x: 1, z: 1 })).toBe(true);
    expect(h.engine.childPlacement().yaw).toBeCloseTo(0.9);
  });

  it('refuses a spot inside a collider, and the child stays where they were', () => {
    const h = harness();
    h.engine.placeChild({ x: 0.5, z: 0.5, yaw: 0 });
    const { x, z } = solidPoint();
    expect(h.engine.placeChild({ x, z })).toBe(false);
    expect(h.engine.childPlacement()).toMatchObject({ x: 0.5, z: 0.5 });
  });

  it('refuses a spot outside the region bounds, however open it is', () => {
    const h = harness();
    const { halfExtentX, halfExtentZ } = MANIFEST.bounds;
    expect(h.engine.placeChild({ x: halfExtentX + 5, z: 0 })).toBe(false);
    expect(h.engine.placeChild({ x: 0, z: -(halfExtentZ + 5) })).toBe(false);
  });

  it('refuses a position that is not a finite number', () => {
    const h = harness();
    expect(h.engine.placeChild({ x: Number.NaN, z: 0 })).toBe(false);
    expect(h.engine.placeChild({ x: 0, z: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('does nothing once the engine is disposed', () => {
    const h = harness();
    h.engine.dispose();
    expect(h.engine.placeChild({ x: 0, z: 0 })).toBe(false);
  });
});
