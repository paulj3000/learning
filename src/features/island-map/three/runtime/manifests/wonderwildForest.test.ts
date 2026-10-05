import { describe, expect, it } from 'vitest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { scatterPlacements, tiledGroundPlacements, walkableProbe } from '../sceneLayout';
import {
  drawnTrailRects,
  scatterPlacements as scenePlacements,
  tilePlacements,
} from '../../wonderwildForestScene';
import {
  COLLIDERS as REGION_COLLIDERS,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  isWalkable,
  ZONES,
} from '../../wonderwildForestRegion';
import { WONDERWILD_FOREST_MANIFEST as MANIFEST } from './wonderwildForest';
import type { ThreeLocationManifest } from '../locationManifest';

const REGION_AREA = {
  id: 'region',
  minX: -GROUND_HALF_EXTENT_X,
  maxX: GROUND_HALF_EXTENT_X,
  minZ: -GROUND_HALF_EXTENT_Z,
  maxZ: GROUND_HALF_EXTENT_Z,
};

/** Tile order is irrelevant to an instanced draw call, so compare the sets. */
function sortedPoints(points: readonly { x: number; z: number }[]) {
  return [...points].sort((a, b) => a.x - b.x || a.z - b.z);
}

function sceneryOfKind<Kind extends ThreeLocationManifest['scenery'][number]['kind']>(kind: Kind) {
  return MANIFEST.scenery.filter(
    (item): item is Extract<ThreeLocationManifest['scenery'][number], { kind: Kind }> =>
      item.kind === kind,
  );
}

describe('Wonderwild Forest manifest', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('keeps the region’s colliders, heights and all', () => {
    // The tree line to head height, the pond knee-deep, exactly as the
    // per-region scene built them.
    expect(MANIFEST.colliders).toHaveLength(REGION_COLLIDERS.length);
    const pond = MANIFEST.colliders.find((collider) => collider.rect.id === 'pond-water');
    expect(pond).toMatchObject({ minY: -1, maxY: 2 });
    for (const collider of MANIFEST.colliders) {
      if (collider.rect.id === 'pond-water') continue;
      expect(collider).toMatchObject({ minY: -1, maxY: 6 });
    }
  });

  it('declares no boundary walls of its own, because the tree line closes the forest', () => {
    // The derived complement runs to the ground extents (WF-0), which is why
    // this region needs none where the bay needs four.
    expect(MANIFEST.buildings).toEqual([]);
    expect(MANIFEST.colliders.map((collider) => collider.rect.id)).not.toContain('boundary-north');
  });

  it('renames only the four zones it has to, and keeps the rest', () => {
    const ids = MANIFEST.zones.map((zone) => zone.rect.id);
    expect(ids).toHaveLength(ZONES.length);
    expect(ids).toContain('wonderwild-beehive');
    expect(ids).not.toContain('wonderwild-hive-clearing');
    expect(ids).toContain('wonderwild-leaf-pile:approach');
    expect(ids).toContain('wonderwild-night-clearing:approach');
    expect(ids).toContain('wonderwild-cave:approach');
    // Everything else is the authored id, including the four stone zones.
    expect(ids).toContain('wonderwild-wonder-wall');
    expect(ids).toContain('wonder-stone-bee');
    expect(ids).toContain('wonderwild-glow-moss');
    expect(ids).toContain('wonderwild-harbor-exit');
  });

  it('places the forest floor exactly where the per-region scene tiled it', () => {
    const floor = sceneryOfKind('TILED_GROUND').find((item) => item.id === 'forest-floor');
    expect(floor).toBeDefined();
    const generic = tiledGroundPlacements(floor!.area, floor!.tileSize, floor!.coverage);
    const perRegion = tilePlacements(REGION_AREA, 4).map((placement) => ({
      x: placement.position.x,
      z: placement.position.z,
    }));
    expect(sortedPoints(generic)).toEqual(sortedPoints(perRegion));
    // And `COVER` is why: the default would drop the far row and show a bare strip.
    expect(tiledGroundPlacements(floor!.area, floor!.tileSize).length).toBeLessThan(generic.length);
  });

  it('draws every trail the per-region scene drew, and not the fern bank’s non-path', () => {
    const trails = sceneryOfKind('TILED_GROUND').filter((item) => item.id !== 'forest-floor');
    const drawn = drawnTrailRects();
    expect(trails.map((item) => item.area.id).sort()).toEqual(drawn.map((rect) => rect.id).sort());
    expect(trails.map((item) => item.area.id)).not.toContain('trail:hub-to-fern-bank:0');
    for (const trail of trails) {
      const rect = drawn.find((candidate) => candidate.id === trail.area.id)!;
      expect(
        sortedPoints(tiledGroundPlacements(trail.area, trail.tileSize, trail.coverage)),
      ).toEqual(
        sortedPoints(
          tilePlacements(rect, 1.5).map((placement) => ({
            x: placement.position.x,
            z: placement.position.z,
          })),
        ),
      );
    }
  });

  it('scatters trees, bushes and ferns into exactly the places the per-region scene did', () => {
    /*
      The equivalence the `SCATTER` vocabulary rests on: the generic
      walkability probe (inside the bounds, outside every authored collider)
      agrees with the forest's own `isWalkable` (on open ground, not in the
      trees or the water), because the tree line *is* the complement of the
      open ground. Same seeds, same spacing, same placements.
    */
    const probe = walkableProbe(MANIFEST);
    const expected = {
      'tree-line': scenePlacements(REGION_AREA, 1.5, 1337, isWalkable, 0.9),
      'undergrowth-bushes': scenePlacements(REGION_AREA, 3, 90210, isWalkable, 0.6),
      'undergrowth-ferns': scenePlacements(REGION_AREA, 2.4, 5150, isWalkable, 0.4),
    };
    for (const item of sceneryOfKind('SCATTER')) {
      const placements = scatterPlacements(
        item.area,
        item.spacing,
        item.seed,
        probe,
        item.clearance,
      );
      expect(placements).toEqual(expected[item.id as keyof typeof expected]);
      expect(placements.length).toBeGreaterThan(20);
    }
  });

  it('agrees with the region’s own walkability everywhere it matters', () => {
    const probe = walkableProbe(MANIFEST);
    for (let x = -GROUND_HALF_EXTENT_X; x <= GROUND_HALF_EXTENT_X; x += 0.5) {
      for (let z = -GROUND_HALF_EXTENT_Z; z <= GROUND_HALF_EXTENT_Z; z += 0.5) {
        expect(probe(x, z), `(${x}, ${z})`).toBe(isWalkable(x, z));
      }
    }
  });

  it('keeps the four carved stones scenery, with the bee stone’s lit variant', () => {
    const stones = sceneryOfKind('MODEL').filter((item) => item.id.startsWith('stone:'));
    expect(stones.map((item) => item.assetId)).toEqual([
      'wonder-stone-bee',
      'wonder-stone-bee-lit',
      'wonder-stone-seed',
      'wonder-stone-sun',
      'wonder-stone-chrysalis',
    ]);
    expect(stones[0]!.requirements).toEqual([
      { type: 'WORLD_CHANGE_ABSENT', changeKey: 'WAGGLE_DANCE_DISCOVERED' },
    ]);
    expect(stones[1]!.requirements).toEqual([
      { type: 'WORLD_CHANGE_PRESENT', changeKey: 'WAGGLE_DANCE_DISCOVERED' },
    ]);
    // WF-3 owns the `wonder-wall` step, so nothing here answers it yet.
    expect(MANIFEST.adventureBindings).toEqual([]);
  });

  it('shows one cave mouth at a time, lit only for a child carrying the jar', () => {
    const caves = MANIFEST.props.filter((prop) => prop.interactionId === 'wonderwild-cave');
    expect(caves.map((prop) => prop.assetId)).toEqual(['cave-mouth', 'cave-mouth-lit']);
    expect(caves[0]!.requirements).toEqual([{ type: 'ITEM_ABSENT', itemId: 'glowing-moss-jar' }]);
    expect(caves[1]!.requirements).toEqual([{ type: 'ITEM_OWNED', itemId: 'glowing-moss-jar' }]);
    // Both carry the same label and interaction, so the child sees one cave.
    expect(new Set(caves.map((prop) => prop.label)).size).toBe(1);
  });

  it('shows the butterfly only once the garden is saved elsewhere on the island', () => {
    const butterfly = MANIFEST.props.find((prop) => prop.entityId === 'wonderwild-butterfly');
    expect(butterfly?.requirements).toEqual([
      { type: 'WORLD_CHANGE_PRESENT', changeKey: 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE' },
    ]);
  });

  it('labels every prop with its own interaction’s authored title', () => {
    // The old view read the reticle label off the interaction; the generic
    // one reads it off the manifest, so the two must say the same thing.
    for (const prop of MANIFEST.props) {
      const interaction = MANIFEST.interactions.find(
        (candidate) => candidate.id === prop.interactionId,
      );
      expect(interaction, prop.entityId).toBeDefined();
      expect(prop.label).toBe(interaction!.title);
    }
  });
});
