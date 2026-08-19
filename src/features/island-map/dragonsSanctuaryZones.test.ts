import { describe, expect, it } from 'vitest';
import { DRAGONS_SANCTUARY_ZONES } from './dragonsSanctuaryZones';
import { DRAGONS_SANCTUARY_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = DRAGONS_SANCTUARY_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('DRAGONS_SANCTUARY_ZONES', () => {
  it('has a zone for every walk-in Dragon Sanctuary interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(DRAGONS_SANCTUARY_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(DRAGONS_SANCTUARY_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(DRAGONS_SANCTUARY_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });
});
