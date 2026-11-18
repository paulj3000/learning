import { describe, expect, it } from 'vitest';
import { WALL_HEIGHT } from '../../sceneKit';
import { ARCHWAYS, WALL_SEGMENTS } from '../../storykeeperCastleRegion';
import type { ClusterPosition, ScenerySpec, ThreeLocationManifest } from '../locationManifest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import baseline from './castleOptimisationBaseline.json';
import { gameplaySnapshot } from './castleOptimisationSnapshot';
import { estimateDrawCalls } from './storykeeperCastleBudgets.test';
import { ARCHWAY_TOP, buildStorykeeperCastleManifest, STORYKEEPER_CASTLE_MANIFEST } from './storykeeperCastle';

/**
 * Final F, wall geometry audit: the castle's modular pieces are authored for a 3 m ceiling
 * (`wall-stone` 3 m, `archway` 3 m with a 2.6 m opening, the entry pillars). For every ceiling
 * height the walls reach the ceiling, nothing pokes through it, door openings keep their size,
 * and gameplay (colliders, zones, interactions, ids) does not move.
 */

const HEIGHTS = [3, 4] as const;
const WALL_IDS = new Set(WALL_SEGMENTS.map((wall) => wall.id));
const byId = (manifest: ThreeLocationManifest, id: string): ScenerySpec | undefined =>
  manifest.scenery.find((item) => item.id === id);
const boxes = (manifest: ThreeLocationManifest) =>
  manifest.scenery.flatMap((item) => (item.kind === 'BOX' ? [item] : []));

describe.each(HEIGHTS)('castle at wallHeight %s', (height) => {
  const manifest = buildStorykeeperCastleManifest(height);

  it('is a valid manifest', () => {
    expect(validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('has wall panels that reach the ceiling exactly', () => {
    const walls = byId(manifest, 'room-walls');
    expect(walls?.kind).toBe('CLUSTER');
    const positions = (walls as unknown as { positions: ClusterPosition[] }).positions;
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      // The kit panel is WALL_HEIGHT tall from the ground; its y scale lands the top on the ceiling.
      expect(WALL_HEIGHT * (position.scale?.y ?? 1)).toBeCloseTo(height, 9);
      expect(position.y ?? 0).toBe(0);
    }
  });

  it('seats the ceiling slab on the walls and puts the wall surfaces and cornices at the ceiling', () => {
    const slabs = byId(manifest, 'room-ceilings') as unknown as { positions: ClusterPosition[] };
    expect(new Set(slabs.positions.map((p) => p.y))).toEqual(new Set([height + 0.1]));
    const faces = (manifest.surfaces ?? []).flatMap((surface) => surface.faces);
    expect(Math.max(...faces.flatMap((f) => (f.kind === 'WALL' ? [f.maxY] : [])))).toBe(height);
    expect(new Set(faces.flatMap((f) => (f.kind === 'CEILING' ? [f.y] : [])))).toEqual(new Set([height]));
  });

  it('lets no decor box poke through the ceiling', () => {
    for (const item of boxes(manifest)) expect(item.maxY, item.id).toBeLessThanOrEqual(height);
  });

  it('has entry pillars that run floor to ceiling in unbroken courses', () => {
    for (const id of ['ws', 'wn', 'es', 'en']) {
      const base = byId(manifest, `castle-entry-pillar-${id}-base`) as { maxY: number; minY: number };
      const shaft = byId(manifest, `castle-entry-pillar-${id}-shaft`) as { maxY: number; minY: number };
      const cap = byId(manifest, `castle-entry-pillar-${id}-cap`) as { maxY: number; minY: number };
      expect(base.minY).toBe(0);
      expect(shaft.minY).toBe(base.maxY);
      expect(cap.minY).toBe(shaft.maxY);
      expect(cap.maxY).toBe(height);
    }
  });

  it('closes the gap above every archway without touching the opening', () => {
    const headers = boxes(manifest).filter((item) => item.id.startsWith('castle-arch-header:'));
    if (height === WALL_HEIGHT) {
      expect(headers).toEqual([]);
      return;
    }
    expect(headers).toHaveLength(ARCHWAYS.length);
    for (const archway of ARCHWAYS) {
      const header = headers.find((item) => item.id === `castle-arch-header:${archway.id}`)!;
      // Starts on top of the lintel (the opening is 2.6 m under it) and meets the ceiling.
      expect(header.minY).toBe(ARCHWAY_TOP);
      expect(header.maxY).toBe(height);
      expect(header.area).toMatchObject({
        minX: archway.gap.minX,
        maxX: archway.gap.maxX,
        minZ: archway.gap.minZ,
        maxZ: archway.gap.maxZ,
      });
    }
    // Doorway width and wall thickness unchanged, and no collider was added for a header.
    expect(manifest.colliders.some((c) => c.rect.id.includes('arch-header'))).toBe(false);
  });

  it('keeps door and archway pieces unscaled in height, so openings keep their size', () => {
    const shipped = STORYKEEPER_CASTLE_MANIFEST;
    for (const id of ['archways', 'archway-secret', 'castle-doors']) {
      expect(byId(manifest, id), id).toEqual(byId(shipped, id));
    }
  });

  it('keeps colliders identical to the baseline except the wall segments, which follow the ceiling', () => {
    const shipped = gameplaySnapshot(STORYKEEPER_CASTLE_MANIFEST).colliders as unknown[][];
    const now = gameplaySnapshot(manifest).colliders as unknown[][];
    expect(now).toHaveLength(shipped.length);
    now.forEach((row, index) => {
      const [id, ...rect] = row;
      expect(id).toBe(shipped[index][0]);
      expect(rect.slice(0, 5)).toEqual(shipped[index].slice(1, 6));
      if (WALL_IDS.has(id as string)) expect(row[6]).toBe(height);
      else expect(row[6]).toBe(shipped[index][6]);
    });
    if (height === WALL_HEIGHT) {
      expect(JSON.stringify(now)).toBe(JSON.stringify((baseline as { colliders: unknown[] }).colliders));
    }
  });

  it('keeps zones, interactions and ids; only header scenery is added', () => {
    const now = gameplaySnapshot(manifest) as Record<string, unknown[]>;
    const shipped = gameplaySnapshot(STORYKEEPER_CASTLE_MANIFEST) as Record<string, unknown[]>;
    for (const key of ['zones', 'interactions', 'checkpoints', 'props', 'npcs', 'collectibles', 'platforms']) {
      expect(now[key], key).toEqual(shipped[key]);
    }
    const extra = (now.sceneryIds as string[]).filter((id) => !(shipped.sceneryIds as string[]).includes(id));
    for (const id of extra) expect(id.startsWith('castle-arch-header:'), id).toBe(true);
    expect((shipped.sceneryIds as string[]).every((id) => (now.sceneryIds as string[]).includes(id))).toBe(true);
  });

  it('stays at or under the 300 draw-call budget', () => {
    expect(estimateDrawCalls(manifest)).toBeLessThanOrEqual(300);
  });
});
