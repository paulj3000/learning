import { describe, expect, it } from 'vitest';
import { WALL_HEIGHT } from '../../sceneKit';
import type { ThreeLocationManifest } from '../locationManifest';
import { solidColliders, triggerVolumes } from '../sceneLayout';
import { WALL_SEGMENTS } from '../../storykeeperCastleRegion';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { buildStorykeeperCastleManifest, STORYKEEPER_CASTLE_MANIFEST } from './storykeeperCastle';

/**
 * SC-R11 section 3: the castle's ceiling height is a manifest value (`wallHeight`), default 3.
 * No room is built at 4 m yet (that waits for the kit-piece scaling decision); these tests
 * prove the value is honoured everywhere the contract lists, and that the default is unchanged.
 */

const TALL = 4;
const WALL_IDS = new Set(WALL_SEGMENTS.map((wall) => wall.id));

function ceilingHeights(manifest: ThreeLocationManifest) {
  const surfaces = manifest.surfaces ?? [];
  const faces = surfaces.flatMap((surface) => surface.faces);
  return {
    ceilings: faces.flatMap((face) => (face.kind === 'CEILING' ? [face.y] : [])),
    wallTops: faces.flatMap((face) => (face.kind === 'WALL' ? [face.maxY] : [])),
    corniceTops: surfaces
      .filter((surface) => surface.id.endsWith(':trim') || surface.materialId === 'trim-dark-wood')
      .flatMap((surface) =>
        surface.faces.flatMap((face) => (face.kind === 'WALL' ? [face.maxY] : [])),
      ),
    lamps: (manifest.lights ?? []).filter(
      (light) => light.id.startsWith('light:') && light.position.y > 2.2,
    ),
    beams: manifest.scenery.flatMap((item) =>
      item.kind === 'BOX' && item.id.includes('beam') ? [item.maxY] : [],
    ),
    wallColliders: manifest.colliders
      .filter((collider) => WALL_IDS.has(collider.rect.id))
      .map((collider) => collider.maxY ?? 0),
    allColliders: manifest.colliders.map((collider) => collider.maxY ?? 0),
    slabs: manifest.scenery.flatMap((item) =>
      item.kind === 'CLUSTER' && item.id === 'room-ceilings'
        ? item.positions.map((p) => p.y ?? 0)
        : [],
    ),
  };
}

describe('castle wallHeight (SC-R11)', () => {
  it('leaves the shipped manifest unchanged at the default', () => {
    expect(buildStorykeeperCastleManifest()).toBe(STORYKEEPER_CASTLE_MANIFEST);
    expect(buildStorykeeperCastleManifest(WALL_HEIGHT)).toBe(STORYKEEPER_CASTLE_MANIFEST);
    expect(STORYKEEPER_CASTLE_MANIFEST.wallHeight).toBeUndefined();
    const h = ceilingHeights(STORYKEEPER_CASTLE_MANIFEST);
    expect(new Set(h.ceilings)).toEqual(new Set([3]));
    expect(Math.max(...h.wallColliders)).toBe(3);
    expect(new Set(h.wallColliders)).toEqual(new Set([3]));
    expect(new Set(h.slabs)).toEqual(new Set([3.1]));
    expect(h.beams).toEqual([3]);
    for (const lamp of h.lamps) expect(lamp.position.y).toBeCloseTo(2.6);
    expect(h.lamps.length).toBeGreaterThan(0);
  });

  it('keeps the default solid boxes and trigger volumes as they were', () => {
    const solids = solidColliders(STORYKEEPER_CASTLE_MANIFEST);
    expect(solids.length).toBeGreaterThan(0);
    expect(Math.max(...solids.map((solid) => solid.box.maxY))).toBeLessThanOrEqual(3);
    for (const volume of triggerVolumes(STORYKEEPER_CASTLE_MANIFEST, []).filter(
      (v) => v.kind === 'ZONE',
    )) {
      expect(volume.box.maxY).toBe(3);
    }
  });

  it('builds a valid manifest at 4 m', () => {
    const tall = buildStorykeeperCastleManifest(TALL);
    expect(tall.wallHeight).toBe(TALL);
    expect(validateLocationManifest(tall, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('puts every ceiling, wall top, cornice, lamp, beam and collider at or below 4 m, with the walls reaching it', () => {
    const tall = buildStorykeeperCastleManifest(TALL);
    const h = ceilingHeights(tall);
    expect(h.ceilings.length).toBeGreaterThan(0);
    expect(new Set(h.ceilings)).toEqual(new Set([TALL]));
    expect(Math.max(...h.wallTops)).toBe(TALL);
    for (const top of h.wallTops) expect(top).toBeLessThanOrEqual(TALL);
    expect(h.corniceTops.length).toBeGreaterThan(0);
    for (const top of h.corniceTops) expect(top).toBeLessThanOrEqual(TALL);
    for (const lamp of h.lamps) expect(lamp.position.y).toBeLessThanOrEqual(TALL);
    expect(h.beams).toEqual([TALL]);
    expect(h.wallColliders).toHaveLength(WALL_SEGMENTS.length);
    for (const top of h.allColliders) expect(top).toBeLessThanOrEqual(TALL);
    // Wall segments are the colliders that reach the ceiling; none is left at the old 3 m.
    expect(h.wallColliders.filter((top) => top === WALL_HEIGHT)).toEqual([]);
    expect(h.wallColliders).toContain(TALL);
    // The slab rests on top of the walls.
    expect(new Set(h.slabs)).toEqual(new Set([TALL + 0.1]));
    for (const lamp of h.lamps) expect(lamp.position.y).toBeCloseTo(TALL - 0.4);
  });

  it('follows the value in the generic layout: boundary walls and zones', () => {
    const tall = buildStorykeeperCastleManifest(TALL);
    const zoneTops = triggerVolumes(tall, [])
      .filter((volume) => volume.kind === 'ZONE')
      .map((volume) => volume.box.maxY);
    expect(zoneTops.length).toBeGreaterThan(0);
    expect(new Set(zoneTops)).toEqual(new Set([TALL]));
    const solidTops = solidColliders(tall).map((solid) => solid.box.maxY);
    expect(Math.max(...solidTops)).toBe(TALL);
  });

  it('rejects a non-positive wallHeight', () => {
    const bad = { ...STORYKEEPER_CASTLE_MANIFEST, wallHeight: 0 };
    expect(validateLocationManifest(bad, SOURCE_MANIFEST_REGISTRIES).length).toBeGreaterThan(0);
  });
});
