import { describe, expect, it } from 'vitest';
import { CASTLE_DOORS, CASTLE_ROOMS, arrivalIn } from '../../castleLayout';
import { STORYKEEPER_CASTLE_REGION_CHECKPOINTS } from '../../storykeeperCastleRegion';
import { isManifestWalkable, isReached, reachableCells } from '../testing/castleReachability';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * The layout is derived from the region, which knows only the derived walls.
 * The manifest adds solid decor (dais, columns, hearth, racks, orrery, table),
 * so the promises the layout makes (a safe spot, a landing point a metre
 * inside every door) are re-checked against the colliders the child really
 * meets.
 */
describe('castle layout against the real manifest colliders', () => {
  const reached = reachableCells(MANIFEST, STORYKEEPER_CASTLE_REGION_CHECKPOINTS[0]);

  it('keeps every room safe spot walkable and reachable from the spawn', () => {
    for (const room of CASTLE_ROOMS) {
      expect(
        isManifestWalkable(MANIFEST, room.safeSpot.x, room.safeSpot.z),
        `${room.id} safe spot is solid`,
      ).toBe(true);
      expect(
        isReached(reached, room.safeSpot.x, room.safeSpot.z),
        `${room.id} safe spot is cut off`,
      ).toBe(true);
    }
  });

  it('lands the child on open, reachable floor through every door, from either side', () => {
    for (const door of CASTLE_DOORS) {
      for (const roomId of door.between) {
        const { x, z } = arrivalIn(door, roomId)!;
        expect(
          isManifestWalkable(MANIFEST, x, z),
          `${door.id} lands in ${roomId} on solid decor`,
        ).toBe(true);
        expect(isReached(reached, x, z), `${door.id} lands in ${roomId} on a cut-off cell`).toBe(
          true,
        );
      }
    }
  });

  it('keeps the doorway itself clear of every collider', () => {
    for (const door of CASTLE_DOORS) {
      expect(
        isManifestWalkable(MANIFEST, door.centre.x, door.centre.z),
        `${door.id} is blocked`,
      ).toBe(true);
    }
  });
});
