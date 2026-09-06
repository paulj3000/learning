import { describe, expect, it } from 'vitest';
import { drawnTrailRects, scatterPlacements, tilePlacements } from './wonderwildForestScene';
import {
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  TRAILS,
  TREE_LINE_SEGMENTS,
  isInsideRect,
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
  it('never puts a tree anywhere the child can walk', () => {
    // The defect this exists to prevent: a tree standing on a trail the
    // colliders say is open. It would be invisible to the region tests (the
    // geometry is right) and to every other test here (the scene is not
    // rendered), and a child would simply walk into nothing.
    const placements = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable, 0.8);
    expect(placements.length).toBeGreaterThan(20);
    for (const placement of placements) {
      expect(
        isWalkable(placement.position.x, placement.position.z),
        `a tree stands on walkable ground at (${placement.position.x}, ${placement.position.z})`,
      ).toBe(false);
    }
  });

  it('keeps every scattered piece inside the region extents', () => {
    for (const placement of scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable, 0.8)) {
      expect(Math.abs(placement.position.x)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
      expect(Math.abs(placement.position.z)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_Z);
    }
  });

  it('keeps a trunk-width margin off every trail edge', () => {
    // Being off the trail is not enough: a tree has a trunk, and one placed
    // hard against a segment edge overhangs the trail beside it.
    const margin = 0.8;
    const placements = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable, margin);
    for (const placement of placements) {
      const inSomeSegment = TREE_LINE_SEGMENTS.some((segment) =>
        isInsideRect(placement.position.x, placement.position.z, {
          ...segment,
          minX: segment.minX + margin - 0.001,
          maxX: segment.maxX - margin + 0.001,
          minZ: segment.minZ + margin - 0.001,
          maxZ: segment.maxZ - margin + 0.001,
        }),
      );
      expect(inSomeSegment, 'a scattered piece sits outside the inset tree line').toBe(true);
    }
  });

  it('is deterministic, so the forest looks the same on every load', () => {
    // Screenshots, and a child who walks out and back in, both depend on this.
    const first = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable);
    const second = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable);
    expect(second).toEqual(first);
  });

  it('gives different seeds different layouts, so tree and bush runs do not stack', () => {
    const trees = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 1337, isWalkable);
    const bushes = scatterPlacements(TREE_LINE_SEGMENTS, 3.4, 90210, isWalkable);
    expect(bushes).not.toEqual(trees);
  });

  it('thins out as spacing grows', () => {
    const dense = scatterPlacements(TREE_LINE_SEGMENTS, 3, 1337, isWalkable);
    const sparse = scatterPlacements(TREE_LINE_SEGMENTS, 6, 1337, isWalkable);
    expect(sparse.length).toBeLessThan(dense.length);
  });

  it('drops a segment too thin to inset rather than emitting a sliver', () => {
    const sliver: RectZone = { id: 'sliver', minX: 0, maxX: 0.4, minZ: 0, maxZ: 0.4 };
    expect(scatterPlacements([sliver], 3, 1, () => false, 0.6)).toHaveLength(0);
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
