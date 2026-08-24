import { describe, expect, it } from 'vitest';
import {
  AMBIENT_GULL_PATH,
  BOUNDARY_WALLS,
  BUILDINGS,
  GROUND_HALF_EXTENT,
  NPC_SPOT,
  SCENERY_CLUSTER,
  WELCOME_HARBOR_REGION_CHECKPOINTS,
  findBuildingByInteriorZoneId,
  isInsideRect,
} from './welcomeHarborRegion';

describe('isInsideRect', () => {
  const zone = { id: 'z', minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

  it('is true for a point inside the rect, including its edge', () => {
    expect(isInsideRect(0, 0, zone)).toBe(true);
    expect(isInsideRect(1, -1, zone)).toBe(true);
  });

  it('is false for a point outside the rect', () => {
    expect(isInsideRect(2, 0, zone)).toBe(false);
    expect(isInsideRect(0, -2, zone)).toBe(false);
  });
});

describe('welcomeHarborRegion content', () => {
  it('gives every building a footprint fully inside the boundary walls', () => {
    for (const building of BUILDINGS) {
      expect(building.x - building.halfWidth).toBeGreaterThan(-GROUND_HALF_EXTENT);
      expect(building.x + building.halfWidth).toBeLessThan(GROUND_HALF_EXTENT);
      expect(building.z - building.halfDepth).toBeGreaterThan(-GROUND_HALF_EXTENT);
      expect(building.z + building.halfDepth).toBeLessThan(GROUND_HALF_EXTENT);
    }
  });

  it('gives every building exactly one open side (its doorway)', () => {
    for (const building of BUILDINGS) {
      expect(building.wallSides.length).toBe(3);
    }
  });

  it('puts every checkpoint inside the walkable ground and outside every building footprint', () => {
    for (const checkpoint of WELCOME_HARBOR_REGION_CHECKPOINTS) {
      expect(Math.abs(checkpoint.x)).toBeLessThan(GROUND_HALF_EXTENT);
      expect(Math.abs(checkpoint.z)).toBeLessThan(GROUND_HALF_EXTENT);
      for (const building of BUILDINGS) {
        const insideFootprint =
          Math.abs(checkpoint.x - building.x) < building.halfWidth &&
          Math.abs(checkpoint.z - building.z) < building.halfDepth;
        expect(insideFootprint).toBe(false);
      }
    }
  });

  it('places the NPC and the scenery cluster within the walkable ground', () => {
    expect(Math.abs(NPC_SPOT.x)).toBeLessThan(GROUND_HALF_EXTENT);
    expect(Math.abs(NPC_SPOT.z)).toBeLessThan(GROUND_HALF_EXTENT);
    for (const crate of SCENERY_CLUSTER) {
      expect(Math.abs(crate.x)).toBeLessThan(GROUND_HALF_EXTENT);
      expect(Math.abs(crate.z)).toBeLessThan(GROUND_HALF_EXTENT);
    }
  });

  it('has four boundary walls and a closed gull loop of at least three points', () => {
    expect(BOUNDARY_WALLS).toHaveLength(4);
    expect(AMBIENT_GULL_PATH.length).toBeGreaterThanOrEqual(3);
  });
});

describe('findBuildingByInteriorZoneId', () => {
  it('finds a building by its interior zone id', () => {
    expect(findBuildingByInteriorZoneId('lookout-tower:interior')?.id).toBe('lookout-tower');
  });

  it('returns undefined for an unknown zone id', () => {
    expect(findBuildingByInteriorZoneId('not-a-real-zone')).toBeUndefined();
  });
});
