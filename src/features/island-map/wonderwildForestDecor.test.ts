import { describe, expect, it } from 'vitest';
import {
  getWonderwildForestDecorInteraction,
  WONDERWILD_FOREST_DECOR,
} from './wonderwildForestDecor';
import { isOnWalkableTile, isWithinBounds } from './gridGeometry';
import {
  WONDERWILD_COLLIDING_TILES,
  WONDERWILD_FOREST_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './wonderwildForestTilemap';
import { TILE_SIZE } from './tilemap';

describe('WONDERWILD_FOREST_DECOR', () => {
  it('resolves every decor entry to a real interaction', () => {
    for (const decor of WONDERWILD_FOREST_DECOR) {
      expect(() => getWonderwildForestDecorInteraction(decor)).not.toThrow();
    }
  });

  it('throws for a decor entry whose interactionId does not resolve', () => {
    expect(() =>
      getWonderwildForestDecorInteraction({
        id: 'ghost-prop',
        interactionId: 'nope',
        position: { x: 0, y: 0 },
        shape: 'LEAVES',
        ambientAnimation: 'NONE',
      }),
    ).toThrow();
  });

  it('places every prop within world bounds on a walkable (non-colliding) tile', () => {
    for (const decor of WONDERWILD_FOREST_DECOR) {
      expect(isWithinBounds(decor.position.x, decor.position.y, WORLD_WIDTH, WORLD_HEIGHT)).toBe(
        true,
      );
      expect(
        isOnWalkableTile(
          decor.position.x,
          decor.position.y,
          WONDERWILD_FOREST_TILE_GRID,
          WONDERWILD_COLLIDING_TILES,
          TILE_SIZE,
        ),
      ).toBe(true);
    }
  });

  it('has no id collisions', () => {
    const ids = WONDERWILD_FOREST_DECOR.map((decor) => decor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('binds the bee hive sprite to the always-available tap-flavor interaction, not either half of the approach pair', () => {
    const hive = WONDERWILD_FOREST_DECOR.find((decor) => decor.id === 'wonderwild-beehive');
    expect(hive).toBeDefined();
    expect(hive!.interactionId).toBe('wonderwild-beehive-peek');
  });
});
