import { describe, expect, it } from 'vitest';
import {
  getPirateBuilderBayDecorInteraction,
  PIRATE_BUILDER_BAY_DECOR,
} from './pirateBuilderBayDecor';
import { isOnWalkableTile, isWithinBounds } from './gridGeometry';
import {
  BAY_COLLIDING_TILES,
  PIRATE_BUILDER_BAY_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './pirateBuilderBayTilemap';
import { TILE_SIZE } from './tilemap';

describe('PIRATE_BUILDER_BAY_DECOR', () => {
  it('resolves every decor entry to a tap-triggered interaction', () => {
    for (const decor of PIRATE_BUILDER_BAY_DECOR) {
      const interaction = getPirateBuilderBayDecorInteraction(decor);
      expect(interaction.trigger).toBe('TAP');
    }
  });

  it('throws for a decor entry whose interactionId does not resolve', () => {
    expect(() =>
      getPirateBuilderBayDecorInteraction({
        id: 'ghost-prop',
        interactionId: 'nope',
        position: { x: 0, y: 0 },
        shape: 'ROPE',
        ambientAnimation: 'NONE',
      }),
    ).toThrow();
  });

  it('places every prop within world bounds on a walkable (non-colliding) tile', () => {
    for (const decor of PIRATE_BUILDER_BAY_DECOR) {
      expect(isWithinBounds(decor.position.x, decor.position.y, WORLD_WIDTH, WORLD_HEIGHT)).toBe(
        true,
      );
      expect(
        isOnWalkableTile(
          decor.position.x,
          decor.position.y,
          PIRATE_BUILDER_BAY_TILE_GRID,
          BAY_COLLIDING_TILES,
          TILE_SIZE,
        ),
      ).toBe(true);
    }
  });

  it('has no id collisions', () => {
    const ids = PIRATE_BUILDER_BAY_DECOR.map((decor) => decor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places the treasure chest east of the bridge, in the cove', () => {
    const chest = PIRATE_BUILDER_BAY_DECOR.find((decor) => decor.id === 'cove-treasure');
    expect(chest).toBeDefined();
    expect(chest!.position.x).toBeGreaterThan(16 * TILE_SIZE);
  });
});
