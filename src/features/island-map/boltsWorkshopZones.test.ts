import { describe, expect, it } from 'vitest';
import { BOLTS_WORKSHOP_ZONES } from './boltsWorkshopZones';
import { BOLTS_WORKSHOP_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = BOLTS_WORKSHOP_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('BOLTS_WORKSHOP_ZONES', () => {
  it("has a zone for every walk-in Bolt's Workshop interaction", () => {
    for (const interaction of walkInInteractions) {
      expect(BOLTS_WORKSHOP_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(BOLTS_WORKSHOP_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(BOLTS_WORKSHOP_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });
});
