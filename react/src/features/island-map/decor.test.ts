import { describe, expect, it } from 'vitest';
import {
  getDecorInteraction,
  WELCOME_HARBOR_DECOR,
  WELCOME_HARBOR_WATER_SHIMMER_POINTS,
} from './decor';
import { isOnWalkableTile, isWithinWorldBounds } from './npcs';
import { HARBOR_TILE_GRID, HarborTile, TILE_SIZE } from './tilemap';

describe('WELCOME_HARBOR_DECOR', () => {
  it('resolves every decor entry to a tap-triggered interaction', () => {
    for (const decor of WELCOME_HARBOR_DECOR) {
      const interaction = getDecorInteraction(decor);
      expect(interaction.trigger).toBe('TAP');
    }
  });

  it('throws for a decor entry whose interactionId does not resolve', () => {
    expect(() =>
      getDecorInteraction({
        id: 'ghost-prop',
        interactionId: 'nope',
        position: { x: 0, y: 0 },
        shape: 'SIGN',
        ambientAnimation: 'NONE',
      }),
    ).toThrow();
  });

  it('places every prop within world bounds on a walkable (non-water) tile', () => {
    for (const decor of WELCOME_HARBOR_DECOR) {
      expect(isWithinWorldBounds(decor.position.x, decor.position.y)).toBe(true);
      expect(isOnWalkableTile(decor.position.x, decor.position.y)).toBe(true);
    }
  });

  it('has no id collisions with the NPC registry or with itself', () => {
    const ids = WELCOME_HARBOR_DECOR.map((decor) => decor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('WELCOME_HARBOR_WATER_SHIMMER_POINTS', () => {
  it('sits on water tiles specifically', () => {
    for (const point of WELCOME_HARBOR_WATER_SHIMMER_POINTS) {
      const col = Math.floor(point.x / TILE_SIZE);
      const row = Math.floor(point.y / TILE_SIZE);
      expect(HARBOR_TILE_GRID[row][col]).toBe(HarborTile.WATER);
    }
  });
});
