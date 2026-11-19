import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController, type MoveInput } from './firstPersonController';
import { validateMovementSpec } from './jumpConfiguration';
import {
  DEFAULT_PLAYER_COLLISION,
  footprintDistance,
  PLAYER_COLLISION_LIMITS,
  resolvePlayerCollision,
  validatePlayerCollision,
} from './playerCollision';

/**
 * Defect 2 (owner gameplay test): the child could walk part-way into Storykeeper Castle's
 * walls. Root cause: the shared controller tested one point (the feet) against every
 * collider, so the visible body (0.27 m capsule radius for the placeholder, wider for most
 * published characters) went half into any wall it touched.
 */

const FRAME = 1 / 60;
const REACH = DEFAULT_PLAYER_COLLISION.radius + DEFAULT_PLAYER_COLLISION.skin;

function walkFor(
  controller: FirstPersonController,
  seconds: number,
  input: MoveInput,
  frame = FRAME,
) {
  for (let t = 0; t < seconds; t += frame) controller.update(frame, input);
}

/** Smallest horizontal gap from the child's feet to any solid box at ground level. */
function clearance(controller: FirstPersonController, boxes: Box3[]): number {
  return Math.min(
    ...boxes.map((box) => footprintDistance(box, controller.position.x, controller.position.z)),
  );
}

describe('player collision footprint configuration', () => {
  it('defaults to a 0.35 m radius and a 2 cm skin', () => {
    expect(DEFAULT_PLAYER_COLLISION).toEqual({ radius: 0.35, skin: 0.02 });
    expect(new FirstPersonController().collision).toEqual({ radius: 0.35, skin: 0.02 });
  });

  it('takes a location override, clamped to its range', () => {
    expect(resolvePlayerCollision({ radius: 0.42 }).radius).toBe(0.42);
    expect(resolvePlayerCollision({ radius: 5 }).radius).toBe(PLAYER_COLLISION_LIMITS.radius.max);
    expect(resolvePlayerCollision({ skin: -1 }).skin).toBe(0);
    expect(resolvePlayerCollision({ radius: Number.NaN }).radius).toBe(0.35);
  });

  it('validates an authored movement.collision block', () => {
    expect(validateMovementSpec({ collision: { radius: 0.4 } })).toEqual([]);
    expect(validatePlayerCollision({ radius: 2, colour: 1 })).toEqual([
      { path: 'movement.collision.radius', message: 'must be between 0.15 and 0.6' },
      { path: 'movement.collision.colour', message: 'is not a collision setting' },
    ]);
    expect(validateMovementSpec({ collision: 'wide' })).toEqual([
      { path: 'movement.collision', message: 'must be an object' },
    ]);
  });
});

describe('the footprint against walls', () => {
  // A 10 x 10 m room of 0.25 m thick walls around the origin.
  const room = () => [
    new Box3(new Vector3(-5, 0, 5), new Vector3(5, 3, 5.25)), // north (+Z)
    new Box3(new Vector3(-5, 0, -5.25), new Vector3(5, 3, -5)), // south
    new Box3(new Vector3(5, 0, -5), new Vector3(5.25, 3, 5)), // west (+X)
    new Box3(new Vector3(-5.25, 0, -5), new Vector3(-5, 3, 5)), // east
  ];

  for (const [label, yaw] of [
    ['north', 0],
    ['south', Math.PI],
    ['west', Math.PI / 2],
    ['east', -Math.PI / 2],
  ] as const) {
    it(`stops the body ${REACH} m from the ${label} wall, walking forwards, backwards and running`, () => {
      for (const input of [
        { forward: 1, strafe: 0 },
        { forward: 1, strafe: 0, analog: true },
        { forward: 1, strafe: 0, sprint: true },
      ]) {
        const boxes = room();
        const controller = new FirstPersonController({ colliders: boxes });
        controller.yaw = yaw;
        walkFor(controller, 3, input);
        expect(clearance(controller, boxes)).toBeGreaterThanOrEqual(REACH - 1e-6);
        expect(clearance(controller, boxes)).toBeLessThan(REACH + 0.01);
      }
    });
  }

  it('slides along a wall and stops in a corner with clearance from both walls', () => {
    const boxes = room();
    const controller = new FirstPersonController({ colliders: boxes });
    walkFor(controller, 6, { forward: 1, strafe: -1 }); // north-west: into the north wall, sliding west
    expect(controller.position.z).toBeCloseTo(5 - REACH, 2);
    expect(controller.position.x).toBeCloseTo(5 - REACH, 2);
    expect(controller.movementState).toBe('IDLE');
  });

  it('rounds an outside corner instead of catching on it', () => {
    // A pillar; the child walks north just west of its west face, close enough to touch it.
    const pillar = new Box3(new Vector3(-1, 0, 2), new Vector3(1, 3, 3));
    const controller = new FirstPersonController({ colliders: [pillar] });
    controller.position.set(1 + REACH + 0.05, 0, 0);
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeGreaterThan(4);
  });

  it('cannot tunnel through a thin wall at sprint speed on a slow frame', () => {
    const wall = new Box3(new Vector3(-5, 0, 3), new Vector3(5, 3, 3.05));
    const controller = new FirstPersonController({ colliders: [wall] });
    walkFor(controller, 3, { forward: 1, strafe: 0, sprint: true }, 0.25);
    expect(controller.position.z).toBeLessThan(3 - REACH + 1e-6);
  });

  it('never changes the shared collider boxes', () => {
    const wall = new Box3(new Vector3(-5, 0, 3), new Vector3(5, 3, 3.25));
    const before = wall.clone();
    const controller = new FirstPersonController({ colliders: [wall] });
    walkFor(controller, 2, { forward: 1, strafe: 0.3 });
    expect(wall.equals(before)).toBe(true);
  });

  it('a child placed overlapping a wall can step away from it, never further in', () => {
    const wall = new Box3(new Vector3(-5, 0, 1), new Vector3(5, 3, 1.25));
    const controller = new FirstPersonController({ colliders: [wall] });
    controller.position.set(0, 0, 1 - 0.1); // 0.1 m from the face: inside the footprint
    expect(controller.canStandAt(0, 0.9)).toBe(false);
    walkFor(controller, 0.2, { forward: 1, strafe: 0 }); // into it
    expect(controller.position.z).toBeLessThanOrEqual(0.9 + 1e-9);
    walkFor(controller, 0.5, { forward: -1, strafe: 0 }); // away from it
    expect(controller.position.z).toBeLessThan(1 - REACH);
  });

  it('uses a larger configured radius consistently', () => {
    const wall = new Box3(new Vector3(-5, 0, 3), new Vector3(5, 3, 3.25));
    const controller = new FirstPersonController({
      colliders: [wall],
      collision: { radius: 0.45 },
    });
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeCloseTo(3 - 0.47, 3);
  });
});

describe('doorways', () => {
  /** A wall across z = 3 with a doorway `width` wide centred on x = 0. */
  function wallWithDoor(width: number): Box3[] {
    return [
      new Box3(new Vector3(-10, 0, 3), new Vector3(-width / 2, 3, 3.25)),
      new Box3(new Vector3(width / 2, 0, 3), new Vector3(10, 3, 3.25)),
    ];
  }

  it('walks straight through a 1 m doorway (the castle’s are 2 m)', () => {
    const controller = new FirstPersonController({ colliders: wallWithDoor(1) });
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeGreaterThan(5);
  });

  it('slides into a doorway when approaching a little off-centre', () => {
    const controller = new FirstPersonController({ colliders: wallWithDoor(1.2) });
    controller.position.x = 0.2;
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeGreaterThan(5);
  });

  it('a gap narrower than the body is not a doorway', () => {
    const controller = new FirstPersonController({ colliders: wallWithDoor(0.5) });
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeLessThan(3);
  });
});

describe('jumpable obstacles keep their real height', () => {
  const crate = () => new Box3(new Vector3(-0.5, 0, 2), new Vector3(0.5, 0.5, 3));

  it('a crate blocks the body at its edge, not its centre', () => {
    const box = crate();
    const controller = new FirstPersonController({
      colliders: [box],
      jumpableColliders: new Set([box]),
    });
    walkFor(controller, 2, { forward: 1, strafe: 0 });
    expect(controller.position.z).toBeCloseTo(2 - REACH, 2);
  });

  it('the child can still jump onto it from right beside it, and stands exactly on its top', () => {
    // A deeper crate, so a running jump lands on it rather than clean over it.
    const box = new Box3(new Vector3(-0.5, 0, 2), new Vector3(0.5, 0.5, 4));
    const controller = new FirstPersonController({
      colliders: [box],
      jumpableColliders: new Set([box]),
    });
    walkFor(controller, 1, { forward: 1, strafe: 0 });
    controller.pressJump();
    walkFor(controller, 0.3, { forward: 1, strafe: 0 });
    walkFor(controller, 1, { forward: 0, strafe: 0 });
    expect(controller.position.y).toBeCloseTo(0.5, 6); // not raised by the footprint
    expect(controller.supportingBox()).toBe(box);
  });

  it('jumps over a log, and walks up a low step without jumping', () => {
    const log = new Box3(new Vector3(-2, 0, 2), new Vector3(2, 0.4, 2.4));
    const over = new FirstPersonController({ colliders: [log], jumpableColliders: new Set([log]) });
    walkFor(over, 0.15, { forward: 1, strafe: 0 });
    over.pressJump();
    walkFor(over, 1.5, { forward: 1, strafe: 0 });
    expect(over.position.z).toBeGreaterThan(3);

    const step = new Box3(new Vector3(-2, 0, 2), new Vector3(2, 0.2, 6));
    const up = new FirstPersonController({ colliders: [step], jumpableColliders: new Set([step]) });
    walkFor(up, 1.5, { forward: 1, strafe: 0 });
    expect(up.position.z).toBeGreaterThan(3);
    expect(up.position.y).toBeCloseTo(0.2, 6);
  });
});
