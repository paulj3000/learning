import { describe, expect, it } from 'vitest';
import {
  getStorykeeperCastleDecorInteraction,
  STORYKEEPER_CASTLE_DECOR,
} from './storykeeperCastleDecor';
import { isOnWalkableTile, isWithinBounds } from './gridGeometry';
import {
  STORYKEEPER_CASTLE_COLLIDING_TILES,
  STORYKEEPER_CASTLE_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './storykeeperCastleTilemap';
import { TILE_SIZE } from './tilemap';

describe('STORYKEEPER_CASTLE_DECOR', () => {
  it('resolves every decor entry to a real interaction', () => {
    for (const decor of STORYKEEPER_CASTLE_DECOR) {
      expect(() => getStorykeeperCastleDecorInteraction(decor)).not.toThrow();
    }
  });

  it('throws for a decor entry whose interactionId does not resolve', () => {
    expect(() =>
      getStorykeeperCastleDecorInteraction({
        id: 'ghost-prop',
        interactionId: 'nope',
        position: { x: 0, y: 0 },
        shape: 'BOOKSHELF',
        ambientAnimation: 'NONE',
      }),
    ).toThrow();
  });

  it('places every prop within world bounds on a walkable (non-colliding) tile', () => {
    for (const decor of STORYKEEPER_CASTLE_DECOR) {
      expect(isWithinBounds(decor.position.x, decor.position.y, WORLD_WIDTH, WORLD_HEIGHT)).toBe(
        true,
      );
      expect(
        isOnWalkableTile(
          decor.position.x,
          decor.position.y,
          STORYKEEPER_CASTLE_TILE_GRID,
          STORYKEEPER_CASTLE_COLLIDING_TILES,
          TILE_SIZE,
        ),
      ).toBe(true);
    }
  });

  it('has no id collisions', () => {
    const ids = STORYKEEPER_CASTLE_DECOR.map((decor) => decor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds Keeper Quill to the always-available NPC-tap interaction', () => {
    const quill = STORYKEEPER_CASTLE_DECOR.find((decor) => decor.id === 'keeper-quill');
    expect(quill).toBeDefined();
    expect(quill!.interactionId).toBe('talk-to-keeper-quill');
  });
});
