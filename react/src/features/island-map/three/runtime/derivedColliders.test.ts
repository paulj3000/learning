import { describe, expect, it } from 'vitest';
import { FirstPersonController } from '@lai/game-engine/movement';
import { Box3, Vector3 } from 'three';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { NO_WORLD_STATE, solidColliders } from './sceneLayout';
import {
  buildingEntrances,
  derivedColliders,
  JUMPABLE_MAX_HEIGHT,
  type DerivedCollider,
} from './derivedColliders';
import { parseCollisionProfile, type CollisionProfile, type ModelBox } from './collisionProfile';
import { ALL_CHECKPOINTS } from '../../../discovery/checkpoints';

const KINDS = new Map([['npc-test', 'character' as const]]);
const NONE = { assetKinds: KINDS, authored: [], keepClear: [] };

function bare(
  scenery: ThreeLocationManifest['scenery'],
  extra: Partial<ThreeLocationManifest> = {},
) {
  return { ...WELCOME_HARBOR_MANIFEST, scenery, props: [], npcs: [], colliders: [], ...extra };
}

describe('derivedColliders (collision fix: drawn pieces block)', () => {
  it('gives a barrel cluster a jumpable box per barrel, at its drawn size', () => {
    const boxes = derivedColliders(
      bare([
        {
          kind: 'CLUSTER',
          id: 'barrels',
          assetId: 'barrel',
          positions: [
            { x: 5, z: 2 },
            { x: -3, z: 1 },
          ],
        },
      ]),
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
    expect(parts.map((p) => p.id)).toEqual([
      'derived:logs#0:0',
      'derived:logs#0:1',
      'derived:logs#0:2',
    ]);
    expect(Math.min(...parts.map((p) => p.box.minX))).toBeCloseTo(0);
    expect(Math.max(...parts.map((p) => p.box.maxX))).toBeCloseTo(4.4);
    expect(parts[0]!.box.maxZ - parts[0]!.box.minZ).toBeCloseTo(0.92);
    expect(parts[0]!.box.maxY).toBeCloseTo(0.9);
  });

  it('keeps the empty air beside a diagonal log walkable', () => {
    const parts = derivedColliders(
      bare([
        {
          kind: 'CLUSTER',
          id: 'logs',
          assetId: 'log-fallen',
          positions: [{ x: 0, z: 0, rotationY: Math.PI / 4 }],
        },
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
            {
              entityId: 'chest',
              assetId: 'treasure-chest',
              position: { x: 3, z: 3 },
              label: 'Chest',
            },
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
    expect(
      derivedColliders(manifest, NO_WORLD_STATE, { ...NONE, keepClear: [{ x: 2, z: 2 }] }),
    ).toEqual([]);
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
    expect(
      derivedColliders(manifest, { ...NO_WORLD_STATE, worldChangeKeys: ['CLEARED'] }, NONE),
    ).toHaveLength(0);
  });

  it('stops the child at a barrel they used to walk through, and lets them hop onto it', () => {
    const manifest = bare([
      { kind: 'CLUSTER', id: 'barrels', assetId: 'barrel', positions: [{ x: 0, z: 3 }] },
    ]);
    const solids = solidColliders(manifest);
    const colliders = solids.map(
      ({ box }) =>
        new Box3(
          new Vector3(box.minX, box.minY, box.minZ),
          new Vector3(box.maxX, box.maxY, box.maxZ),
        ),
    );
    const jumpable = new Set(colliders.filter((_, i) => solids[i]!.jumpable));
    const controller = new FirstPersonController({
      colliders,
      jumpableColliders: jumpable,
      acceleration: 1000,
    });
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
            checkpoint.x >= box.minX &&
            checkpoint.x <= box.maxX &&
            checkpoint.z >= box.minZ &&
            checkpoint.z <= box.maxZ;
          expect(inside, `${checkpoint.id} inside a derived box`).toBe(false);
        }
      }
    });
  }
});

describe('collision profiles from the Asset Manager', () => {
  const crate: CollisionProfile = {
    behavior: 'SOLID',
    shape: 'BOX',
    boxes: [{ minX: -1, minY: 0, minZ: -0.5, maxX: 1, maxY: 0.8, maxZ: 0.5 }],
  };
  const placed = (assetId: string, x = 5, z = 2, rotationY = 0) =>
    bare([{ kind: 'CLUSTER', id: 'pieces', assetId, positions: [{ x, z, rotationY }] }]);

  it('replaces the built-in footprint with the profile, behaviour included', () => {
    const profiles = new Map([['barrel', crate]]);
    const [box, ...rest] = derivedColliders(placed('barrel'), NO_WORLD_STATE, {
      ...NONE,
      profiles,
    });
    expect(rest).toHaveLength(0);
    expect(box!.box.minX).toBeCloseTo(4);
    expect(box!.box.maxX).toBeCloseTo(6);
    // SOLID even though it is low enough to hop over: the staff said so.
    expect(box!.jumpable).toBeUndefined();
    expect(box!.box.minY).toBeLessThan(0);
  });

  it('respects the placement rotation for a profile box', () => {
    const profiles = new Map([['barrel', crate]]);
    const parts = derivedColliders(placed('barrel', 0, 0, Math.PI / 2), NO_WORLD_STATE, {
      ...NONE,
      profiles,
    });
    expect(Math.min(...parts.map((p) => p.box.minZ))).toBeCloseTo(-1);
    expect(Math.max(...parts.map((p) => p.box.maxX))).toBeCloseTo(0.5);
  });

  it('gives an asset with an empty profile no collider at all, not the default', () => {
    const profiles = new Map([
      ['barrel', { behavior: 'DECORATIVE', shape: 'NONE', boxes: [] } as CollisionProfile],
    ]);
    expect(derivedColliders(placed('barrel'), NO_WORLD_STATE, { ...NONE, profiles })).toEqual([]);
    // A profile on an asset with no built-in default gives it a collider.
    const statue = new Map([['statue-x', crate]]);
    expect(
      derivedColliders(placed('statue-x'), NO_WORLD_STATE, { ...NONE, profiles: statue }),
    ).toHaveLength(1);
  });

  it('keeps walkable pieces (paths, and any WALKABLE profile) clear of other boxes', () => {
    const manifest = bare([
      { kind: 'CLUSTER', id: 'trail', assetId: 'path', positions: [{ x: 0, z: 0 }] },
      { kind: 'CLUSTER', id: 'boards', assetId: 'deck-board', positions: [{ x: 6, z: 0 }] },
      {
        kind: 'CLUSTER',
        id: 'crates',
        assetId: 'crate',
        positions: [
          { x: 0.2, z: 0 },
          { x: 6.1, z: 0 },
          { x: 3, z: 3 },
        ],
      },
    ]);
    const profiles = new Map([
      ['deck-board', { behavior: 'WALKABLE', shape: 'BOX', boxes: [] } as CollisionProfile],
    ]);
    const ids = derivedColliders(manifest, NO_WORLD_STATE, { ...NONE, profiles }).map((c) => c.id);
    expect(ids).toEqual(['derived:crates#2']);
  });

  it('keeps building entrances clear, and only the open sides', () => {
    const manifest = bare([], {
      buildings: [
        {
          id: 'hut',
          label: 'Hut',
          x: 0,
          z: 0,
          halfWidth: 2,
          halfDepth: 2,
          height: 3,
          wallSides: ['north', 'east', 'west'],
          interiorZone: { id: 'hut-in', minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
          wallAssetId: 'wall',
        },
      ],
    } as Partial<ThreeLocationManifest>);
    expect(buildingEntrances(manifest)).toEqual([
      { x: 0, z: 2 },
      { x: 0, z: 3 },
    ]);
    const blocking = bare(
      [{ kind: 'CLUSTER', id: 'crates', assetId: 'crate', positions: [{ x: 0, z: 2.9 }] }],
      { buildings: manifest.buildings } as Partial<ThreeLocationManifest>,
    );
    expect(solidColliders(blocking).filter((c) => c.id?.startsWith('derived:'))).toEqual([]);
  });
});

describe('raised parts (GE-L16): elevation never makes a part jumpable', () => {
  type Box = DerivedCollider['box'];
  const boxOf = (min: [number, number, number], max: [number, number, number]): ModelBox => ({
    minX: min[0],
    minY: min[1],
    minZ: min[2],
    maxX: max[0],
    maxY: max[1],
    maxZ: max[2],
  });
  const at = (assetId: string, y = 0) =>
    bare([{ kind: 'MODEL', id: 'piece', assetId, position: { x: 0, y, z: 3 } }]);
  const derive = (manifest: ThreeLocationManifest, profiles?: Map<string, CollisionProfile>) =>
    derivedColliders(manifest, NO_WORLD_STATE, { ...NONE, ...(profiles ? { profiles } : {}) });

  /** A gateway 4 m wide at z 3: two wall posts, a lintel 2.2 m up, and a low raised rail. */
  const gateway: CollisionProfile = {
    behavior: 'SOLID',
    shape: 'COMPOUND',
    boxes: [
      boxOf([-2, 0, -0.2], [-0.8, 3, 0.2]), // west post
      boxOf([0.8, 0, -0.2], [2, 3, 0.2]), // east post
      boxOf([-2, 2.2, -0.2], [2, 2.8, 0.2]), // lintel: walk-under clearance
      boxOf([3, 0.05, -0.2], [5, 0.9, 0.2]), // rail a few cm up: no clearance
    ],
  };

  /** The shared controller over derived colliders, the child at (x, 0) facing +Z. */
  function walk(colliders: DerivedCollider[], x = 0, jump = false, seconds = 2) {
    const boxes = colliders.map(
      ({ box }: { box: Box }) =>
        new Box3(
          new Vector3(box.minX, box.minY, box.minZ),
          new Vector3(box.maxX, box.maxY, box.maxZ),
        ),
    );
    const controller = new FirstPersonController({
      colliders: boxes,
      jumpableColliders: new Set(boxes.filter((_, i) => colliders[i]!.jumpable)),
    });
    controller.teleport(x, 0, 0);
    for (let i = 0; i < Math.round(seconds * 60); i += 1) {
      if (jump) controller.pressJump();
      controller.update(1 / 60, { forward: 1, strafe: 0 });
    }
    return controller;
  }

  it('a raised Solid keeps its authored height and is not jumpable; ground parts reach below 0', () => {
    // Long parts are cut into short pieces along their length; group the pieces by part.
    const parts = derive(at('gate-x'), new Map([['gate-x', gateway]]));
    const posts = parts.filter((part) => part.box.maxY > 2.9);
    const lintel = parts.filter((part) => Math.abs(part.box.minY - 2.2) < 1e-6);
    const rail = parts.filter((part) => Math.abs(part.box.minY - 0.05) < 1e-6);
    expect(posts.length).toBeGreaterThan(0);
    expect(lintel.length).toBeGreaterThan(0);
    expect(rail.length).toBeGreaterThan(0);
    expect(posts.length + lintel.length + rail.length).toBe(parts.length);
    for (const post of posts) expect(post.box.minY).toBeLessThan(0);
    for (const piece of lintel) expect(piece.box.maxY).toBeCloseTo(2.8);
    for (const piece of rail) expect(piece.box.maxY).toBeCloseTo(0.9);
    for (const part of parts) expect(part.jumpable).toBeUndefined();
  });

  it('walks through the gateway under the lintel, but not past a post', () => {
    const parts = derive(at('gate-x'), new Map([['gate-x', gateway]]));
    expect(walk(parts, 0).position.z).toBeGreaterThan(5);
    expect(walk(parts, -1.4).position.z).toBeLessThan(3);
  });

  it('the low raised rail blocks like a wall: no jumping over it, no standing on it', () => {
    const parts = derive(at('gate-x'), new Map([['gate-x', gateway]]));
    const controller = walk(parts, 4, true);
    expect(controller.position.z).toBeLessThan(3);
    expect(controller.supportingBox()).toBeNull();
  });

  it('a placement elevation counts: a Solid prop 2 m up is an overhead passage, 0.5 m up a wall', () => {
    const post: CollisionProfile = {
      behavior: 'SOLID',
      shape: 'BOX',
      boxes: [boxOf([-2, 0, -0.5], [2, 0.6, 0.5])],
    };
    const profiles = new Map([['sign-x', post]]);
    const high = derive(at('sign-x', 2), profiles);
    expect(high[0]!.box.minY).toBeCloseTo(2);
    expect(high[0]!.jumpable).toBeUndefined();
    expect(walk(high).position.z).toBeGreaterThan(5);

    const low = derive(at('sign-x', 0.5), profiles);
    expect(low[0]!.box.minY).toBeCloseTo(0.5);
    expect(low[0]!.jumpable).toBeUndefined();
    expect(walk(low, 0, true).position.z).toBeLessThan(3);
  });

  it('Automatic: up to 1.2 m is jumpable wherever it is; taller is Solid, raised or not', () => {
    const short = derive(at('barrel', 2)); // a barrel on a 2 m shelf: 0.9 m tall
    expect(short[0]!.jumpable).toBe(true);
    expect(short[0]!.box.minY).toBeCloseTo(2);

    const tallRaised = derive(at('npc-test', 0.55)); // the perched character footprint, 1.6 m
    expect(tallRaised[0]!.jumpable).toBeUndefined();
    expect(tallRaised[0]!.box.minY).toBeCloseTo(0.55);
    expect(walk(tallRaised, 0, true).position.z).toBeLessThan(3);

    const tallHigh = derive(at('npc-test', 2)); // 2 m up: clearance under it
    expect(tallHigh[0]!.jumpable).toBeUndefined();
    expect(walk(tallHigh).position.z).toBeGreaterThan(5);
  });

  it('Automatic thresholds (built-in footprints): 1.2 m is jumpable, just over is Solid', () => {
    // Profiles arrive already resolved (Django turns AUTO into JUMPABLE or SOLID); the client's
    // own Automatic rule is for the built-in footprints, at their drawn (scaled) height.
    const scaled = (y: number) =>
      bare([
        {
          kind: 'MODEL',
          id: 'piece',
          assetId: 'crate', // 0.8 m at scale 1
          position: { x: 0, y: 0, z: 3 },
          scale: { x: 1, y, z: 1 },
        },
      ]);
    expect(derive(scaled(JUMPABLE_MAX_HEIGHT / 0.8))[0]!.jumpable).toBe(true);
    const over = derive(scaled((JUMPABLE_MAX_HEIGHT + 0.01) / 0.8))[0]!;
    expect(over.jumpable).toBeUndefined();
    expect(over.box.minY).toBeLessThan(0);
    // The same piece raised 2 m: still Solid by its height, now with walk-under clearance.
    const raised = derive(
      bare([
        {
          kind: 'MODEL',
          id: 'piece',
          assetId: 'crate',
          position: { x: 0, y: 2, z: 3 },
          scale: { x: 1, y: 1.6, z: 1 },
        },
      ]),
    )[0]!;
    expect(raised.jumpable).toBeUndefined();
    expect(raised.box.minY).toBeCloseTo(2);
    expect(walk([raised]).position.z).toBeGreaterThan(5);
  });

  it('a raised Jumpable part stays jumpable and keeps its height (an elevated platform)', () => {
    const deck: CollisionProfile = {
      behavior: 'JUMPABLE',
      shape: 'BOX',
      boxes: [boxOf([-2, 0.6, -1], [2, 0.8, 1])],
    };
    const [part] = derive(at('deck-x'), new Map([['deck-x', deck]]));
    expect(part!.jumpable).toBe(true);
    expect(part!.box.minY).toBeCloseTo(0.6);
  });

  it('a malformed raised box is refused, so the asset keeps its built-in default', () => {
    const raised = { minX: -1, minY: 2, minZ: -1, maxX: 1, maxY: 1.5, maxZ: 1 };
    expect(parseCollisionProfile({ behavior: 'SOLID', boxes: [raised] })).toBeUndefined();
    expect(
      parseCollisionProfile({ behavior: 'SOLID', boxes: [{ ...raised, maxY: undefined }] }),
    ).toBeUndefined();
  });
});

describe('parseCollisionProfile', () => {
  it('accepts a valid answer and refuses malformed ones', () => {
    const box = { minX: -1, minY: 0, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 };
    expect(
      parseCollisionProfile({ behavior: 'JUMPABLE', shape: 'BOX', boxes: [box] })?.boxes,
    ).toEqual([box]);
    expect(
      parseCollisionProfile({ behavior: 'WALKABLE', shape: 'BOX', boxes: [box] })?.boxes,
    ).toEqual([]);
    expect(parseCollisionProfile({ behavior: 'FLYING', boxes: [] })).toBeUndefined();
    expect(
      parseCollisionProfile({ behavior: 'SOLID', boxes: [{ ...box, maxX: -2 }] }),
    ).toBeUndefined();
    expect(
      parseCollisionProfile({ behavior: 'SOLID', boxes: [{ ...box, maxY: 9999 }] }),
    ).toBeUndefined();
    expect(
      parseCollisionProfile({ behavior: 'SOLID', boxes: Array(33).fill(box) }),
    ).toBeUndefined();
    expect(parseCollisionProfile(null)).toBeUndefined();
  });
});
