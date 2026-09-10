import { describe, expect, it } from 'vitest';
import { PIRATE_BUILDER_BAY_CHECKPOINTS } from '../../discovery/checkpoints';
import {
  BARRELS,
  BOUNDARY_WALLS,
  BRIDGE_APPROACH_ZONE,
  BRIDGE_SPAN,
  CHANNEL_BED_Y,
  CHANNEL_MAX_X,
  CHANNEL_MIN_X,
  CHANNEL_NORTH_WATER,
  CHANNEL_SOUTH_WATER,
  CHANNEL_SURFACE,
  COVE_GROUND,
  COVE_PATH_RUN,
  COVE_ROCKS,
  COVE_TREES,
  CRATES,
  DOCK_GROUND,
  FOLIAGE_TREES,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  JETTY_RUN,
  MOORING_POSTS,
  NPC_SPOT,
  PATH_RUN,
  PIRATE_BUILDER_BAY_REGION_CHECKPOINTS,
  ROCKS,
  ROPE_COIL_SPOT,
  SHIPWRECK,
  SHIPWRECK_FOOTPRINT,
  SHORE_ROCK_RUNS,
  SOLID_PROPS,
  TIDE_TUNNEL_BOULDERS,
  TIDE_TUNNEL_ZONE,
  TOOLBOX_SPOT,
  TREASURE_SPOT,
  WATER_SURFACE_Y,
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

  it('places the path run and foliage/rock accents within the walkable ground, on the dock side', () => {
    for (const point of [PATH_RUN.from, PATH_RUN.to, ...FOLIAGE_TREES, ...ROCKS]) {
      expect(insideGround(point.x, point.z)).toBe(true);
      expect(point.x).toBeLessThan(CHANNEL_MIN_X);
    }
  });
});

describe('pirateBuilderBay ground and channel', () => {
  /**
   * The regression this guards: the ground used to be one opaque plane
   * spanning the whole region with the water quads placed 5cm *underneath*
   * it, so the channel - the entire point of the region - was invisible and
   * the child walked into an unexplained invisible wall on flat sand.
   */
  it('tiles the region with dock, channel and cove, edge to edge with no gap or overlap', () => {
    expect(DOCK_GROUND.minX).toBe(-GROUND_HALF_EXTENT_X);
    expect(DOCK_GROUND.maxX).toBe(CHANNEL_SURFACE.minX);
    expect(CHANNEL_SURFACE.maxX).toBe(COVE_GROUND.minX);
    expect(COVE_GROUND.maxX).toBe(GROUND_HALF_EXTENT_X);
    for (const zone of [DOCK_GROUND, CHANNEL_SURFACE, COVE_GROUND]) {
      expect(zone.minZ).toBe(-GROUND_HALF_EXTENT_Z);
      expect(zone.maxZ).toBe(GROUND_HALF_EXTENT_Z);
    }
  });

  it('runs the drawn water surface unbroken under the bridge deck', () => {
    expect(CHANNEL_SURFACE.minZ).toBeLessThan(BRIDGE_SPAN.minZ);
    expect(CHANNEL_SURFACE.maxZ).toBeGreaterThan(BRIDGE_SPAN.maxZ);
  });

  it('sinks the water surface below the sand and the channel bed below the water', () => {
    expect(WATER_SURFACE_Y).toBeLessThan(0);
    expect(CHANNEL_BED_Y).toBeLessThan(WATER_SURFACE_Y);
  });
});

describe('pirateBuilderBay set dressing', () => {
  const DOCK_PROPS = [...MOORING_POSTS.map((post) => ({ ...post, dock: true }))];

  it('keeps every crate and barrel on land, clear of the channel', () => {
    for (const prop of [...CRATES, ...BARRELS]) {
      expect(insideGround(prop.x, prop.z)).toBe(true);
      expect(prop.x < CHANNEL_MIN_X || prop.x > CHANNEL_MAX_X).toBe(true);
    }
  });

  it('keeps cove foliage, the wreck and the tide tunnel boulders on the cove side', () => {
    for (const spot of [...COVE_TREES, ...COVE_ROCKS, ...TIDE_TUNNEL_BOULDERS, SHIPWRECK]) {
      expect(insideGround(spot.x, spot.z)).toBe(true);
      expect(spot.x).toBeGreaterThan(CHANNEL_MAX_X);
    }
  });

  it('frames the tide tunnel from either side rather than blocking its mouth', () => {
    const [west, east] = TIDE_TUNNEL_BOULDERS;
    expect(west.x).toBeLessThan(TIDE_TUNNEL_ZONE.minX);
    expect(east.x).toBeGreaterThan(TIDE_TUNNEL_ZONE.maxX);
  });

  it('runs the jetty out past the boundary, so it is scenery rather than walkable ground', () => {
    for (const point of [JETTY_RUN.from, JETTY_RUN.to, ...DOCK_PROPS]) {
      expect(point.z).toBeLessThan(-GROUND_HALF_EXTENT_Z);
    }
  });

  it('picks the cove path up on the far side of the channel', () => {
    expect(COVE_PATH_RUN.from.x).toBeGreaterThan(CHANNEL_MAX_X);
    expect(COVE_PATH_RUN.to.x).toBeGreaterThan(COVE_PATH_RUN.from.x);
    expect(insideGround(COVE_PATH_RUN.to.x, COVE_PATH_RUN.to.z)).toBe(true);
  });

  /**
   * The shore boulder lines stand in for boundary colliders that had no
   * mesh at all. They must not wall off the two openings: the channel
   * mouths (water) and the Welcome Harbor exit (a doorway).
   */
  it('leaves the channel mouths and the harbor exit open in the shore boulder lines', () => {
    for (const run of SHORE_ROCK_RUNS) {
      for (const point of [run.from, run.to]) {
        const inChannelMouth = point.x > CHANNEL_MIN_X && point.x < CHANNEL_MAX_X;
        expect(inChannelMouth).toBe(false);
      }
      const alongWestEdge =
        run.from.x === -GROUND_HALF_EXTENT_X && run.to.x === -GROUND_HALF_EXTENT_X;
      if (alongWestEdge) {
        const spansExit =
          Math.min(run.from.z, run.to.z) < HARBOR_EXIT_ZONE.maxZ &&
          Math.max(run.from.z, run.to.z) > HARBOR_EXIT_ZONE.minZ;
        expect(spansExit).toBe(false);
      }
    }
  });
});

describe('pirateBuilderBay solid prop footprints', () => {
  it('gives the wreck a footprint that actually contains it', () => {
    expect(isInsideRect(SHIPWRECK.x, SHIPWRECK.z, SHIPWRECK_FOOTPRINT)).toBe(true);
  });

  /** A collider on top of a checkpoint would strand a returning child inside a solid prop. */
  it('leaves every checkpoint and both path runs walkable', () => {
    const mustStayClear = [
      ...PIRATE_BUILDER_BAY_CHECKPOINTS.map((checkpoint) => ({
        x: checkpoint.x,
        z: checkpoint.z,
      })),
      PATH_RUN.from,
      PATH_RUN.to,
      COVE_PATH_RUN.from,
      COVE_PATH_RUN.to,
      TREASURE_SPOT,
      NPC_SPOT,
    ];
    for (const point of mustStayClear) {
      for (const prop of SOLID_PROPS) {
        expect(
          isInsideRect(point.x, point.z, prop),
          `${prop.id} blocks (${point.x}, ${point.z})`,
        ).toBe(false);
      }
    }
  });
});
