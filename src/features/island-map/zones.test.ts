import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_ZONES } from './zones';
import { WELCOME_HARBOR_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

describe('WELCOME_HARBOR_ZONES', () => {
  it('has a zone for every Welcome Harbor interaction', () => {
    for (const interaction of WELCOME_HARBOR_INTERACTIONS) {
      expect(WELCOME_HARBOR_ZONES[interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const interactionIds = new Set(WELCOME_HARBOR_INTERACTIONS.map((item) => item.id));
    for (const zoneId of Object.keys(WELCOME_HARBOR_ZONES)) {
      expect(interactionIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(WELCOME_HARBOR_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });
});
