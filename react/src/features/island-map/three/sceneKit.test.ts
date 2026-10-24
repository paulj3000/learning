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

  /**
   * Every kit piece tiled this way is a panel authored width-first (`wall`,
   * `wall-stone`, `fence` are all `buildPlanePrimitive`, wide in local X
   * with their normal on +Z), so "oriented correctly" means the piece's
   * local X ends up along the run and its face looks across it. Asserted as
   * a transformed direction rather than as a raw angle, because the angle
   * alone cannot show which way a panel actually ends up pointing - and it
   * was the raw angle being asserted that let a 90-degree error stand.
   */
  function widthAxisAfter(placement: { rotationY?: number }): { x: number; z: number } {
    const angle = placement.rotationY ?? 0;
    return { x: Math.cos(angle), z: -Math.sin(angle) };
  }

  it('lays each segment width-wise along the run, facing across it', () => {
    for (const placement of runPlacements({ x: 0, z: 0 }, { x: 0, z: 4 }, 2)) {
      const width = widthAxisAfter(placement);
      expect(width.x).toBeCloseTo(0);
      expect(width.z).toBeCloseTo(1);
    }
    for (const placement of runPlacements({ x: 0, z: 0 }, { x: 4, z: 0 }, 2)) {
      const width = widthAxisAfter(placement);
      expect(width.x).toBeCloseTo(1);
      expect(width.z).toBeCloseTo(0);
    }
  });

  /**
   * The concrete regression: a north building wall runs along +X, and its
   * panels must be left unrotated so they line up with the door
   * `welcomeHarborScene.ts` hand-places on that same side at `rotationY`
   * 0. Before this fix they came back at 90 degrees.
   */
  it('leaves a run along +X unrotated, matching a hand-placed door on the same side', () => {
    for (const placement of runPlacements({ x: -3, z: 4 }, { x: 3, z: 4 }, 2)) {
      expect(placement.rotationY).toBeCloseTo(0);
    }
  });

  it('places at least one segment for a run shorter than segmentLength', () => {
    const placements = runPlacements({ x: 0, z: 0 }, { x: 0.5, z: 0 }, 2);
    expect(placements).toHaveLength(1);
  });
});
