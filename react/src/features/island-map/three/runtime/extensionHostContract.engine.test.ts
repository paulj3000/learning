// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import type { FirstPersonController } from '@lai/game-engine/movement';
import type { EnvironmentQuery } from '@lai/game-engine/contracts';
import type { WorldExtension, WorldExtensionContext } from './extensionRegistry';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { mount, named, standAt, walk, type Harness } from './testing/engineHarness';
import { nearestStandableSpot, TELEPORT_SEARCH_RADIUS } from './nearestStandableSpot';

/**
 * GE-070 step 3: the live runtime's extension context as the engine bridge (GE-065) and every
 * extension rely on it. GE-D2 (removal leaves every list), GE-D3 (extension colliders have ids),
 * GE-D4 (checked, silent teleport) and the bridge host members `playerState` and
 * `setEnvironment`.
 */

const PROBE = 'host-probe';

/** An authored manifest collider far from the play lanes, for GE-D2. */
const AUTHORED_ID = 'probe-authored-crate';

async function withProbe(): Promise<{
  harness: Harness;
  context: WorldExtensionContext;
  controller: () => FirstPersonController;
}> {
  let captured: WorldExtensionContext | null = null;
  const extension: WorldExtension = {
    id: PROBE,
    mount(context) {
      captured = context;
    },
  };
  const manifest: ThreeLocationManifest = {
    ...WELCOME_HARBOR_MANIFEST,
    colliders: [
      ...WELCOME_HARBOR_MANIFEST.colliders,
      { rect: { id: AUTHORED_ID, minX: 8, maxX: 8.5, minZ: 8, maxZ: 8.5 }, minY: 0, maxY: 0.4, jumpable: true },
    ],
    extensions: [{ extensionId: PROBE, config: {} }],
  };
  const harness = mount({ manifest, extensions: [extension] });
  await harness.engine.ready;
  let controller: FirstPersonController | null = null;
  harness.setDrive((c) => {
    controller = c;
  });
  harness.runFrames(1);
  if (!captured || !controller) throw new Error('probe extension did not mount');
  return { harness, context: captured, controller: () => controller! };
}

/**
 * A clear lane 6 m east (+X) from a spot the child can stand on, inside Welcome Harbor's playable
 * area (ground half extent 12, so |x|, |z| <= 9 keeps clear of the boundary recovery).
 */
function clearLane(controller: FirstPersonController): { x: number; z: number } {
  for (let x = -9; x <= 3; x += 1) {
    for (let z = -7; z <= 7; z += 1) {
      let clear = true;
      for (let step = 0; step <= 6 && clear; step += 0.25) clear = controller.canStandAt(x + step, z);
      if (clear) return { x, z };
    }
  }
  throw new Error('no clear lane in the test location');
}

const FACE_EAST = Math.PI / 2; // yaw 0 faces +Z; +X is a quarter turn

/** Stands still with physics running (gravity, landing), unlike the harness's standAt. */
const idle = (c: FirstPersonController, delta: number) => c.update(delta, { forward: 0, strafe: 0 });

/** Walks east for `frames` frames from `start` and returns how far the child got. */
function walkEast(harness: Harness, controller: () => FirstPersonController, start: { x: number; z: number }, frames = 90): number {
  harness.setDrive(standAt(start.x, start.z, FACE_EAST));
  harness.runFrames(1);
  harness.setDrive(walk(FACE_EAST));
  harness.runFrames(frames);
  return controller().position.x - start.x;
}

/** A wall across the lane, 2 m ahead of `start`. */
function wallAhead(start: { x: number; z: number }, height = 2): Box3 {
  return new Box3(new Vector3(start.x + 2, 0, start.z - 1), new Vector3(start.x + 2.4, height, start.z + 1));
}

describe('extension host contract (GE-070): colliders', () => {
  it('returns the requested id, and removing it by that id lets the child through (GE-D3)', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    expect(context.addCollider(wallAhead(start), { id: 'probe:wall' })).toBe('probe:wall');
    const blocked = walkEast(harness, controller, start);
    expect(blocked).toBeLessThan(2);
    expect(context.removeCollider('probe:wall')).toBe(true);
    expect(walkEast(harness, controller, start)).toBeGreaterThan(3);
    // Gone from every list: a second removal finds nothing (GE-D2).
    expect(context.removeCollider('probe:wall')).toBe(false);
  });

  it('generates an id when none is given, and refuses derived ids', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    const generated = context.addCollider(wallAhead(start));
    expect(generated).toMatch(/^extension:host-probe:\d+$/);
    const refused = context.addCollider(new Box3(new Vector3(90, 0, 90), new Vector3(91, 1, 91)), {
      id: 'derived:palm',
    });
    expect(refused).toMatch(/^extension:host-probe:\d+$/);
    expect(refused).not.toBe(generated);
    expect(context.removeCollider(generated as string)).toBe(true);
    expect(walkEast(harness, controller, start)).toBeGreaterThan(3);
  });

  it('re-adding an id replaces its box', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    context.addCollider(wallAhead(start), { id: 'probe:moved' });
    context.addCollider(new Box3(new Vector3(90, 0, 90), new Vector3(91, 2, 91)), { id: 'probe:moved' });
    expect(walkEast(harness, controller, start)).toBeGreaterThan(3);
  });

  it('keeps the box by reference, so moving it in place is live (the bridge moves doors)', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    const box = new Box3(new Vector3(90, 0, 90), new Vector3(91, 2, 91));
    context.addCollider(box, { id: 'probe:door' });
    expect(walkEast(harness, controller, start)).toBeGreaterThan(3);
    box.copy(wallAhead(start));
    expect(walkEast(harness, controller, start)).toBeLessThan(2);
  });

  it('a low jumpable box can be hopped onto, but a gate never can', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    const low = () => wallAhead(start, 0.5);
    const hopDistance = (options: { jumpable?: boolean; gate?: boolean }, id: string) => {
      context.addCollider(low(), { id, ...options });
      harness.setDrive(standAt(start.x, start.z, FACE_EAST));
      harness.runFrames(1);
      let frame = 0;
      harness.setDrive((c, delta) => {
        c.yaw = FACE_EAST;
        if (frame === 20) c.pressJump();
        frame += 1;
        c.update(delta, { forward: 1, strafe: 0 });
      });
      harness.runFrames(90);
      const travelled = controller().position.x - start.x;
      context.removeCollider(id);
      return travelled;
    };
    expect(hopDistance({ jumpable: true }, 'probe:log')).toBeGreaterThan(2.4);
    expect(hopDistance({ jumpable: true, gate: true }, 'probe:gate')).toBeLessThan(2);
  });

  it('removing an authored manifest collider takes it out of every list (GE-D2)', async () => {
    const { harness, context, controller } = await withProbe();
    // Standing on the authored low crate: it is the support underfoot.
    harness.setDrive(standAt(8.25, 8.25, FACE_EAST));
    harness.runFrames(1);
    harness.setDrive((c) => {
      c.position.y = 0.4;
    });
    harness.runFrames(1);
    harness.setDrive(idle);
    harness.runFrames(5);
    expect(context.playerState!().supportId).toBe(AUTHORED_ID);
    expect(context.removeCollider(AUTHORED_ID)).toBe(true);
    harness.runFrames(60);
    // Gone from every list: nothing holds the child up, nothing names it, a second removal fails.
    expect(controller().position.y).toBeCloseTo(0, 5);
    expect(context.playerState!().supportId).toBeNull();
    expect(context.removeCollider(AUTHORED_ID)).toBe(false);
    // The id is free again: an extension may put a box back under it.
    expect(context.addCollider(new Box3(new Vector3(90, 0, 90), new Vector3(91, 1, 91)), { id: AUTHORED_ID })).toBe(
      AUTHORED_ID,
    );
  });
});

describe('extension host contract (GE-070): player state and environment', () => {
  it('reports the collided feet, achieved velocity, controller yaw and grounding', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    harness.setDrive(standAt(start.x, start.z, FACE_EAST));
    harness.runFrames(2);
    const still = context.playerState!();
    expect(still.position.x).toBeCloseTo(start.x, 5);
    expect(still.position.z).toBeCloseTo(start.z, 5);
    expect(still.yaw).toBeCloseTo(FACE_EAST, 5);
    expect(still.grounded).toBe(true);
    expect(still.supportId).toBeNull();
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(40);
    const moving = context.playerState!();
    expect(moving.velocity.x).toBeGreaterThan(1); // walking east is +X
    expect(Math.abs(moving.velocity.z)).toBeLessThan(0.1);
  });

  it('names the collider underfoot (supportId)', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    // A low step the child walks up onto (under the 0.25 m step height).
    context.addCollider(
      new Box3(new Vector3(start.x + 1, 0, start.z - 1), new Vector3(start.x + 3, 0.2, start.z + 1)),
      { id: 'probe:step', jumpable: true },
    );
    harness.setDrive(standAt(start.x, start.z, FACE_EAST));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(30);
    harness.setDrive(idle);
    harness.runFrames(5);
    expect(controller().position.x).toBeGreaterThan(start.x + 1.2);
    expect(controller().position.x).toBeLessThan(start.x + 2.8);
    expect(context.playerState!().supportId).toBe('probe:step');
  });

  it('hands an EnvironmentQuery to the live controller, and null back', async () => {
    const { context, controller } = await withProbe();
    const calls: (EnvironmentQuery | null)[] = [];
    const live = controller();
    const original = live.setEnvironment.bind(live);
    live.setEnvironment = (query) => {
      calls.push(query);
      original(query);
    };
    const query = {} as EnvironmentQuery;
    context.setEnvironment!(query);
    context.setEnvironment!(null);
    expect(calls).toEqual([query, null]);
  });
});

describe('extension host contract (GE-066): live carry and launch', () => {
  it('carryPlayer and launchPlayer reach the live controller', async () => {
    const { context, controller } = await withProbe();
    const live = controller();
    const carries: number[][] = [];
    const launches: number[] = [];
    const carry = live.carry.bind(live);
    const launch = live.launch.bind(live);
    live.carry = (dx, dy, dz) => {
      carries.push([dx, dy, dz]);
      carry(dx, dy, dz);
    };
    live.launch = (height) => {
      launches.push(height);
      launch(height);
    };
    const y = live.position.y;
    context.carryPlayer!(0, 0.5, 0);
    expect(carries).toEqual([[0, 0.5, 0]]);
    expect(live.position.y).toBeCloseTo(y + 0.5, 5);
    context.launchPlayer!(2);
    expect(launches).toEqual([2]);
    expect(live.grounded).toBe(false);
  });

  it('reports an engine: collider id as the support id', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    context.addCollider(new Box3(new Vector3(start.x + 1, 0, start.z - 1), new Vector3(start.x + 3, 0.2, start.z + 1)), { id: 'engine:pad', jumpable: true });
    harness.setDrive(standAt(start.x, start.z, FACE_EAST));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_EAST));
    harness.runFrames(30);
    harness.setDrive(idle);
    harness.runFrames(5);
    expect(context.playerState!().supportId).toBe('engine:pad');
  });
});

describe('extension host contract (GE-070): teleport (GE-D4)', () => {
  it('places the child exactly on a clear spot and emits nothing', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    const before = harness.events.length;
    context.teleportPlayer(start.x + 1, start.z, FACE_EAST);
    expect(controller().position.x).toBeCloseTo(start.x + 1, 5);
    expect(controller().position.z).toBeCloseTo(start.z, 5);
    expect(harness.events.slice(before)).toEqual([]);
    expect(named(harness.events, 'PlayerRecovered')).toEqual([]);
  });

  it('never drops the child inside a wall: a blocked spot falls back to the nearest clear one', async () => {
    const { harness, context, controller } = await withProbe();
    const start = clearLane(controller());
    const wall = new Box3(new Vector3(start.x + 2, 0, start.z - 0.5), new Vector3(start.x + 3, 2, start.z + 0.5));
    context.addCollider(wall, { id: 'probe:over-the-checkpoint' });
    const before = harness.events.length;
    context.teleportPlayer(start.x + 2.5, start.z, FACE_EAST);
    const at = controller().position;
    expect(controller().canStandAt(at.x, at.z)).toBe(true);
    expect(Math.hypot(at.x - (start.x + 2.5), at.z - start.z)).toBeLessThanOrEqual(TELEPORT_SEARCH_RADIUS + 1e-6);
    expect(harness.events.slice(before)).toEqual([]);
  });
});

describe('nearestStandableSpot', () => {
  it('returns the closest clear ring point and null when nothing near is clear', () => {
    const blockedWithin = (r: number) => (x: number, z: number) => Math.hypot(x, z) > r;
    const spot = nearestStandableSpot(0, 0, blockedWithin(0.6));
    expect(spot).not.toBeNull();
    expect(Math.hypot(spot!.x, spot!.z)).toBeGreaterThan(0.6);
    expect(Math.hypot(spot!.x, spot!.z)).toBeLessThanOrEqual(0.75 + 1e-9);
    expect(nearestStandableSpot(0, 0, () => false)).toBeNull();
    expect(nearestStandableSpot(Number.NaN, 0, () => true)).toBeNull();
  });
});
