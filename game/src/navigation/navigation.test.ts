import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController } from '../movement/firstPersonController';
import {
  assistedYaw,
  buildWalkGrid,
  findWalkPath,
  floodReachable,
  GuidedSteering,
  isGuidedBand,
  isReachable,
  NAV_CELL_SIZE,
  shortestAngle,
  unreachableTargets,
  type WalkCollider,
  type WalkabilityInput,
} from './index';

const box = (
  id: string,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  maxY = 2,
  extra: Partial<WalkCollider> = {},
): WalkCollider => ({
  id,
  min: { x: minX, y: -0.5, z: minZ },
  max: { x: maxX, y: maxY, z: maxZ },
  ...extra,
});

/** A 20 x 20 m yard (x and z from -10 to 10) with no inner walls. */
const YARD = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

describe('walkable grid', () => {
  it('rasterises simple colliders with the agent margin and a cell grid over the bounds', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: [box('wall', -1, -1, 1, 1)] });
    expect(grid.cellSize).toBe(NAV_CELL_SIZE);
    expect(grid.cols).toBe(100);
    expect(grid.rows).toBe(100);
    // Centre of the wall and 0.3 m from its face: blocked (inside the 0.39 m margin).
    expect(grid.isFreeAt(0, 0)).toBe(false);
    expect(grid.isFreeAt(1.3, 0)).toBe(false);
    // 0.5 m from the face: free. Far away: free.
    expect(grid.isFreeAt(1.5, 0)).toBe(true);
    expect(grid.isFreeAt(-8, 8)).toBe(true);
    const c = grid.cellOf(0, 0);
    expect(grid.isFreeCell(c.col, c.row)).toBe(false);
    const f = grid.cellOf(5, 5);
    expect(grid.isFreeCell(f.col, f.row)).toBe(true);
  });

  it('follows the controller rules for step height, jumpable boxes and overhead lintels', () => {
    const grid = buildWalkGrid({
      bounds: YARD,
      colliders: [
        // A 0.2 m kerb, jumpable: walked over, never blocks.
        box('kerb', -5, -1, -3, 1, 0.2, { kind: 'JUMPABLE' }),
        // A 0.6 m crate, jumpable: taller than a step, so a path avoids it (no jump links).
        box('crate', 3, -1, 5, 1, 0.6, { kind: 'JUMPABLE' }),
        // A lintel from 2 m up (gap over the 1.7 m body): walk under.
        { id: 'lintel', min: { x: 7, y: 2, z: -1 }, max: { x: 9, y: 3, z: 1 } },
        // A trigger volume never blocks.
        box('zone', -9, 5, -7, 7, 2, { kind: 'TRIGGER' }),
        // Entirely below ground: ignored.
        { id: 'pit', min: { x: -9, y: -3, z: -9 }, max: { x: -7, y: -1, z: -7 } },
      ],
    });
    expect(grid.isFreeAt(-4, 0)).toBe(true);
    expect(grid.isFreeAt(4, 0)).toBe(false);
    expect(grid.isFreeAt(8, 0)).toBe(true);
    expect(grid.isFreeAt(-8, 6)).toBe(true);
    expect(grid.isFreeAt(-8, -8)).toBe(true);
  });

  it('refuses a grid it cannot size, and a collider with min above max', () => {
    expect(() => buildWalkGrid({ colliders: [] })).toThrow();
    expect(() => buildWalkGrid({ bounds: YARD, colliders: [box('bad', 2, 0, 1, 1)] })).toThrow();
    expect(() =>
      buildWalkGrid({ bounds: { minX: 0, maxX: 5000, minZ: 0, maxZ: 5000 }, colliders: [] }),
    ).toThrow();
  });

  it('builds a large Area fast by raising the cell size past the cell budget', () => {
    const started = Date.now();
    const grid = buildWalkGrid({
      bounds: { minX: -150, maxX: 150, minZ: -150, maxZ: 150 },
      colliders: [box('a', -20, -20, 20, 20)],
    });
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(420_000);
    expect(grid.cellSize).toBeGreaterThan(NAV_CELL_SIZE);
    // Generous: this host has slow timers and cold JIT.
    expect(Date.now() - started).toBeLessThan(8000);
  });
});

describe('path search', () => {
  // An L-shaped wall: a long arm along z at x = 0 (z from -8 to 4) and a foot along x at z = 4.
  const L_WALL = [box('arm', -0.3, -8, 0.3, 4), box('foot', -0.3, 3.7, 5, 4.3)];

  it('walks straight where nothing is in the way', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: [] });
    const path = findWalkPath(grid, { x: -8, z: -8 }, { x: 8, z: 8 });
    expect(path.status).toBe('REACHED');
    expect(path.points).toHaveLength(2);
    expect(path.goal).toEqual({ x: 8, z: 8 });
  });

  it('goes around an L-shaped wall and never through it', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: L_WALL });
    const path = findWalkPath(grid, { x: -4, z: 0 }, { x: 3, z: 0 });
    expect(path.status).toBe('REACHED');
    expect(path.points.length).toBeGreaterThan(2);
    // Every leg is clear of the wall's margin, and the walk is longer than the straight line.
    for (let i = 1; i < path.points.length; i += 1) {
      expect(grid.segmentClear(path.points[i - 1], path.points[i])).toBe(true);
    }
    expect(path.length).toBeGreaterThan(7 + 1);
    // It goes round the open south end (z < -8) of the arm... or the north gap is closed by the foot.
    const passesSouth = path.points.some((p) => p.z < -8);
    const passesNorth = path.points.some((p) => p.z > 4.3);
    expect(passesSouth || passesNorth).toBe(true);
  });

  it('smoothing never leaves fewer legs than the raw path needs to clear corners', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: L_WALL });
    const raw = findWalkPath(grid, { x: -4, z: 0 }, { x: 3, z: 0 }, { smooth: false });
    const smooth = findWalkPath(grid, { x: -4, z: 0 }, { x: 3, z: 0 });
    expect(smooth.points.length).toBeLessThan(raw.points.length);
    expect(smooth.length).toBeLessThanOrEqual(raw.length + 1e-6);
  });

  it('never routes through a hazard area, and keeps its margin', () => {
    // A river across the whole yard, with no bridge: nothing on the far side is reachable.
    const river = { id: 'river', minX: -10, maxX: 10, minZ: -1, maxZ: 1 };
    const grid = buildWalkGrid({ bounds: YARD, colliders: [], hazards: [river] });
    const path = findWalkPath(grid, { x: 0, z: -6 }, { x: 0, z: 6 });
    expect(path.status).toBe('NEAREST');
    for (const p of path.points) {
      expect(p.z).toBeLessThan(-1.2);
    }
    // A hazard with a gap goes round it.
    const dam = { id: 'dam', minX: -10, maxX: 5, minZ: -1, maxZ: 1 };
    const around = findWalkPath(
      buildWalkGrid({ bounds: YARD, colliders: [], hazards: [dam] }),
      { x: 0, z: -6 },
      { x: 0, z: 6 },
    );
    expect(around.status).toBe('REACHED');
    expect(around.points.some((p) => p.x > 5)).toBe(true);
  });

  it('a static, flat bridge over a hazard is walkable; a moving platform is not', () => {
    const river = { id: 'river', minX: -10, maxX: 10, minZ: -1, maxZ: 1 };
    const bridge = {
      id: 'bridge',
      min: { x: -1, y: 0, z: -1.5 },
      max: { x: 1, y: 0.1, z: 1.5 },
      fixed: true,
    };
    const open = buildWalkGrid({
      bounds: YARD,
      colliders: [],
      hazards: [river],
      platforms: [bridge],
    });
    expect(findWalkPath(open, { x: 0, z: -6 }, { x: 0, z: 6 }).status).toBe('REACHED');
    const moving = buildWalkGrid({
      bounds: YARD,
      colliders: [],
      hazards: [river],
      platforms: [{ ...bridge, fixed: false }],
    });
    expect(findWalkPath(moving, { x: 0, z: -6 }, { x: 0, z: 6 }).status).toBe('NEAREST');
    // A raised platform (top above a step) is never a path either.
    const tall = buildWalkGrid({
      bounds: YARD,
      colliders: [],
      hazards: [river],
      platforms: [{ ...bridge, max: { x: 1, y: 0.8, z: 1.5 }, fixed: true }],
    });
    expect(findWalkPath(tall, { x: 0, z: -6 }, { x: 0, z: 6 }).status).toBe('NEAREST');
  });

  it('sends a tap on an unreachable spot to the nearest reachable one', () => {
    // A walled-off room in the middle: tapping inside it ends at its outside face.
    const room = [
      box('n', -2, 2, 2, 2.4),
      box('s', -2, -2.4, 2, -2),
      box('e', 2, -2.4, 2.4, 2.4),
      box('w', -2.4, -2.4, -2, 2.4),
    ];
    const grid = buildWalkGrid({ bounds: YARD, colliders: room });
    const path = findWalkPath(grid, { x: -8, z: 0 }, { x: 0, z: 0 });
    expect(path.status).toBe('NEAREST');
    expect(path.goal.x).toBeLessThan(-2.4);
    expect(grid.isFreeAt(path.goal.x, path.goal.z)).toBe(true);
    // The nearest reachable cell is the closest one to the tap, not the closest to the start.
    expect(path.goalDistance).toBeLessThan(3.5);
  });

  it('an object tap walks to approach range, not onto the object', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: [box('statue', 3, -1, 5, 1)] });
    const path = findWalkPath(grid, { x: -8, z: 0 }, { x: 4, z: 0 }, { stopWithin: 2.5 });
    expect(path.status).toBe('REACHED');
    expect(path.goalDistance).toBeLessThanOrEqual(2.5 + 1e-6);
    expect(path.goal.x).toBeLessThan(3);
  });

  it('keeps a gap narrower than the agent blocked, and a doorway of 1 m open', () => {
    const wall = (gap: number) => [
      box('l', -10, -0.3, -gap / 2, 0.3),
      box('r', gap / 2, -0.3, 10, 0.3),
    ];
    const tight = buildWalkGrid({ bounds: YARD, colliders: wall(0.7) });
    expect(findWalkPath(tight, { x: 0, z: -5 }, { x: 0, z: 5 }).status).toBe('NEAREST');
    expect(
      floodReachable(tight, { x: 0, z: -5 })[
        tight.cellOf(0, 5).row * tight.cols + tight.cellOf(0, 5).col
      ],
    ).toBe(0);
    const door = buildWalkGrid({ bounds: YARD, colliders: wall(1) });
    expect(findWalkPath(door, { x: 0, z: -5 }, { x: 0, z: 5 }).status).toBe('REACHED');
    expect(door.guaranteedGap).toBeLessThanOrEqual(1.0 + 1e-6);
  });

  it('has no jump links: a jumpable crate that spans the way blocks the path', () => {
    // A 0.6 m crate row across the yard. A child could hop it; a tap path never does.
    const grid = buildWalkGrid({
      bounds: YARD,
      colliders: [box('crates', -10, -0.5, 10, 0.5, 0.6, { kind: 'JUMPABLE' })],
    });
    const path = findWalkPath(grid, { x: 0, z: -5 }, { x: 0, z: 5 });
    expect(path.status).toBe('NEAREST');
    // Lowered under a step it is walkable, which is the controller's step rule, not a jump.
    const kerb = buildWalkGrid({
      bounds: YARD,
      colliders: [box('kerb', -10, -0.5, 10, 0.5, 0.2, { kind: 'JUMPABLE' })],
    });
    expect(findWalkPath(kerb, { x: 0, z: -5 }, { x: 0, z: 5 }).status).toBe('REACHED');
  });

  it('reports NONE when the start is walled in completely', () => {
    const grid = buildWalkGrid({ bounds: YARD, colliders: [box('all', -10, -10, 10, 10)] });
    expect(findWalkPath(grid, { x: 0, z: 0 }, { x: 5, z: 5 }).status).toBe('NONE');
  });
});

describe('reachability helper', () => {
  const input: WalkabilityInput = {
    bounds: YARD,
    colliders: [
      // A walled garden at the east side with one 1.4 m gate in its west wall.
      box('gn', 4, 3, 9, 3.4),
      box('gs', 4, -3.4, 9, -3),
      box('ge', 8.6, -3.4, 9, 3.4),
      box('gw1', 4, -3.4, 4.4, -0.7),
      box('gw2', 4, 0.7, 4.4, 3.4),
      // A sealed shed.
      box('shed', -6, -6, -3, -3),
    ],
    hazards: [{ id: 'pond', minX: -1, maxX: 1, minZ: 5, maxZ: 8 }],
    targets: [
      { id: 'bench', x: 6, z: 0, approachRange: 1.5 },
      { id: 'shed-sign', x: -4.5, z: -4.5, approachRange: 2.5 },
      { id: 'pond-lily', x: 0, z: 6.5, approachRange: 3 },
      { id: 'garden', rect: { minX: 5, maxX: 8, minZ: -2, maxZ: 2 } },
      { id: 'inside-shed', rect: { minX: -5.5, maxX: -3.5, minZ: -5.5, maxZ: -3.5 } },
    ],
  };
  const start = { x: -8, z: 0 };

  it('answers for a named target, a point and a rectangle', () => {
    expect(isReachable(input, start, { id: 'bench' }).reachable).toBe(true);
    expect(isReachable(input, start, { id: 'garden' }).reachable).toBe(true);
    expect(isReachable(input, start, { x: 0, z: -8 }).reachable).toBe(true);
    // A point in the middle of a wall is not reachable itself, and the result names the nearest spot.
    const wall = isReachable(input, start, { x: 6, z: 3.2 });
    expect(wall.reachable).toBe(false);
    expect(wall.nearest).not.toBeNull();
    expect(wall.nearestDistance).toBeGreaterThan(0);
  });

  it('an object that is walled in or on the far side of a hazard is not reachable', () => {
    // The shed sign stands inside the sealed shed's wall box but is within 2.5 m of free ground.
    expect(isReachable(input, start, { id: 'shed-sign' }).reachable).toBe(true);
    expect(isReachable(input, start, { id: 'inside-shed' }).reachable).toBe(false);
    // The pond lily floats mid-pond: within 3 m of the shore, the child stops at the hazard buffer.
    expect(isReachable(input, start, { id: 'pond-lily' }).reachable).toBe(true);
  });

  it('lists the unreachable ids, and throws for an unknown one', () => {
    expect(unreachableTargets(input, start)).toEqual(['inside-shed']);
    expect(unreachableTargets(input, start, ['bench'])).toEqual([]);
    expect(() => isReachable(input, start, { id: 'nope' })).toThrow();
  });

  it('closing the gate makes the garden unreachable', () => {
    const closed: WalkabilityInput = {
      ...input,
      colliders: [...input.colliders, box('gate', 4, -0.7, 4.4, 0.7)],
    };
    expect(isReachable(closed, start, { id: 'bench' }).reachable).toBe(false);
    expect(isReachable(closed, start, { id: 'garden' }).reachable).toBe(false);
  });
});

describe('guided steering', () => {
  const idle = { forward: 0, strafe: 0 };

  it('turns a path into the controller input in its own yaw frame', () => {
    const steering = new GuidedSteering();
    steering.start([
      { x: 0, z: 0 },
      { x: 0, z: 5 },
    ]);
    // Facing +Z (yaw 0): straight ahead.
    const ahead = steering.steer({ x: 0, z: 0 }, 0, 0.016);
    expect(ahead.source).toBe('guided');
    expect(ahead.input.forward).toBeCloseTo(1, 5);
    expect(ahead.input.strafe).toBeCloseTo(0, 5);
    expect(ahead.input.analog).toBeUndefined();
    expect(ahead.input.sprint).toBeUndefined();
    // Facing +X (yaw PI/2): the goal at +Z is to the child's right.
    const right = steering.steer({ x: 0, z: 0 }, Math.PI / 2, 0.016);
    expect(right.input.strafe).toBeCloseTo(1, 5);
    expect(right.input.forward).toBeCloseTo(0, 5);
  });

  it('arrives, emits ARRIVED once and stops pushing', () => {
    const steering = new GuidedSteering();
    steering.start([
      { x: 0, z: 0 },
      { x: 0, z: 2 },
    ]);
    expect(steering.consumeEvents().map((e) => e.type)).toEqual(['STARTED']);
    const done = steering.steer({ x: 0, z: 1.9 }, 0, 0.016);
    expect(done.input).toEqual(idle);
    expect(steering.active).toBe(false);
    expect(steering.consumeEvents().map((e) => e.type)).toEqual(['ARRIVED']);
    expect(steering.steer({ x: 0, z: 1.9 }, 0, 0.016).source).toBe('idle');
  });

  it('a joystick or key push overrides and cancels the path', () => {
    const steering = new GuidedSteering();
    steering.start([
      { x: 0, z: 0 },
      { x: 0, z: 9 },
    ]);
    steering.consumeEvents();
    const manual = { forward: 0, strafe: 0.8, analog: true };
    const result = steering.steer({ x: 0, z: 1 }, 0, 0.016, manual);
    expect(result.source).toBe('manual');
    expect(result.input).toBe(manual);
    expect(result.heading).toBeNull();
    expect(steering.active).toBe(false);
    expect(steering.consumeEvents()).toEqual([{ type: 'CANCELLED', reason: 'MANUAL' }]);
    // Letting go does not bring the path back.
    expect(steering.steer({ x: 0, z: 1 }, 0, 0.016, idle).source).toBe('idle');
  });

  it('gives up on a path it cannot make progress on', () => {
    const steering = new GuidedSteering({ stuckSeconds: 1 });
    steering.start([
      { x: 0, z: 0 },
      { x: 0, z: 9 },
    ]);
    steering.consumeEvents();
    let last = steering.steer({ x: 0, z: 1 }, 0, 0.25);
    for (let i = 0; i < 6 && steering.active; i += 1) {
      last = steering.steer({ x: 0, z: 1 }, 0, 0.25);
    }
    expect(steering.active).toBe(false);
    expect(last.input).toEqual(idle);
    expect(steering.consumeEvents()).toContainEqual({ type: 'CANCELLED', reason: 'STUCK' });
  });

  it('drives the real controller around an L-shaped wall to the goal, with no jump', () => {
    const walls = [box('arm', -0.3, -8, 0.3, 4), box('foot', -0.3, 3.7, 5, 4.3)];
    const grid = buildWalkGrid({ bounds: YARD, colliders: walls });
    const boxes = walls.map(
      (w) =>
        new Box3(new Vector3(w.min.x, w.min.y, w.min.z), new Vector3(w.max.x, w.max.y, w.max.z)),
    );
    const controller = new FirstPersonController({ colliders: boxes });
    controller.position.set(-4, 0, 0);
    const goal = { x: 3, z: 0 };
    const path = findWalkPath(grid, { x: -4, z: 0 }, goal);
    expect(path.status).toBe('REACHED');
    const steering = new GuidedSteering();
    steering.start(path.points);
    let jumped = false;
    for (let frame = 0; frame < 60 * 40 && steering.active; frame += 1) {
      const { input } = steering.steer(
        { x: controller.position.x, z: controller.position.z },
        controller.yaw,
        1 / 60,
      );
      controller.update(1 / 60, input);
      jumped = jumped || controller.consumeEvents().some((e) => e.type === 'JUMPED');
    }
    expect(steering.active).toBe(false);
    expect(jumped).toBe(false);
    expect(Math.hypot(controller.position.x - goal.x, controller.position.z - goal.z)).toBeLessThan(
      0.5,
    );
  });

  it('a joystick push mid-walk takes over the real controller at once', () => {
    const controller = new FirstPersonController({ colliders: [] });
    controller.position.set(0, 0, 0);
    const steering = new GuidedSteering();
    steering.start([
      { x: 0, z: 0 },
      { x: 0, z: 9 },
    ]);
    for (let i = 0; i < 30; i += 1) {
      controller.update(
        1 / 60,
        steering.steer(
          { x: controller.position.x, z: controller.position.z },
          controller.yaw,
          1 / 60,
        ).input,
      );
    }
    expect(controller.position.z).toBeGreaterThan(0.1);
    const manual = { forward: 0, strafe: 1, analog: true };
    for (let i = 0; i < 60; i += 1) {
      const { input, source } = steering.steer(
        { x: controller.position.x, z: controller.position.z },
        controller.yaw,
        1 / 60,
        manual,
      );
      expect(source).toBe('manual');
      controller.update(1 / 60, input);
    }
    expect(steering.active).toBe(false);
    // Strafing right at yaw 0 goes toward -X.
    expect(controller.position.x).toBeLessThan(-0.3);
  });
});

describe('assisted camera', () => {
  it('turns behind the child at a bounded rate and never overshoots', () => {
    let yaw = 0;
    for (let i = 0; i < 300; i += 1) yaw = assistedYaw(yaw, Math.PI / 2, 1 / 60);
    expect(yaw).toBeCloseTo(Math.PI / 2, 2);
    // One frame never turns more than the rate allows.
    expect(assistedYaw(0, Math.PI, 1 / 60)).toBeLessThanOrEqual(1.65 / 60 + 1e-9);
    // The short way round.
    expect(shortestAngle(0.1, -0.1 + Math.PI * 2)).toBeCloseTo(-0.2, 6);
    expect(assistedYaw(3, -3, 0.1)).toBeGreaterThan(3);
  });

  it('holds still with no heading (joystick, or standing)', () => {
    expect(assistedYaw(1.2, null, 0.016)).toBe(1.2);
  });

  it('reduced motion never sweeps: it holds, or cuts once when facing well away', () => {
    expect(assistedYaw(0, 0.5, 0.016, { reducedMotion: true })).toBe(0);
    expect(assistedYaw(0, 2.5, 0.016, { reducedMotion: true })).toBeCloseTo(2.5, 9);
  });
});

describe('guided mode by age band', () => {
  it('Sprouts get guided mode; Pathfinders and Explorers do not', () => {
    expect(isGuidedBand('SPROUT')).toBe(true);
    expect(isGuidedBand('PATHFINDER')).toBe(false);
    expect(isGuidedBand('EXPLORER')).toBe(false);
    expect(isGuidedBand('TODDLER')).toBe(false);
    expect(isGuidedBand(undefined)).toBe(false);
  });
});
