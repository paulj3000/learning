import { describe, expect, it } from 'vitest';
import { FirstPersonController } from '../firstPersonController';
import { Box3, Vector3 } from 'three';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { NO_WORLD_STATE, solidColliders } from './sceneLayout';
import { derivedColliders, JUMPABLE_MAX_HEIGHT } from './derivedColliders';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';

const KINDS = new Map([['npc-test', 'character' as const]]);
const NONE = { assetKinds: KINDS, authored: [], keepClear: [] };

function bare(scenery: ThreeLocationManifest['scenery'], extra: Partial<ThreeLocationManifest> = {}) {
  return { ...WELCOME_HARBOR_MANIFEST, scenery, props: [], npcs: [], colliders: [], ...extra };
}

describe('derivedColliders (collision fix: drawn pieces block)', () => {
  it('gives a barrel cluster a jumpable box per barrel, at its drawn size', () => {
    const boxes = derivedColliders(
      bare([{ kind: 'CLUSTER', id: 'barrels', assetId: 'barrel', positions: [{ x: 5, z: 2 }, { x: -3, z: 1 }] }]),
      NO_WORLD_STATE,
      NONE,
    );
    expect(boxes.map((b) => b.id)).toEqual(['derived:barrels#0', 'derived:barrels#1']);
    expect(boxes[0]).toMatchObject({ jumpable: true });
    expect(boxes[0]!.box.minX).toBeCloseTo(4.68);
    expect(boxes[0]!.box.maxX).toBeCloseTo(5.32);
    expect(boxes[0]!.box.maxY).toBeCloseTo(0.9);
  });

  it('scales and rotates the footprint like the renderer (a scaled log turned a quarter)', () => {
    const parts = derivedColliders(
      bare([
        {
          kind: 'CLUSTER',
          id: 'logs',
          assetId: 'log-fallen',
          positions: [{ x: 0, z: 0, rotationY: Math.PI / 2, scale: { x: 2, y: 2, z: 2 } }],
        },
      ]),
      NO_WORLD_STATE,
      NONE,
    );
    // Cut along its length; local +Z (the log's length) turns onto +X.
    expect(parts.map((p) => p.id)).toEqual(['derived:logs#0:0', 'derived:logs#0:1', 'derived:logs#0:2']);
    expect(Math.min(...parts.map((p) => p.box.minX))).toBeCloseTo(0);
    expect(Math.max(...parts.map((p) => p.box.maxX))).toBeCloseTo(4.4);
    expect(parts[0]!.box.maxZ - parts[0]!.box.minZ).toBeCloseTo(0.92);
    expect(parts[0]!.box.maxY).toBeCloseTo(0.9);
  });

  it('keeps the empty air beside a diagonal log walkable', () => {
    const parts = derivedColliders(
      bare([
        { kind: 'CLUSTER', id: 'logs', assetId: 'log-fallen', positions: [{ x: 0, z: 0, rotationY: Math.PI / 4 }] },
      ]),
      NO_WORLD_STATE,
      NONE,
    );
    const blocked = (x: number, z: number) =>
      parts.some((p) => x >= p.box.minX && x <= p.box.maxX && z >= p.box.minZ && z <= p.box.maxZ);
    // Along the log (local +Z turned 45 degrees) is blocked; the corner of its bounding square is not.
    expect(blocked(0.78, 0.78)).toBe(true);
    expect(blocked(1.4, 0.2)).toBe(false);
    expect(blocked(0.2, 1.4)).toBe(false);
  });

  it('makes tall pieces solid from below the ground, and low ones jumpable', () => {
    const [tree, rock] = derivedColliders(
      bare([
        { kind: 'MODEL', id: 'tree', assetId: 'foliage-tree', position: { x: 0, y: 0, z: 0 } },
        { kind: 'MODEL', id: 'rock', assetId: 'rock', position: { x: 4, y: 0, z: 0 } },
      ]),
      NO_WORLD_STATE,
      NONE,
    );
    expect(tree!.jumpable).toBeUndefined();
    expect(tree!.box.minY).toBeLessThan(0);
    expect(rock!.jumpable).toBe(true);
    expect(rock!.box.maxY).toBeLessThanOrEqual(JUMPABLE_MAX_HEIGHT);
  });

  it('gives props and characters (by asset kind) a body, and ignores walkable pieces', () => {
    const boxes = derivedColliders(
      bare(
        [
          { kind: 'CLUSTER', id: 'paths', assetId: 'path', positions: [{ x: 0, z: 0 }] },
          { kind: 'CLUSTER', id: 'ferns', assetId: 'fern', positions: [{ x: 1, z: 0 }] },
        ],
        {
          props: [
            { entityId: 'chest', assetId: 'treasure-chest', position: { x: 3, z: 3 }, label: 'Chest' },
            { entityId: 'machine', position: { x: 6, z: 6 }, label: 'Extension-drawn' },
          ],
          npcs: [
            {
              entityId: 'npc',
              npcId: 'x',
              assetId: 'npc-test',
              position: { x: -4, z: 4 },
              label: 'Someone',
              placeholderColor: 0,
            },
          ],
        } as Partial<ThreeLocationManifest>,
      ),
      NO_WORLD_STATE,
      NONE,
    );
    expect(boxes.map((b) => b.id)).toEqual(['derived:chest', 'derived:npc']);
  });

  it('leaves a piece an authored collider covers to that collider', () => {
    const manifest = bare([
      { kind: 'CLUSTER', id: 'barrels', assetId: 'barrel', positions: [{ x: 5, z: 2 }] },
    ]);
    const authored = [{ minX: 4.5, maxX: 5.5, minZ: 1.5, maxZ: 2.5, minY: 0, maxY: 1 }];
    expect(derivedColliders(manifest, NO_WORLD_STATE, { ...NONE, authored })).toEqual([]);
  });

  it('never walls in a checkpoint', () => {
    const manifest = bare([
      { kind: 'MODEL', id: 'chest', assetId: 'crate', position: { x: 2, y: 0, z: 2 } },
    ]);
    expect(derivedColliders(manifest, NO_WORLD_STATE, { ...NONE, keepClear: [{ x: 2, z: 2 }] })).toEqual([]);
  });

  it('follows scenery requirements, like the scenery itself', () => {
    const manifest = bare([
      {
        kind: 'MODEL',
        id: 'gate-rock',
        assetId: 'crate',
        position: { x: 2, y: 0, z: 2 },
        requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'CLEARED' }],
      },
    ]);
    expect(derivedColliders(manifest, NO_WORLD_STATE, NONE)).toHaveLength(1);
    expect(derivedColliders(manifest, { ...NO_WORLD_STATE, worldChangeKeys: ['CLEARED'] }, NONE)).toHaveLength(0);
  });

  it('stops the child at a barrel they used to walk through, and lets them hop onto it', () => {
    const manifest = bare([
      { kind: 'CLUSTER', id: 'barrels', assetId: 'barrel', positions: [{ x: 0, z: 3 }] },
    ]);
    const solids = solidColliders(manifest);
    const colliders = solids.map(
      ({ box }) => new Box3(new Vector3(box.minX, box.minY, box.minZ), new Vector3(box.maxX, box.maxY, box.maxZ)),
    );
    const jumpable = new Set(colliders.filter((_, i) => solids[i]!.jumpable));
    const controller = new FirstPersonController({ colliders, jumpableColliders: jumpable, acceleration: 1000 });
    for (let i = 0; i < 60; i++) controller.update(1 / 30, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeLessThan(3 - 0.33);
  });
});

describe('every source location after the collision fix', () => {
  for (const manifest of SOURCE_LOCATION_MANIFESTS) {
    it(`${manifest.regionId}: no checkpoint is inside any collider`, () => {
      const boxes = solidColliders(manifest).filter((c) => c.id?.startsWith('derived:'));
      for (const checkpoint of ALL_CHECKPOINTS.filter((c) => c.regionId === manifest.regionId)) {
        for (const { box } of boxes) {
          const inside =
            checkpoint.x >= box.minX && checkpoint.x <= box.maxX && checkpoint.z >= box.minZ && checkpoint.z <= box.maxZ;
          expect(inside, `${checkpoint.id} inside a derived box`).toBe(false);
        }
      }
    });
  }
});
