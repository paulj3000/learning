import { describe, expect, it } from 'vitest';
import { runPlacements, toBox3, WALL_HEIGHT } from './sceneKit';

describe('toBox3', () => {
  it('converts a rect zone into a Box3 with the default wall height', () => {
    const box = toBox3({ minX: -1, maxX: 1, minZ: -2, maxZ: 2 });
    expect(box.min.y).toBe(-1);
    expect(box.max.y).toBe(WALL_HEIGHT);
    expect(box.min.x).toBe(-1);
    expect(box.max.z).toBe(2);
  });

  it('accepts custom min/max y', () => {
    const box = toBox3({ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, 0, 6);
    expect(box.min.y).toBe(0);
    expect(box.max.y).toBe(6);
  });
});

describe('runPlacements', () => {
  it('tiles a straight run into whole segments of the given length', () => {
    const placements = runPlacements({ x: 0, z: 0 }, { x: 8, z: 0 }, 2);
    expect(placements).toHaveLength(4);
    expect(placements[0].position.x).toBeCloseTo(1);
    expect(placements[3].position.x).toBeCloseTo(7);
    for (const placement of placements) {
      expect(placement.position.z).toBeCloseTo(0);
      expect(placement.position.y).toBe(0);
    }
  });

  it('orients each segment to face along the run direction', () => {
    const placements = runPlacements({ x: 0, z: 0 }, { x: 0, z: 4 }, 2);
    for (const placement of placements) {
      expect(placement.rotationY).toBeCloseTo(0);
    }
    const sideways = runPlacements({ x: 0, z: 0 }, { x: 4, z: 0 }, 2);
    for (const placement of sideways) {
      expect(placement.rotationY).toBeCloseTo(Math.PI / 2);
    }
  });

  it('places at least one segment for a run shorter than segmentLength', () => {
    const placements = runPlacements({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 2);
    expect(placements).toHaveLength(1);
  });
});
