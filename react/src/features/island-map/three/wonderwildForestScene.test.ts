import { describe, expect, it } from 'vitest';
import { drawnTrailRects, scatterPlacements, tilePlacements } from './wonderwildForestScene';
import {
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  TRAILS,
  isWalkable,
} from './wonderwildForestRegion';
import type { RectZone } from './wonderwildForestRegion';

/**
 * `wonderwildForestScene.ts` is rendering glue and is not unit tested as a
 * whole - it needs a real WebGL context. Its two *pure* placement helpers
 * are, for the same reason `storykeeperCastleScene.ts` exports its own: the
 * defects they can produce are geometric, silent, and invisible to every
 * other test in the region.
 */

const GROUND: RectZone = {
  id: 'ground',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: GROUND_HALF_EXTENT_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

describe('tilePlacements', () => {
  it('covers a rect completely, with no gap between tiles', () => {
    const tileSize = 4;
    const placements = tilePlacements(GROUND, tileSize);
    // Every point of the ground must be under some tile: a gap in the floor
    // is a hole the child can see through.
    for (let x = GROUND.minX + 0.5; x < GROUND.maxX; x += 1) {
      for (let z = GROUND.minZ + 0.5; z < GROUND.maxZ; z += 1) {
        const covered = placements.some(
          (placement) =>
            Math.abs(placement.position.x - x) <= tileSize / 2 &&
            Math.abs(placement.position.z - z) <= tileSize / 2,
        );
        expect(covered, `nothing covers (${x}, ${z})`).toBe(true);
      }
    }
  });

  it('centres the run rather than clipping one edge', () => {
    const placements = tilePlacements(GROUND, 4);
    const xs = placements.map((placement) => placement.position.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 6);
  });

  it('always emits at least one tile, even for a rect smaller than the tile', () => {
    const tiny: RectZone = { id: 'tiny', minX: 0, maxX: 0.5, minZ: 0, maxZ: 0.5 };
    expect(tilePlacements(tiny, 4)).toHaveLength(1);
  });

  it('lays every tile flat on the ground plane', () => {
    for (const placement of tilePlacements(GROUND, 4)) {
      expect(placement.position.y).toBe(0);
    }
  });
});

describe('scatterPlacements', () => {
  const TREES = () => scatterPlacements(GROUND, 1.5, 1337, isWalkable, 0.9);

  it('never puts a tree anywhere the child can walk', () => {
    // The defect this exists to prevent: a tree standing on a trail the
    // colliders say is open. It would be invisible to the region tests (the
    // geometry is right) and to every other test here (the scene is not
    // rendered), and a child would simply walk into nothing.
    const placements = TREES();
    for (const placement of placements) {
      expect(
        isWalkable(placement.position.x, placement.position.z),
        `a tree stands on walkable ground at (${placement.position.x}, ${placement.position.z})`,
      ).toBe(false);
    }
  });

  it('keeps a trunk-width clearance off every trail edge', () => {
    // Being off the trail is not enough: a tree has a trunk, and one placed
    // hard against a trail edge is off the trail and still in the way.
    const clearance = 0.9;
    for (const { position } of scatterPlacements(GROUND, 1.5, 1337, isWalkable, clearance)) {
      for (const [dx, dz] of [
        [clearance, 0],
        [-clearance, 0],
        [0, clearance],
        [0, -clearance],
      ]) {
        expect(
          isWalkable(position.x + dx, position.z + dz),
          `a trunk at (${position.x}, ${position.z}) overhangs a trail`,
        ).toBe(false);
      }
    }
  });

  it('fills the tree line densely enough to read as forest, not as scattered woodland', () => {
    /*
      This is the assertion that caught the real defect in this helper. The
      first version scattered over `TREE_LINE_SEGMENTS` and gridded each one,
      which produced *fourteen* trees for the whole forest, because the tree
      line is derived by a column sweep into many narrow strips and a 1.5m
      strip has nothing left once both edges are inset by a trunk radius.
      Density depended on how the complement happened to be cut up, which is
      an implementation detail of `buildTreeLineSegments`.

      The floor is set from the measured tree-line area (~449 m2, 48% of the
      region): at worse than one tree per 8 m2 a child can see clean through
      the "wall of trees" between glades while the colliders still stop them,
      which reads as a bug rather than as a forest.
    */
    const treeLineArea = 0.48 * (GROUND_HALF_EXTENT_X * 2) * (GROUND_HALF_EXTENT_Z * 2);
    const trees = TREES();
    expect(treeLineArea / trees.length).toBeLessThan(8);
  });

  it('keeps every scattered piece inside the region extents', () => {
    for (const { position } of TREES()) {
      expect(Math.abs(position.x)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
      expect(Math.abs(position.z)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_Z);
    }
  });

  it('is deterministic, so the forest looks the same on every load', () => {
    // Screenshots, and a child who walks out and back in, both depend on this.
    expect(scatterPlacements(GROUND, 1.5, 1337, isWalkable)).toEqual(
      scatterPlacements(GROUND, 1.5, 1337, isWalkable),
    );
  });

  it('gives different seeds different layouts, so tree and bush runs do not stack', () => {
    expect(scatterPlacements(GROUND, 1.5, 90210, isWalkable)).not.toEqual(
      scatterPlacements(GROUND, 1.5, 1337, isWalkable),
    );
  });

  it('thins out as spacing grows', () => {
    expect(scatterPlacements(GROUND, 4, 1337, isWalkable).length).toBeLessThan(
      scatterPlacements(GROUND, 2, 1337, isWalkable).length,
    );
  });

  it('emits nothing when everywhere is walkable', () => {
    expect(scatterPlacements(GROUND, 3, 1, () => true)).toHaveLength(0);
  });

  it('lays every scattered piece on the ground plane', () => {
    for (const { position } of TREES()) {
      expect(position.y).toBe(0);
    }
  });
});

describe('drawnTrailRects', () => {
  it('draws every trail except the fern bank, which must stay unmarked', () => {
    // Beat 11's glowing moss is found by wandering off the path. A path
    // leading to it would be a signpost pointing at the one thing the
    // storyboard insists nothing points at.
    const drawn = drawnTrailRects();
    const fernBankRects = TRAILS.filter((trail) => trail.connects.includes('fern-bank')).flatMap(
      (trail) => trail.rects,
    );
    expect(fernBankRects.length).toBeGreaterThan(0);
    for (const rect of fernBankRects) {
      expect(drawn, `${rect.id} is drawn, marking the secret`).not.toContainEqual(rect);
    }
    const drawnTrails = TRAILS.filter((trail) => trail.wear !== 'none');
    expect(drawn).toHaveLength(drawnTrails.flatMap((trail) => trail.rects).length);
  });

  it('lays path tiles only on ground the child can walk', () => {
    for (const rect of drawnTrailRects()) {
      const centreWalkable = isWalkable((rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2);
      expect(centreWalkable, `${rect.id} is drawn across the tree line`).toBe(true);
    }
  });
});
