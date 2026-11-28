import { describe, expect, it } from 'vitest';
import { ALL_CHECKPOINTS } from '../../../../discovery/checkpoints';
import { getIslandLocation } from '../../../../island/locations';
import { FOSSIL_RIDGE_CAMP_DECOR } from '../../../fossilRidgeCampDecor';
import { FOSSIL_RIDGE_CAMP_INTERACTIONS } from '../../../worldObjects';
import {
  CAMP_SPAWN,
  DIG_TOOLS,
  GROUND_HALF_EXTENT_X,
  GROUND_HALF_EXTENT_Z,
  HARBOR_EXIT_ZONE,
  SKELETON_PLACARD,
  solidFootprints,
  type Rect,
} from '../../fossilRidgeCampRegion';
import { RAYCAST_RANGE_METERS } from '../../sceneKit';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import type { ThreeLocationManifest } from '../locationManifest';
import { SOURCE_LOCATION_MANIFESTS } from './index';
import {
  DINOSAUR_EXPEDITION_COMPLETE,
  FOSSIL_RIDGE_CAMP_MANIFEST as MANIFEST,
} from './fossilRidgeCamp';

/** The controller footprint (jumping standard: 0.35 m radius plus 0.02 m skin). */
const BODY_RADIUS = 0.37;
const GRID_STEP = 0.25;
/** The toolbox's collider is derived from its kit piece; a generous stand-in for the walk test. */
const TOOLBOX_HALF = 0.6;

const inside = (rect: Omit<Rect, 'id'>, x: number, z: number, pad = 0) =>
  x >= rect.minX - pad && x <= rect.maxX + pad && z >= rect.minZ - pad && z <= rect.maxZ + pad;

const SOLIDS: Omit<Rect, 'id'>[] = [
  ...solidFootprints(),
  {
    minX: DIG_TOOLS.x - TOOLBOX_HALF,
    maxX: DIG_TOOLS.x + TOOLBOX_HALF,
    minZ: DIG_TOOLS.z - TOOLBOX_HALF,
    maxZ: DIG_TOOLS.z + TOOLBOX_HALF,
  },
];

function isWalkable(x: number, z: number): boolean {
  if (Math.abs(x) > GROUND_HALF_EXTENT_X - BODY_RADIUS) return false;
  if (Math.abs(z) > GROUND_HALF_EXTENT_Z - BODY_RADIUS) return false;
  return !SOLIDS.some((rect) => inside(rect, x, z, BODY_RADIUS));
}

/** Flood fill on walking links only: there is no jump in this camp. */
function reachableFrom(start: { x: number; z: number }): Set<string> {
  const key = (i: number, j: number) => `${i}:${j}`;
  const seen = new Set<string>();
  const queue: [number, number][] = [
    [Math.round(start.x / GRID_STEP), Math.round(start.z / GRID_STEP)],
  ];
  while (queue.length > 0) {
    const [i, j] = queue.pop()!;
    if (seen.has(key(i, j)) || !isWalkable(i * GRID_STEP, j * GRID_STEP)) continue;
    seen.add(key(i, j));
    queue.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return seen;
}

const REACHED = reachableFrom(CAMP_SPAWN);
const reachedCells = [...REACHED].map((cell) => {
  const [i, j] = cell.split(':').map(Number);
  return { x: i! * GRID_STEP, z: j! * GRID_STEP };
});

/** A spot the child can walk to and stand at within interaction reach of `target`. */
function canReachWithin(target: { x: number; z: number }, range: number): boolean {
  return reachedCells.some((cell) => Math.hypot(cell.x - target.x, cell.z - target.z) <= range);
}

describe('Fossil Ridge Camp manifest (LAI-2206)', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('is registered once, under the same id and slug as the Phaser location', () => {
    expect(
      SOURCE_LOCATION_MANIFESTS.filter((m) => m.regionId === 'fossil-ridge-camp'),
    ).toHaveLength(1);
    expect(MANIFEST.locationSlug).toBe('fossil-ridge-camp');
    expect(getIslandLocation('fossil-ridge-camp')?.slug).toBe(MANIFEST.locationSlug);
  });

  it('reuses the Phaser camp interactions by identity: the same three ids and lines', () => {
    expect(MANIFEST.interactions).toBe(FOSSIL_RIDGE_CAMP_INTERACTIONS);
    expect(MANIFEST.interactions.map((interaction) => interaction.id)).toEqual([
      'meet-the-fossil',
      'fossil-ridge-dig-tools',
      'fossil-ridge-camp-harbor-exit',
    ]);
  });

  it('places each Phaser decor piece as a prop with the same entity and interaction', () => {
    for (const decor of FOSSIL_RIDGE_CAMP_DECOR) {
      const prop = MANIFEST.props.find((candidate) => candidate.entityId === decor.id);
      expect(prop?.interactionId).toBe(decor.interactionId);
    }
    expect(MANIFEST.props).toHaveLength(FOSSIL_RIDGE_CAMP_DECOR.length);
  });

  it('opens the exit by walking into the west strip, still to the map until the 3D hub', () => {
    expect(MANIFEST.zones.map((zone) => zone.rect.id)).toEqual(['fossil-ridge-camp-harbor-exit']);
    const exit = FOSSIL_RIDGE_CAMP_INTERACTIONS.find(
      (interaction) => interaction.id === HARBOR_EXIT_ZONE.id,
    );
    expect(exit?.trigger).toBe('APPROACH');
    // LAI-2201 (the 3D hub) is what retargets this; until then it is the Phaser exit's.
    expect(exit?.action).toEqual({ kind: 'NAVIGATE', to: 'world' });
  });

  describe('the unlock guard', () => {
    it('needs the dinosaur mystery finished, the same key as the location and the Phaser view', () => {
      expect(MANIFEST.entryRequirements).toEqual([
        { type: 'WORLD_CHANGE_PRESENT', changeKey: DINOSAUR_EXPEDITION_COMPLETE },
      ]);
      expect(getIslandLocation('fossil-ridge-camp')?.unlockRequirement).toEqual({
        changeKey: DINOSAUR_EXPEDITION_COMPLETE,
      });
    });

    it('says the calm Phaser line when closed, never a refusal', () => {
      expect(MANIFEST.copy.locked).toBe(
        'This part of the island has not been discovered yet. Maybe a new story will lead you here.',
      );
    });
  });

  describe('flat, solid and jump free (Sprouts route on LAI-2104S B1)', () => {
    it('has no platforming, no per-band platforming and no movement override', () => {
      expect(MANIFEST.platforming).toBeUndefined();
      expect(MANIFEST.platformingByBand).toBeUndefined();
      expect(MANIFEST.movement).toBeUndefined();
    });

    it('makes every collider solid from the floor up, and none jumpable', () => {
      expect(MANIFEST.colliders.length).toBeGreaterThan(0);
      for (const collider of MANIFEST.colliders) {
        expect(collider.jumpable).toBeUndefined();
        expect(collider.minY).toBe(0);
        expect(collider.maxY).toBeGreaterThanOrEqual(2.5);
      }
    });

    it('spawns the child on open floor at a real checkpoint', () => {
      expect(ALL_CHECKPOINTS.filter((c) => c.id === 'fossil-ridge-camp:trailhead')).toHaveLength(1);
      expect(MANIFEST.checkpoints.ids).toEqual(['fossil-ridge-camp:trailhead']);
      expect(isWalkable(CAMP_SPAWN.x, CAMP_SPAWN.z)).toBe(true);
      expect(inside(HARBOR_EXIT_ZONE, CAMP_SPAWN.x, CAMP_SPAWN.z, 1)).toBe(false);
    });

    it('reaches the skeleton, the dig tools and the exit on foot from the trailhead', () => {
      expect(canReachWithin(SKELETON_PLACARD, RAYCAST_RANGE_METERS)).toBe(true);
      expect(canReachWithin(DIG_TOOLS, RAYCAST_RANGE_METERS)).toBe(true);
      expect(reachedCells.some((cell) => inside(HARBOR_EXIT_ZONE, cell.x, cell.z))).toBe(true);
    });

    it('keeps the walkable camp in one piece: the trailhead reaches most of the floor', () => {
      const floorCells = (2 * GROUND_HALF_EXTENT_X * 2 * GROUND_HALF_EXTENT_Z) / GRID_STEP ** 2;
      expect(REACHED.size / floorCells).toBeGreaterThan(0.6);
    });
  });

  it('offers the location page as the way out of 3D', () => {
    expect(MANIFEST.copy.altNav).toEqual({
      label: 'Prefer not to walk? Use the location page instead',
      to: 'locations/fossil-ridge-camp',
    });
  });

  it('uses no em dashes in child-facing copy', () => {
    expect(JSON.stringify(MANIFEST.copy)).not.toContain('—');
  });
});
