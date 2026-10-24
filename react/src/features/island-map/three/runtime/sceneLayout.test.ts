import { describe, expect, it } from 'vitest';
import {
  boundaryWallRects,
  boxContains,
  buildingDoorPlacement,
  buildingDoorSide,
  buildingWallColliders,
  buildingWallPlacements,
  solidColliders,
  tiledGroundPlacements,
  triggerVolumes,
} from './sceneLayout';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { BOUNDARY_WALLS } from '../welcomeHarborRegion';
import { WELCOME_HARBOR_CHECKPOINTS } from '../../../discovery/checkpoints';
import type { BuildingSpec } from './locationManifest';

const LOOKOUT = WELCOME_HARBOR_MANIFEST.buildings[0] as BuildingSpec;

describe('boundaryWallRects', () => {
  it('reproduces the boundary walls Welcome Harbor wrote out by hand', () => {
    expect(boundaryWallRects(WELCOME_HARBOR_MANIFEST.bounds)).toEqual(BOUNDARY_WALLS);
  });
});

describe('buildings', () => {
  it('gives each walled side a collider and leaves the doorway open', () => {
    expect(buildingWallColliders(LOOKOUT)).toHaveLength(3);
    expect(buildingDoorSide(LOOKOUT)).toBe('south');
    const doorway = { x: LOOKOUT.x, y: 1, z: LOOKOUT.z + LOOKOUT.halfDepth };
    expect(buildingWallColliders(LOOKOUT).some((box) => boxContains(box, doorway))).toBe(false);
    const northWall = { x: LOOKOUT.x, y: 1, z: LOOKOUT.z - LOOKOUT.halfDepth };
    expect(buildingWallColliders(LOOKOUT).some((box) => boxContains(box, northWall))).toBe(true);
  });

  it('centres the door in the doorway and has none for a fully walled building', () => {
    expect(buildingDoorPlacement(LOOKOUT)?.position).toEqual({ x: -7, y: 0, z: -4 });
    const sealed = { ...LOOKOUT, wallSides: ['north', 'south', 'east', 'west'] as const };
    expect(buildingDoorPlacement(sealed)).toBeUndefined();
  });

  it('stretches wall panels to the building height', () => {
    const panels = buildingWallPlacements(LOOKOUT);
    expect(panels).toHaveLength(6);
    expect(panels.every((panel) => panel.scale?.y === LOOKOUT.height / 3)).toBe(true);
  });
});

describe('tiledGroundPlacements', () => {
  it('covers the area with whole tiles, as the harbour ground did', () => {
    const tiles = tiledGroundPlacements({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, 4);
    expect(tiles).toHaveLength(36);
    expect(tiles[0]).toEqual({ x: -10, z: -10 });
    expect(tiles[35]).toEqual({ x: 10, z: 10 });
  });

  it('drops a partial row rather than stretching a tile', () => {
    const tiles = tiledGroundPlacements({ minX: 0, maxX: 5, minZ: 0, maxZ: 4 }, 2);
    expect(tiles).toHaveLength(4);
    expect(Math.max(...tiles.map((tile) => tile.x + 1))).toBe(4);
  });
});

describe('solidColliders', () => {
  it('combines boundary walls, authored colliders and building walls', () => {
    const manifest = {
      ...WELCOME_HARBOR_MANIFEST,
      colliders: [{ rect: { id: 'rock', minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, maxY: 0.5 }],
    };
    const boxes = solidColliders(manifest);
    expect(boxes).toHaveLength(4 + 1 + 6);
    expect(boxes[4]).toEqual({
      id: 'rock',
      box: { minX: 0, minY: -1, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 },
    });
  });

  it('includes a gated collider only while its requirements hold', () => {
    const manifest = {
      ...WELCOME_HARBOR_MANIFEST,
      colliders: [
        {
          rect: { id: 'broken-bridge', minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
          requirements: [{ type: 'WORLD_CHANGE_ABSENT' as const, changeKey: 'BRIDGE_REPAIRED' }],
        },
      ],
    };
    const ids = (keys: string[]) =>
      solidColliders(manifest, { worldChangeKeys: keys }).flatMap((collider) =>
        collider.id ? [collider.id] : [],
      );
    expect(ids([])).toEqual(['broken-bridge']);
    expect(ids(['BRIDGE_REPAIRED'])).toEqual([]);
  });
});

describe('triggerVolumes', () => {
  it('builds checkpoint, interior and zone triggers in that order', () => {
    const manifest = {
      ...WELCOME_HARBOR_MANIFEST,
      zones: [{ rect: { id: 'pier', minX: -1, maxX: 1, minZ: 9, maxZ: 11 } }],
    };
    const volumes = triggerVolumes(manifest, WELCOME_HARBOR_CHECKPOINTS);
    expect(volumes.map((volume) => [volume.kind, volume.id])).toEqual([
      ['CHECKPOINT', 'welcome-harbor:dock'],
      ['CHECKPOINT', 'welcome-harbor:lookout'],
      ['CHECKPOINT', 'welcome-harbor:shed'],
      ['INTERIOR', 'lookout-tower:interior'],
      ['INTERIOR', 'dockside-shed:interior'],
      ['ZONE', 'pier'],
    ]);
    expect(volumes[0]?.box).toEqual({
      minX: -1.5,
      minY: -1,
      minZ: 6.5,
      maxX: 1.5,
      maxY: 3,
      maxZ: 9.5,
    });
  });

  it('skips a listed checkpoint whose position is not authored', () => {
    expect(triggerVolumes(WELCOME_HARBOR_MANIFEST, []).map((volume) => volume.kind)).toEqual([
      'INTERIOR',
      'INTERIOR',
    ]);
  });
});
