import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_ZONES } from './zones';
import { HARBOR_TILE_GRID, HARBOR_COLLIDING_TILES } from './tilemap';
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

/**
 * Phase 26 laid new walk-in zones into this region (docs/ROADMAP.md
 * Phase 26). Both checks below are about geometry a unit test can catch and
 * a code review cannot: a zone drawn on an impassable tile is a secret no
 * child can ever reach, and two overlapping zones both fire when the avatar
 * steps between them, so one of the two panels is unreachable in practice.
 */
describe('WELCOME_HARBOR_ZONES geometry', () => {
  it('places every zone on tiles a child can actually walk onto', () => {
    const colliding = new Set<number>(HARBOR_COLLIDING_TILES);
    for (const [zoneId, rect] of Object.entries(WELCOME_HARBOR_ZONES)) {
      let walkable = 0;
      for (let y = rect.y; y < rect.y + rect.height; y += TILE_SIZE) {
        for (let x = rect.x; x < rect.x + rect.width; x += TILE_SIZE) {
          const tile = HARBOR_TILE_GRID[y / TILE_SIZE]?.[x / TILE_SIZE];
          if (tile !== undefined && !colliding.has(tile)) walkable += 1;
        }
      }
      expect(walkable, `${zoneId} has no walkable tile`).toBeGreaterThan(0);
    }
  });

  it('never overlaps two different zones', () => {
    const entries = Object.entries(WELCOME_HARBOR_ZONES);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [aId, a] = entries[i];
        const [bId, b] = entries[j];
        // Two interactions deliberately sharing one spot share the exact
        // same rect object (e.g. a before/after pair); that is not an
        // overlap between two different places.
        if (a === b) continue;
        const overlaps =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlaps, `${aId} overlaps ${bId}`).toBe(false);
      }
    }
  });
});
