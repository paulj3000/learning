import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FirstPersonController } from '@lai/game-engine/movement';
import { Box3, Vector3 } from 'three';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { NO_WORLD_STATE } from './sceneLayout';
import {
  carveOpening,
  derivedColliders,
  OVERHEAD_KEEP_CLEAR_HEIGHT,
  PASSAGE_OPENINGS,
  type DerivedCollider,
} from './derivedColliders';
import type { CollisionProfile, ModelBox } from './collisionProfile';

/**
 * Passage pieces (GE-L16 follow-up, Trello #247): whatever box an archway is given (its built-in
 * footprint, an Automatic profile, or a staff box over its whole bounds), the jambs block, the
 * opening is a walk-under passage, and the lintel is an overhead Solid.
 */

const NONE = { assetKinds: new Map(), authored: [], keepClear: [] };
const ARCH = PASSAGE_OPENINGS.archway!;

const box = (min: [number, number, number], max: [number, number, number]): ModelBox => ({
  minX: min[0],
  minY: min[1],
  minZ: min[2],
  maxX: max[0],
  maxY: max[1],
  maxZ: max[2],
});

/** The archway's whole bounds (`archway()` in the generator): 2.6 x 3 x 0.6 m. */
const WHOLE = box([-1.3, 0, -0.3], [1.3, 3, 0.3]);
const solidWhole: CollisionProfile = { behavior: 'SOLID', shape: 'BOX', boxes: [WHOLE] };
/**
 * An Automatic profile as the client receives it: Django resolves Automatic per profile (a union
 * over 1.2 m is Solid), so a 3 m archway arrives as Solid boxes from the version's bounds.
 */
const automaticWhole: CollisionProfile = { behavior: 'SOLID', shape: 'AUTOMATIC', boxes: [WHOLE] };
const jambs: CollisionProfile = {
  behavior: 'SOLID',
  shape: 'COMPOUND',
  boxes: [box([-1.3, 0, -0.3], [-1, 2.6, 0.3]), box([1, 0, -0.3], [1.3, 2.6, 0.3])],
};

function manifest(
  scenery: ThreeLocationManifest['scenery'],
  extra: Partial<ThreeLocationManifest> = {},
): ThreeLocationManifest {
  return { ...WELCOME_HARBOR_MANIFEST, scenery, props: [], npcs: [], colliders: [], ...extra };
}

/** One archway at (0, 3), its opening across the child's walk up +Z from (x, 0). */
const archwayAt = (scale?: { x?: number; y?: number; z?: number }) =>
  manifest([
    {
      kind: 'LOD_PLACEMENTS',
      id: 'arches',
      assetId: 'archway',
      positions: [{ x: 0, z: 3, ...(scale ? { scale } : {}) }],
    },
  ]);

const derive = (
  m: ThreeLocationManifest,
  profile?: CollisionProfile,
  keepClear: { x: number; z: number }[] = [],
) =>
  derivedColliders(m, NO_WORLD_STATE, {
    ...NONE,
    keepClear,
    ...(profile ? { profiles: new Map([['archway', profile]]) } : {}),
  });

function controllerOver(colliders: DerivedCollider[]) {
  const boxes = colliders.map(
    ({ box: b }) =>
      new Box3(new Vector3(b.minX, b.minY, b.minZ), new Vector3(b.maxX, b.maxY, b.maxZ)),
  );
  return new FirstPersonController({
    colliders: boxes,
    jumpableColliders: new Set(boxes.filter((_, i) => colliders[i]!.jumpable)),
  });
}

/** The ground jambs and the raised lintel pieces (a long part is cut along its length). */
function split(parts: DerivedCollider[]) {
  const jambs = parts.filter((part) => part.box.minY < 0);
  const lintel = parts.filter((part) => part.box.minY > 0);
  expect(jambs.length + lintel.length).toBe(parts.length);
  return { jambs, lintel };
}

/** Walks (and optionally keeps jumping) up +Z from (x, 0); reports where it ended and how high. */
function walk(colliders: DerivedCollider[], x: number, jump = false, seconds = 3) {
  const controller = controllerOver(colliders);
  controller.teleport(x, 0, 0);
  let highestFeet = 0;
  for (let i = 0; i < Math.round(seconds * 60); i += 1) {
    if (jump) controller.pressJump();
    controller.update(1 / 60, { forward: 1, strafe: 0 });
    highestFeet = Math.max(highestFeet, controller.position.y);
  }
  return { z: controller.position.z, highestFeet, standingOn: controller.supportingBox() };
}

/** Jumps on the spot at (x, z) for two seconds; the highest the feet got. */
function jumpInPlace(colliders: DerivedCollider[], x: number, z: number) {
  const controller = controllerOver(colliders);
  controller.teleport(x, z, 0);
  let highestFeet = 0;
  for (let i = 0; i < 120; i += 1) {
    controller.pressJump();
    controller.update(1 / 60, { forward: 0, strafe: 0 });
    highestFeet = Math.max(highestFeet, controller.position.y);
  }
  return highestFeet;
}

describe('carveOpening', () => {
  it('leaves a box clear of the opening unchanged', () => {
    const left = box([-1.3, 0, -0.3], [-1, 2.6, 0.3]);
    expect(carveOpening(left, ARCH)).toEqual([left]);
    const above = box([-1.3, 2.6, -0.3], [1.3, 3, 0.3]);
    expect(carveOpening(above, ARCH)).toEqual([above]);
  });

  it('cuts a whole-bounds box into two jambs and a lintel over the opening', () => {
    expect(carveOpening(WHOLE, ARCH)).toEqual([
      box([-1.3, 0, -0.3], [-1, 3, 0.3]),
      box([1, 0, -0.3], [1.3, 3, 0.3]),
      box([-1, 2.6, -0.3], [1, 3, 0.3]),
    ]);
  });

  it('removes a box that lies entirely inside the opening', () => {
    expect(carveOpening(box([-0.5, 0, -0.3], [0.5, 2, 0.3]), ARCH)).toEqual([]);
  });

  it('measures the archway opening from the generator: 2 m wide, 2.6 m high', () => {
    expect(ARCH).toEqual({ minX: -1, maxX: 1, top: 2.6 });
  });
});

describe('an archway in every collision set-up', () => {
  const setups: [string, CollisionProfile | undefined][] = [
    ['the built-in footprint (no profile)', undefined],
    ['a staff Solid box over the whole bounds', solidWhole],
    ['an Automatic box over the whole bounds', automaticWhole],
  ];

  it.each(setups)('%s: two ground jambs and a raised Solid lintel at 2.6 m', (_, profile) => {
    const parts = derive(archwayAt(), profile);
    const {
      jambs: [west, east, ...more],
      lintel,
    } = split(parts);
    expect(more).toEqual([]);
    expect(west!.box.maxX).toBeCloseTo(-1);
    expect(west!.box.maxY).toBeCloseTo(3);
    expect(east!.box.minX).toBeCloseTo(1);
    expect(lintel.length).toBeGreaterThan(0);
    for (const piece of lintel) {
      expect(piece.box.minY).toBeCloseTo(2.6);
      expect(piece.box.maxY).toBeCloseTo(3);
    }
    expect(Math.min(...lintel.map((piece) => piece.box.minX))).toBeCloseTo(-1);
    expect(Math.max(...lintel.map((piece) => piece.box.maxX))).toBeCloseTo(1);
    // Jumpable is decided on the whole part (3 m), so a carved 0.4 m lintel stays Solid.
    for (const part of parts) expect(part.jumpable).toBeUndefined();
  });

  it.each(setups)('%s: walks through the opening, under the lintel', (_, profile) => {
    expect(walk(derive(archwayAt(), profile), 0).z).toBeGreaterThan(5);
  });

  it.each(setups)('%s: never walks through a jamb', (_, profile) => {
    expect(walk(derive(archwayAt(), profile), -1.15).z).toBeLessThan(3);
    expect(walk(derive(archwayAt(), profile), 1.15).z).toBeLessThan(3);
  });

  it.each(setups)('%s: no jump carries the child over or onto the lintel', (_, profile) => {
    const parts = derive(archwayAt(), profile);
    // Under the lintel the rising head stops at its underside: feet top out at 2.6 - 1.7 m.
    expect(jumpInPlace(parts, 0, 3)).toBeLessThanOrEqual(0.9 + 1e-6);
    // Jumping into the jamb line from either side never gets the child past it.
    const atJamb = walk(parts, -1.15, true);
    expect(atJamb.z).toBeLessThan(3);
    expect(atJamb.standingOn).toBeNull();
    // Jumping through the opening lands on the far side, never on top of the arch.
    const through = walk(parts, 0, true);
    expect(through.z).toBeGreaterThan(5);
    expect(through.highestFeet).toBeLessThan(3);
    expect(through.standingOn).toBeNull();
  });

  it('a jump in the open still reaches its full height (the head bump is the lintel)', () => {
    expect(jumpInPlace(derive(archwayAt()), 0, -3)).toBeGreaterThan(1);
  });

  it('keeps an explicit jamb profile exactly as authored: no lintel is invented', () => {
    const parts = derive(archwayAt(), jambs);
    expect(parts.map((part) => part.box.maxY)).toEqual([2.6, 2.6]);
    expect(walk(parts, 0).z).toBeGreaterThan(5);
    expect(walk(parts, -1.15).z).toBeLessThan(3);
  });

  it('an empty (never blocks) profile still means no collider at all', () => {
    expect(derive(archwayAt(), { behavior: 'SOLID', shape: 'BOX', boxes: [] })).toEqual([]);
  });

  it('a Walkable profile is never carved into anything', () => {
    expect(derive(archwayAt(), { behavior: 'WALKABLE', shape: 'BOX', boxes: [] })).toEqual([]);
  });
});

describe('insufficient clearance and scaled archways', () => {
  it('an archway scaled down until its opening is lower than the avatar is a wall', () => {
    // Opening 2.6 x 0.6 = 1.56 m, under the 1.7 m collider: the lintel is a column.
    const parts = derive(archwayAt({ y: 0.6 }), solidWhole);
    for (const piece of split(parts).lintel) expect(piece.box.minY).toBeCloseTo(1.56);
    expect(walk(parts, 0).z).toBeLessThan(3);
  });

  it('a narrowed archway keeps its narrower opening (the castle secret passage, 0.75 wide)', () => {
    const parts = derive(archwayAt({ x: 0.75 }), solidWhole);
    const { jambs } = split(parts);
    expect(jambs[0]!.box.maxX).toBeCloseTo(-0.75);
    expect(jambs[1]!.box.minX).toBeCloseTo(0.75);
    expect(walk(parts, 0).z).toBeGreaterThan(5);
    expect(walk(parts, 0.9).z).toBeLessThan(3);
  });

  it('a turned archway carves along its own axis (a wall running along Z)', () => {
    const turned = manifest([
      {
        kind: 'LOD_PLACEMENTS',
        id: 'arches',
        assetId: 'archway',
        positions: [{ x: 3, z: 0, rotationY: -Math.PI / 2 }],
      },
    ]);
    const { jambs, lintel } = split(derive(turned, solidWhole));
    expect(jambs).toHaveLength(2);
    expect(Math.min(...lintel.map((piece) => piece.box.minZ))).toBeCloseTo(-1);
    expect(Math.max(...lintel.map((piece) => piece.box.maxZ))).toBeCloseTo(1);
    for (const piece of lintel) expect(piece.box.minX).toBeCloseTo(2.7);
  });
});

describe('keeping passages and checkpoints clear', () => {
  it('a checkpoint in the opening never drops the archway: the lintel walls nothing in', () => {
    const parts = derive(archwayAt(), solidWhole, [{ x: 0, z: 3 }]);
    expect(split(parts).jambs).toHaveLength(2);
  });

  it("another piece's box across an archway's centre is dropped, so the doorway stays open", () => {
    const crate: CollisionProfile = {
      behavior: 'SOLID',
      shape: 'BOX',
      boxes: [box([-1, 0, -1], [1, 2, 1])],
    };
    const parts = derivedColliders(
      manifest([
        { kind: 'LOD_PLACEMENTS', id: 'arches', assetId: 'archway', positions: [{ x: 0, z: 3 }] },
        { kind: 'CLUSTER', id: 'crates', assetId: 'crate', positions: [{ x: 0, z: 3.2 }] },
      ]),
      NO_WORLD_STATE,
      { ...NONE, profiles: new Map([['crate', crate]]) },
    );
    expect(parts.map((part) => part.id).filter((id) => id.includes('crates'))).toEqual([]);
  });

  it('an overhead Solid part over a checkpoint keeps its piece; a lower one still drops it', () => {
    const at = (minY: number): CollisionProfile => ({
      behavior: 'SOLID',
      shape: 'BOX',
      boxes: [box([-1, minY, -1], [1, minY + 0.5, 1])],
    });
    const piece = manifest([
      { kind: 'MODEL', id: 'canopy', assetId: 'canopy', position: { x: 0, y: 0, z: 3 } },
    ]);
    const options = (profile: CollisionProfile) => ({
      ...NONE,
      keepClear: [{ x: 0, z: 3 }],
      profiles: new Map([['canopy', profile]]),
    });
    expect(
      derivedColliders(piece, NO_WORLD_STATE, options(at(OVERHEAD_KEEP_CLEAR_HEIGHT))),
    ).toHaveLength(1);
    expect(
      derivedColliders(piece, NO_WORLD_STATE, options(at(OVERHEAD_KEEP_CLEAR_HEIGHT - 0.1))),
    ).toEqual([]);
  });

  it('the overhead threshold allows for the largest clearance margin (1.7 + 0.5 m)', () => {
    expect(OVERHEAD_KEEP_CLEAR_HEIGHT).toBeCloseTo(2.2);
  });
});

describe("Treasure Cove's ruins archway (a Django region)", () => {
  const layout = JSON.parse(
    readFileSync(resolve(process.cwd(), '../lai/apps/regions/treasure_cove_layout.json'), 'utf8'),
  ) as { scenery: { id: string; assetId?: string; scale?: { x: number; y: number } }[] };
  const ruins = layout.scenery.find((item) => item.id === 'cove-ruins-archway')!;

  it('is the shared archway, widened to 1.55 and raised to 1.25', () => {
    expect(ruins).toMatchObject({ assetId: 'archway', scale: { x: 1.55, y: 1.25 } });
  });

  it('blocks at its jambs, opens 3.1 m into the ruins, and keeps its lintel overhead', () => {
    const parts = derive(archwayAt({ x: ruins.scale!.x, y: ruins.scale!.y }));
    const { jambs, lintel } = split(parts);
    expect(jambs).toHaveLength(2);
    for (const piece of lintel) expect(piece.box.minY).toBeCloseTo(3.25);
    expect(walk(parts, 0).z).toBeGreaterThan(5);
    // Off-centre too, as long as the body (0.37 m reach) clears the jamb at 1.55 m.
    expect(walk(parts, 1).z).toBeGreaterThan(5);
    expect(walk(parts, 1.8).z).toBeLessThan(3);
    expect(walk(parts, -1.8).z).toBeLessThan(3);
  });
});
