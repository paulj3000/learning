import { describe, expect, it } from 'vitest';
import { CASTLE_OBSERVATORY_INTERACTIONS, OBSERVATORY_CHART_STAR_COUNT } from './castleObservatory';
import {
  TOWER_WINDOW_SPOTS,
  ZONES,
  STORYKEEPER_CASTLE_REGION_CHECKPOINTS,
} from './storykeeperCastleRegion';
import { CASTLE_DECOR } from './runtime/manifests/storykeeperCastleVisuals';
import { TOWER_STAR_CHART, TOWER_TELESCOPE } from './runtime/manifests/castleRooms/settingTower';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';

/**
 * The Observatory is the Setting Tower's second job. What must hold: the
 * tower's own choice (three windows, one arrival zone) is untouched, the
 * observing points are flavour only and cannot be got wrong, the chart draws
 * exactly the stars it invites a child to count, and nothing stands in front
 * of a window.
 */

const overlaps = (
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

const zone = (id: string) => ZONES.find((candidate) => candidate.id === id)!;

describe('the Observatory in the Setting Tower', () => {
  it('only describes: no observing point grades, grants, records, starts or moves anything', () => {
    expect(CASTLE_OBSERVATORY_INTERACTIONS).toHaveLength(2);
    for (const interaction of CASTLE_OBSERVATORY_INTERACTIONS) {
      expect(interaction.action.kind, interaction.id).toBe('SHOW_MESSAGE');
      expect(interaction.trigger).toBe('APPROACH');
      expect(interaction.requirements).toEqual([{ type: 'ALWAYS' }]);
    }
  });

  it('puts each observing point in its own zone, inside the tower, clear of every window and the arrival', () => {
    const protectedZones = ZONES.filter(
      (z) => z.id.startsWith('tower-window-') || z.id === 'castle-setting-tower',
    );
    expect(protectedZones).toHaveLength(4);
    for (const interaction of CASTLE_OBSERVATORY_INTERACTIONS) {
      const observing = zone(interaction.zoneId!);
      expect(observing, interaction.id).toBeDefined();
      for (const other of protectedZones) {
        expect(overlaps(observing, other), `${observing.id} overlaps ${other.id}`).toBe(false);
      }
      expect(observing.minX).toBeGreaterThanOrEqual(5.25);
      expect(observing.maxX).toBeLessThanOrEqual(9.75);
      expect(observing.minZ).toBeGreaterThanOrEqual(5.25);
      expect(observing.maxZ).toBeLessThanOrEqual(9.75);
    }
    expect(overlaps(zone('observatory-telescope'), zone('observatory-chart'))).toBe(false);
  });

  it('leaves the tower choice exactly as it was: three windows, still bound to the same zones', () => {
    expect(TOWER_WINDOW_SPOTS.map((spot) => spot.entityId)).toEqual([
      'tower-window-island',
      'tower-window-mountain',
      'tower-window-cave',
    ]);
    expect(zone('tower-window-island')).toMatchObject({
      minX: 6.3,
      maxX: 8.2,
      minZ: 8.4,
      maxZ: 9.6,
    });
    expect(zone('tower-window-mountain')).toMatchObject({
      minX: 8.4,
      maxX: 9.6,
      minZ: 6.4,
      maxZ: 8.2,
    });
    expect(zone('tower-window-cave')).toMatchObject({ minX: 6.3, maxX: 8.2, minZ: 5.4, maxZ: 6.6 });
    expect(MANIFEST.adventureBindings.length).toBeGreaterThan(0);
  });

  it('draws exactly as many gold stars as the chart invites a child to count', () => {
    const stars = CASTLE_DECOR.filter((item) => /^castle-star-chart-star-\d+$/.test(item.id));
    expect(stars).toHaveLength(OBSERVATORY_CHART_STAR_COUNT);
    const chart = CASTLE_OBSERVATORY_INTERACTIONS.find((i) => i.id === 'castle-observatory-chart')!;
    expect(chart.action.kind === 'SHOW_MESSAGE' && chart.action.message).toMatch(
      /count the gold stars/i,
    );
    // And the message names no number, so no child can be told they counted wrong.
    expect(chart.action.kind === 'SHOW_MESSAGE' && chart.action.message).not.toMatch(
      /\d|five|four|six/i,
    );
  });

  it('keeps every chart star on the chart', () => {
    for (const item of CASTLE_DECOR) {
      if (item.kind !== 'BOX' || !/^castle-star-chart-star-/.test(item.id)) continue;
      expect(item.area.minZ).toBeGreaterThanOrEqual(TOWER_STAR_CHART.minZ);
      expect(item.area.maxZ).toBeLessThanOrEqual(TOWER_STAR_CHART.maxZ);
      expect(item.minY).toBeGreaterThanOrEqual(TOWER_STAR_CHART.minY);
      expect(item.maxY).toBeLessThanOrEqual(TOWER_STAR_CHART.maxY);
    }
  });

  it('keeps the telescope solid at its stand only, and its tube above head height of a child', () => {
    const stand = MANIFEST.colliders.find((c) => c.rect.id === 'collider:tower-telescope');
    expect(stand).toBeDefined();
    expect((stand!.rect.minX + stand!.rect.maxX) / 2).toBeCloseTo(TOWER_TELESCOPE.x, 6);
    const tube = CASTLE_DECOR.find((item) => item.id === 'castle-telescope-tube');
    expect(tube?.kind === 'BOX' && tube.minY).toBeGreaterThanOrEqual(1.1);
    // The tube is never its own collider.
    expect(MANIFEST.colliders.some((c) => c.rect.id.includes('telescope-tube'))).toBe(false);
  });

  it('keeps the tower reachable from the spawn with the telescope in place', () => {
    expect(
      STORYKEEPER_CASTLE_REGION_CHECKPOINTS.some((c) => c.id === 'storykeeper-castle:tower'),
    ).toBe(true);
  });

  it('reads aloud without an em dash', () => {
    for (const interaction of CASTLE_OBSERVATORY_INTERACTIONS) {
      const text = `${interaction.title} ${interaction.action.kind === 'SHOW_MESSAGE' ? interaction.action.message : ''}`;
      expect(text).not.toMatch(/—|–/);
    }
  });
});
