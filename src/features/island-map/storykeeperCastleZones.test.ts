import { describe, expect, it } from 'vitest';
import { STORYKEEPER_CASTLE_ZONES } from './storykeeperCastleZones';
import { STORYKEEPER_CASTLE_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

const walkInInteractions = STORYKEEPER_CASTLE_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('STORYKEEPER_CASTLE_ZONES', () => {
  it('has a zone for every walk-in Storykeeper Castle interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(STORYKEEPER_CASTLE_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(STORYKEEPER_CASTLE_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
    }
  });

  it('keeps every zone within the tile grid bounds', () => {
    const worldWidth = GRID_COLS * TILE_SIZE;
    const worldHeight = GRID_ROWS * TILE_SIZE;
    for (const rect of Object.values(STORYKEEPER_CASTLE_ZONES)) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(worldWidth);
      expect(rect.y + rect.height).toBeLessThanOrEqual(worldHeight);
    }
  });

  it('resolves the story hall and the already-told interactions to the exact same zone', () => {
    const before = STORYKEEPER_CASTLE_INTERACTIONS.find((item) => item.id === 'castle-story-hall');
    const after = STORYKEEPER_CASTLE_INTERACTIONS.find(
      (item) => item.id === 'castle-story-hall-told',
    );
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(STORYKEEPER_CASTLE_ZONES[before!.zoneId ?? before!.id]).toBe(
      STORYKEEPER_CASTLE_ZONES[after!.zoneId ?? after!.id],
    );
  });
});
