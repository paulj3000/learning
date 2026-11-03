import { describe, expect, it } from 'vitest';
import {
  CASTLE_DOORS,
  CASTLE_ROOMS,
  SECRET_PASSAGE_DISCOVERY_ID,
  arrivalIn,
} from '../../castleLayout';
import type { WorldInteractionContext } from '../../../worldObjects';
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
  /** A child who has found the tapestry nook, so the secret passage is open. */
  const FOUND: WorldInteractionContext = {
    worldChangeKeys: [],
    discoveryIds: [SECRET_PASSAGE_DISCOVERY_ID],
  };
  const reached = reachableCells(MANIFEST, STORYKEEPER_CASTLE_REGION_CHECKPOINTS[0], FOUND);
  const sealed = reachableCells(MANIFEST, STORYKEEPER_CASTLE_REGION_CHECKPOINTS[0]);

  it('keeps every room safe spot walkable and reachable from the spawn', () => {
    for (const room of CASTLE_ROOMS) {
      expect(
        isManifestWalkable(MANIFEST, room.safeSpot.x, room.safeSpot.z, FOUND),
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
          isManifestWalkable(MANIFEST, x, z, FOUND),
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
        isManifestWalkable(MANIFEST, door.centre.x, door.centre.z, FOUND),
        `${door.id} is blocked`,
      ).toBe(true);
    }
  });

  it('keeps the secret chamber unreachable on foot until the nook is found', () => {
    const chamber = CASTLE_ROOMS.find((room) => room.id === 'secret-chamber')!;
    expect(isReached(sealed, chamber.safeSpot.x, chamber.safeSpot.z)).toBe(false);
    expect(isReached(reached, chamber.safeSpot.x, chamber.safeSpot.z)).toBe(true);
  });

  it('seals only the passage, so every other room is reachable whether or not the nook is found', () => {
    for (const room of CASTLE_ROOMS.filter((candidate) => candidate.id !== 'secret-chamber')) {
      expect(isReached(sealed, room.safeSpot.x, room.safeSpot.z), `${room.id} is cut off`).toBe(
        true,
      );
    }
  });
});
