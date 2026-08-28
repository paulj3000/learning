import { describe, expect, it } from 'vitest';
import {
  ARCHWAYS,
  FLOOR_SPOTS,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  ROOMS,
  STORYKEEPER_CASTLE_REGION_CHECKPOINTS,
  WALL_MOUNTED_SPOTS,
  WALL_SEGMENTS,
  ZONES,
  buildWallSegments,
  findZone,
  isBlocked,
  isInsideRect,
  isOnFloor,
  isWalkable,
} from './storykeeperCastleRegion';
import type { RectZone } from './storykeeperCastleRegion';

const GRID_STEP = 0.25;

/**
 * Flood fills the castle's walkable floor from one point, on a 0.25m grid.
 * The step is deliberately half the 0.5m wall thickness, so no wall can be
 * stepped over and no archway gap can be missed between samples.
 */
function reachableFrom(
  start: { x: number; z: number },
  walkable: (x: number, z: number) => boolean,
): Set<string> {
  const key = (x: number, z: number) => `${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`;
  const snap = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP;

  const startX = snap(start.x);
  const startZ = snap(start.z);
  if (!walkable(startX, startZ)) {
    return new Set();
  }

  const seen = new Set<string>([key(startX, startZ)]);
  const queue: { x: number; z: number }[] = [{ x: startX, z: startZ }];

  while (queue.length > 0) {
    const cell = queue.pop() as { x: number; z: number };
    for (const [dx, dz] of [
      [GRID_STEP, 0],
      [-GRID_STEP, 0],
      [0, GRID_STEP],
      [0, -GRID_STEP],
    ]) {
      const x = cell.x + dx;
      const z = cell.z + dz;
      if (Math.abs(x) > GROUND_HALF_EXTENT_X || Math.abs(z) > GROUND_HALF_EXTENT_Z) continue;
      const cellKey = key(x, z);
      if (seen.has(cellKey) || !walkable(x, z)) continue;
      seen.add(cellKey);
      queue.push({ x, z });
    }
  }

  return seen;
}

function isReachable(reached: Set<string>, x: number, z: number): boolean {
  return reached.has(`${Math.round(x / GRID_STEP)}:${Math.round(z / GRID_STEP)}`);
}

function centerOf(rect: RectZone): { x: number; z: number } {
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
}

const SPAWN = STORYKEEPER_CASTLE_REGION_CHECKPOINTS[0];
const REACHED = reachableFrom(SPAWN, isWalkable);

describe('isInsideRect', () => {
  const zone: RectZone = { id: 'z', minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

  it('is true for a point inside the rect, including its edge', () => {
    expect(isInsideRect(0, 0, zone)).toBe(true);
    expect(isInsideRect(1, -1, zone)).toBe(true);
  });

  it('is false for a point outside the rect', () => {
    expect(isInsideRect(2, 0, zone)).toBe(false);
    expect(isInsideRect(0, -2, zone)).toBe(false);
  });
});

describe('storykeeperCastleRegion rooms', () => {
  it('has unique room ids', () => {
    const ids = ROOMS.map((room) => room.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every room floor inside the region ground extents', () => {
    for (const room of ROOMS) {
      expect(room.floor.minX).toBeGreaterThanOrEqual(-GROUND_HALF_EXTENT_X);
      expect(room.floor.maxX).toBeLessThanOrEqual(GROUND_HALF_EXTENT_X);
      expect(room.floor.minZ).toBeGreaterThanOrEqual(-GROUND_HALF_EXTENT_Z);
      expect(room.floor.maxZ).toBeLessThanOrEqual(GROUND_HALF_EXTENT_Z);
    }
  });

  it('never overlaps two room floors', () => {
    for (let i = 0; i < ROOMS.length; i += 1) {
      for (let j = i + 1; j < ROOMS.length; j += 1) {
        const a = ROOMS[i].floor;
        const b = ROOMS[j].floor;
        const overlapping =
          a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
        expect(overlapping, `rooms "${ROOMS[i].id}" and "${ROOMS[j].id}" overlap`).toBe(false);
      }
    }
  });

  it('gives every room a child-facing label', () => {
    for (const room of ROOMS) {
      expect(room.label.length).toBeGreaterThan(0);
    }
  });
});

describe('storykeeperCastleRegion archways', () => {
  it('names two real, distinct rooms per archway', () => {
    const roomIds = new Set(ROOMS.map((room) => room.id));
    for (const archway of ARCHWAYS) {
      const [from, to] = archway.between;
      expect(roomIds.has(from), `${archway.id} names unknown room "${from}"`).toBe(true);
      expect(roomIds.has(to), `${archway.id} names unknown room "${to}"`).toBe(true);
      expect(from).not.toBe(to);
    }
  });

  /**
   * The gap must straddle the shared edge: part of it inside each room. A gap
   * that sat wholly inside one room would leave the other's wall solid, which
   * reads in-world as a doorway you cannot walk through.
   */
  it('straddles the shared edge, with walkable floor on both sides', () => {
    for (const archway of ARCHWAYS) {
      const [fromId, toId] = archway.between;
      const from = ROOMS.find((room) => room.id === fromId);
      const to = ROOMS.find((room) => room.id === toId);
      const center = centerOf(archway.gap);

      const towardFrom = {
        x: (center.x + centerOf(from!.floor).x) / 2,
        z: (center.z + centerOf(from!.floor).z) / 2,
      };
      const towardTo = {
        x: (center.x + centerOf(to!.floor).x) / 2,
        z: (center.z + centerOf(to!.floor).z) / 2,
      };

      expect(isOnFloor(center.x, center.z), `${archway.id} center is off the floor`).toBe(true);
      expect(isInsideRect(towardFrom.x, towardFrom.z, from!.floor)).toBe(true);
      expect(isInsideRect(towardTo.x, towardTo.z, to!.floor)).toBe(true);
    }
  });

  it('leaves every archway gap walkable, not sealed by the wall it cuts', () => {
    for (const archway of ARCHWAYS) {
      const center = centerOf(archway.gap);
      expect(isBlocked(center.x, center.z), `${archway.id} is sealed by a wall`).toBe(false);
      expect(isWalkable(center.x, center.z)).toBe(true);
    }
  });
});

describe('storykeeperCastleRegion walls', () => {
  it('generates wall segments for every room', () => {
    for (const room of ROOMS) {
      const own = WALL_SEGMENTS.filter((wall) => wall.id.startsWith(`wall:${room.id}:`));
      expect(own.length, `room "${room.id}" has no walls`).toBeGreaterThan(0);
    }
  });

  it('gives every wall segment a unique id and a positive footprint', () => {
    const ids = WALL_SEGMENTS.map((wall) => wall.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const wall of WALL_SEGMENTS) {
      expect(wall.maxX).toBeGreaterThan(wall.minX);
      expect(wall.maxZ).toBeGreaterThan(wall.minZ);
    }
  });

  it('encloses the castle: stepping off the floor is always blocked or off-floor', () => {
    // Sample just outside each room's floor on all four sides. Nothing there
    // may be walkable, or the castle leaks into the void.
    for (const room of ROOMS) {
      const { floor } = room;
      const center = centerOf(floor);
      const probes = [
        { x: center.x, z: floor.maxZ + 0.15 },
        { x: center.x, z: floor.minZ - 0.15 },
        { x: floor.maxX + 0.15, z: center.z },
        { x: floor.minX - 0.15, z: center.z },
      ];
      for (const probe of probes) {
        // A probe may land on a neighbouring room's floor - that is a shared
        // edge, not a leak, and the wall straddling it is what matters.
        const leaks = isWalkable(probe.x, probe.z) && !isOnFloor(probe.x, probe.z);
        expect(leaks, `room "${room.id}" leaks at (${probe.x}, ${probe.z})`).toBe(false);
      }
    }
  });
});

describe('storykeeperCastleRegion reachability', () => {
  it('spawns the child somewhere walkable', () => {
    expect(isWalkable(SPAWN.x, SPAWN.z)).toBe(true);
  });

  it('reaches every room from the spawn point on foot', () => {
    for (const room of ROOMS) {
      const center = centerOf(room.floor);
      expect(
        isReachable(REACHED, center.x, center.z),
        `room "${room.id}" is not reachable from spawn`,
      ).toBe(true);
    }
  });

  it('reaches every checkpoint from the spawn point on foot', () => {
    for (const checkpoint of STORYKEEPER_CASTLE_REGION_CHECKPOINTS) {
      expect(isWalkable(checkpoint.x, checkpoint.z), `${checkpoint.id} is inside a wall`).toBe(
        true,
      );
      expect(
        isReachable(REACHED, checkpoint.x, checkpoint.z),
        `${checkpoint.id} is not reachable from spawn`,
      ).toBe(true);
    }
  });

  it('reaches the way back out to Welcome Harbor', () => {
    const exit = findZone('castle-harbor-exit');
    expect(exit).toBeDefined();
    const center = centerOf(exit!);
    expect(isReachable(REACHED, center.x, center.z)).toBe(true);
  });

  /**
   * Proves the reachability above is actually load-bearing rather than
   * passing because the walls are wrong. With the library's archway sealed,
   * the Great Library must become unreachable.
   */
  it('is sensitive to the archways: sealing one strands the room behind it', () => {
    const withoutLibraryArch = buildWallSegments(
      ROOMS,
      ARCHWAYS.filter((archway) => archway.id !== 'arch-library').map((archway) => archway.gap),
    );
    const sealedWalkable = (x: number, z: number) =>
      isOnFloor(x, z) && !withoutLibraryArch.some((wall) => isInsideRect(x, z, wall));

    const reached = reachableFrom(SPAWN, sealedWalkable);
    const library = ROOMS.find((room) => room.id === 'great-library');
    const center = centerOf(library!.floor);

    expect(isReachable(reached, center.x, center.z)).toBe(false);
    // ...while the story hall, on the near side, is still reachable.
    const hall = centerOf(ROOMS.find((room) => room.id === 'story-hall')!.floor);
    expect(isReachable(reached, hall.x, hall.z)).toBe(true);
  });
});

describe('storykeeperCastleRegion zones', () => {
  it('has unique zone ids', () => {
    const ids = ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every zone on walkable floor the child can actually reach', () => {
    for (const zone of ZONES) {
      const center = centerOf(zone);
      expect(isWalkable(center.x, center.z), `zone "${zone.id}" is not walkable`).toBe(true);
      expect(
        isReachable(REACHED, center.x, center.z),
        `zone "${zone.id}" is not reachable from spawn`,
      ).toBe(true);
    }
  });

  it('never overlaps the arrival zone with the way out', () => {
    const entrance = findZone('castle-entrance')!;
    const exit = findZone('castle-harbor-exit')!;
    const overlapping =
      entrance.minX < exit.maxX &&
      exit.minX < entrance.maxX &&
      entrance.minZ < exit.maxZ &&
      exit.minZ < entrance.maxZ;
    expect(overlapping).toBe(false);
  });

  it('keeps the three setting-tower window zones apart from each other', () => {
    const windows = ZONES.filter((zone) => zone.id.startsWith('tower-window-'));
    expect(windows).toHaveLength(3);
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i];
        const b = windows[j];
        const overlapping =
          a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
        expect(overlapping, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('keeps the unmarked tapestry secret clear of every other zone', () => {
    const secret = findZone('castle-tapestry-stair')!;
    for (const zone of ZONES) {
      if (zone.id === secret.id) continue;
      const overlapping =
        secret.minX < zone.maxX &&
        zone.minX < secret.maxX &&
        secret.minZ < zone.maxZ &&
        zone.minZ < secret.maxZ;
      expect(overlapping, `the tapestry secret overlaps "${zone.id}"`).toBe(false);
    }
  });
});

describe('storykeeperCastleRegion entity spots', () => {
  const allSpots = [...FLOOR_SPOTS, ...WALL_MOUNTED_SPOTS];

  it('has unique entity ids', () => {
    const ids = allSpots.map((spot) => spot.entityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places nothing inside a wall or off the floor', () => {
    for (const spot of allSpots) {
      expect(isOnFloor(spot.x, spot.z), `"${spot.entityId}" is off the floor`).toBe(true);
      expect(isBlocked(spot.x, spot.z), `"${spot.entityId}" is buried in a wall`).toBe(false);
    }
  });

  it('gives every wall-mounted spot a sensible mounting height', () => {
    for (const spot of WALL_MOUNTED_SPOTS) {
      expect(spot.y).toBeGreaterThan(0);
      // WALL_HEIGHT is 3 in sceneKit.ts; nothing may be mounted above the wall.
      expect(spot.y).toBeLessThan(3);
    }
  });

  it('authors exactly nine counting stars, in rows of five and four', () => {
    const stars = WALL_MOUNTED_SPOTS.filter((spot) => spot.entityId.startsWith('counting-star-'));
    expect(stars).toHaveLength(9);
    const rows = new Map<number, number>();
    for (const star of stars) {
      rows.set(star.y, (rows.get(star.y) ?? 0) + 1);
    }
    expect([...rows.values()].sort((a, b) => b - a)).toEqual([5, 4]);
  });

  /**
   * The counting task must never be ambiguous about which carvings are part
   * of the nine (`docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` A.10, risk 3), so
   * the pattern lock's own carvings stay a clear distance away.
   */
  it('separates the nine counting stars from the pattern-lock carvings', () => {
    const stars = WALL_MOUNTED_SPOTS.filter((spot) => spot.entityId.startsWith('counting-star-'));
    const lock = WALL_MOUNTED_SPOTS.filter((spot) => spot.entityId.startsWith('lock-carving-'));
    expect(lock).toHaveLength(6);

    for (const star of stars) {
      for (const carving of lock) {
        expect(Math.hypot(star.x - carving.x, star.y - carving.y)).toBeGreaterThan(1);
      }
    }
  });

  it('hangs at least three tapestries, so the secret one is not the only one', () => {
    const tapestries = WALL_MOUNTED_SPOTS.filter((spot) => spot.entityId.includes('tapestry'));
    expect(tapestries.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Beat 8's payoff depends on the child having walked past the empty slot
   * before they had anything to put in it, so it sits inside the library's
   * own arrival zone rather than deep in the stacks.
   */
  it('places the empty shelf slot within sight of the library arrival zone', () => {
    const slot = WALL_MOUNTED_SPOTS.find((spot) => spot.entityId === 'library-shelf-slot')!;
    const arrival = centerOf(findZone('castle-great-library')!);
    expect(Math.hypot(slot.x - arrival.x, slot.z - arrival.z)).toBeLessThan(5);
  });
});
