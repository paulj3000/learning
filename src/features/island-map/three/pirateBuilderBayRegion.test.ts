import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_WALLS,
  BRIDGE_APPROACH_ZONE,
  BRIDGE_SPAN,
  CHANNEL_MAX_X,
  CHANNEL_MIN_X,
  CHANNEL_NORTH_WATER,
  CHANNEL_SOUTH_WATER,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  NPC_SPOT,
  PIRATE_BUILDER_BAY_REGION_CHECKPOINTS,
  ROPE_COIL_SPOT,
  TIDE_TUNNEL_ZONE,
  TOOLBOX_SPOT,
  TREASURE_SPOT,
  isInsideRect,
} from './pirateBuilderBayRegion';

function insideGround(x: number, z: number): boolean {
  return Math.abs(x) < GROUND_HALF_EXTENT_X && Math.abs(z) < GROUND_HALF_EXTENT_Z;
}

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

describe('pirateBuilderBayRegion content', () => {
  it('has four boundary walls all outside the walkable ground', () => {
    expect(BOUNDARY_WALLS).toHaveLength(4);
    for (const wall of BOUNDARY_WALLS) {
      const outsideGround =
        wall.minX >= GROUND_HALF_EXTENT_X ||
        wall.maxX <= -GROUND_HALF_EXTENT_X ||
        wall.minZ >= GROUND_HALF_EXTENT_Z ||
        wall.maxZ <= -GROUND_HALF_EXTENT_Z;
      expect(outsideGround).toBe(true);
    }
  });

  it("places the NPC, materials, and treasure within the region's walkable ground", () => {
    for (const spot of [NPC_SPOT, ROPE_COIL_SPOT, TOOLBOX_SPOT, TREASURE_SPOT]) {
      expect(insideGround(spot.x, spot.z)).toBe(true);
    }
  });

  it('keeps the NPC and dock materials on the dock side of the channel', () => {
    for (const spot of [NPC_SPOT, ROPE_COIL_SPOT, TOOLBOX_SPOT]) {
      expect(spot.x).toBeLessThan(CHANNEL_MIN_X);
    }
  });

  it('keeps the treasure on the cove side of the channel', () => {
    expect(TREASURE_SPOT.x).toBeGreaterThan(CHANNEL_MAX_X);
  });

  it('sizes the channel water strips to flank the bridge span with no gap or overlap', () => {
    expect(CHANNEL_NORTH_WATER.minZ).toBe(BRIDGE_SPAN.maxZ);
    expect(CHANNEL_SOUTH_WATER.maxZ).toBe(BRIDGE_SPAN.minZ);
    expect(CHANNEL_NORTH_WATER.minX).toBe(BRIDGE_SPAN.minX);
    expect(CHANNEL_SOUTH_WATER.minX).toBe(BRIDGE_SPAN.minX);
  });

  it('places the bridge approach zone on the dock side, immediately west of the channel', () => {
    expect(BRIDGE_APPROACH_ZONE.maxX).toBe(CHANNEL_MIN_X);
    expect(BRIDGE_APPROACH_ZONE.minX).toBeLessThan(CHANNEL_MIN_X);
  });

  it('places the tide tunnel and harbor exit zones within the walkable ground', () => {
    for (const zone of [TIDE_TUNNEL_ZONE, HARBOR_EXIT_ZONE]) {
      expect(Math.abs(zone.minX)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
      expect(Math.abs(zone.maxX)).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
    }
  });

  it('reaches the tide tunnel only from the cove side of the channel', () => {
    expect(TIDE_TUNNEL_ZONE.minX).toBeGreaterThan(CHANNEL_MAX_X);
  });

  it('places the harbor exit on the dock side, at the west edge', () => {
    expect(HARBOR_EXIT_ZONE.maxX).toBeLessThan(CHANNEL_MIN_X);
  });

  it('gives Pirate Builder Bay at least one checkpoint, each within the walkable ground', () => {
    expect(PIRATE_BUILDER_BAY_REGION_CHECKPOINTS.length).toBeGreaterThan(0);
    for (const checkpoint of PIRATE_BUILDER_BAY_REGION_CHECKPOINTS) {
      expect(insideGround(checkpoint.x, checkpoint.z)).toBe(true);
    }
  });
});
