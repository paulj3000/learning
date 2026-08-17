import { describe, expect, it } from 'vitest';
import { PIRATE_BUILDER_BAY_ZONES } from './pirateBuilderBayZones';
import { PIRATE_BUILDER_BAY_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = PIRATE_BUILDER_BAY_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('PIRATE_BUILDER_BAY_ZONES', () => {
  it('has a zone for every walk-in Pirate Builder Bay interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(PIRATE_BUILDER_BAY_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(PIRATE_BUILDER_BAY_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(PIRATE_BUILDER_BAY_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });

  it('resolves the broken-bridge and post-repair interactions to the exact same zone', () => {
    const before = PIRATE_BUILDER_BAY_INTERACTIONS.find((item) => item.id === 'bay-broken-bridge');
    const after = PIRATE_BUILDER_BAY_INTERACTIONS.find((item) => item.id === 'bay-bridge-repaired');
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(PIRATE_BUILDER_BAY_ZONES[before!.zoneId ?? before!.id]).toBe(
      PIRATE_BUILDER_BAY_ZONES[after!.zoneId ?? after!.id],
    );
  });
});
