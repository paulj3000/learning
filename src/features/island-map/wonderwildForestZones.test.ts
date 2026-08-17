import { describe, expect, it } from 'vitest';
import { WONDERWILD_FOREST_ZONES } from './wonderwildForestZones';
import { WONDERWILD_FOREST_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = WONDERWILD_FOREST_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('WONDERWILD_FOREST_ZONES', () => {
  it('has a zone for every walk-in Wonderwild Forest interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(WONDERWILD_FOREST_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(WONDERWILD_FOREST_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(WONDERWILD_FOREST_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });

  it('resolves the bee hive and the already-discovered interactions to the exact same zone', () => {
    const before = WONDERWILD_FOREST_INTERACTIONS.find((item) => item.id === 'wonderwild-beehive');
    const after = WONDERWILD_FOREST_INTERACTIONS.find(
      (item) => item.id === 'wonderwild-beehive-discovered',
    );
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(WONDERWILD_FOREST_ZONES[before!.zoneId ?? before!.id]).toBe(
      WONDERWILD_FOREST_ZONES[after!.zoneId ?? after!.id],
    );
  });
});
