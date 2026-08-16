import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_ZONES } from './zones';
import { WELCOME_HARBOR_INTERACTIONS } from './worldObjects';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './tilemap';

/**
 * Only APPROACH/ENTER interactions have a walk-in zone (`zones.ts`'s header
 * comment) — TAP/USE interactions (NPCs, decor/objects) get their position
 * from `npcs.ts`/`decor.ts` instead, since those need a real sprite to
 * hit-test against. This is a deliberate narrowing from Phase 9, where every
 * interaction had a zone; do not "fix" these tests back to covering every
 * interaction.
 */
const walkInInteractions = WELCOME_HARBOR_INTERACTIONS.filter(
  (interaction) => interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER',
);

describe('WELCOME_HARBOR_ZONES', () => {
  it('has a zone for every walk-in Welcome Harbor interaction', () => {
    for (const interaction of walkInInteractions) {
      expect(WELCOME_HARBOR_ZONES[interaction.zoneId ?? interaction.id]).toBeDefined();
    }
  });

  it('has no orphan zones without a matching interaction', () => {
    const zoneIds = new Set(walkInInteractions.map((item) => item.zoneId ?? item.id));
    for (const zoneId of Object.keys(WELCOME_HARBOR_ZONES)) {
      expect(zoneIds.has(zoneId)).toBe(true);
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

  it('resolves the broken-bridge and post-repair crossing interactions to the exact same zone', () => {
    const before = WELCOME_HARBOR_INTERACTIONS.find((item) => item.id === 'broken-bridge');
    const after = WELCOME_HARBOR_INTERACTIONS.find(
      (item) => item.id === 'moonlight-bridge-crossing',
    );
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(WELCOME_HARBOR_ZONES[before!.zoneId ?? before!.id]).toBe(
      WELCOME_HARBOR_ZONES[after!.zoneId ?? after!.id],
    );
  });
});
