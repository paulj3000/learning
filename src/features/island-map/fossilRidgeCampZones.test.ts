import { describe, expect, it } from 'vitest';
import { FOSSIL_RIDGE_CAMP_ZONES } from './fossilRidgeCampZones';
import { FOSSIL_RIDGE_CAMP_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = FOSSIL_RIDGE_CAMP_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('FOSSIL_RIDGE_CAMP_ZONES', () => {
  it('has a zone for every walk-in Fossil Ridge Camp interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(FOSSIL_RIDGE_CAMP_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(FOSSIL_RIDGE_CAMP_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(FOSSIL_RIDGE_CAMP_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });
});
