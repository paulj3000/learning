import {
  AnimationClip,
  AnimationMixer,
  type Bone,
  Box3,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type Group,
} from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonController, type MoveInput, type MovementState } from './firstPersonController';
import { rootBonesOf, withoutRootMotionFor } from './playerAnimation';
import { mixamoRig, rootMotionWalk } from './runtime/testing/rootMotionRig';
import {
  AVATAR_HIDE_DISTANCE,
  BOOM_LIFT_TRIGGER,
  colliderObstruction,
  PlayerCameraController,
  type PlayerCameraInput,
} from './playerCamera';
import { DEFAULT_PLAYER_CAMERA } from './playerPresentation';

/**
 * Defect 1 (owner gameplay test): in third-person, a child who turned to face the camera and
 * walked backwards into a wall saw the camera stop while the avatar kept walking, off camera.
 *
 * Root cause, confirmed here: `withoutRootMotion` dropped position tracks only on the model's
 * top-level nodes, but a Mixamo-style rig keeps a walk's forward travel on its hips bone
 * (`Scene > Armature > mixamorigHips`), so the body walked away from the controller's
 * position. Also, gait came from the velocity asked for, and a blocked child stopped a few
 * centimetres short of the wall, then walked into the gap the next frame (walk/idle flicker).
 */

const FRAME = 1 / 60;
const BACK: MoveInput = { forward: -1, strafe: 0 };

/** A thin wall across the world, its near face at z = `face` (the child is on the +Z side). */
function wallAtZ(face: number): Box3 {
  return new Box3(new Vector3(-50, 0, face - 0.3), new Vector3(50, 3, face));
}

function drive(
  controller: FirstPersonController,
  frames: number,
  input: MoveInput,
): { states: MovementState[]; speeds: number[] } {
  const states: MovementState[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    controller.update(FRAME, input);
    states.push(controller.movementState);
    speeds.push(controller.locomotionSpeed);
  }
  return { states, speeds };
}

describe('movement state follows the movement that really happened', () => {
  // The child faces +Z (yaw 0); the wall is 1 m behind them, so "back" walks into it.
  const cases: { label: string; yaw: number; input: MoveInput; wall: () => Box3 }[] = [
    { label: 'backwards', yaw: 0, input: BACK, wall: () => wallAtZ(-1) },
    { label: 'forwards', yaw: Math.PI, input: { forward: 1, strafe: 0 }, wall: () => wallAtZ(-1) },
    // Facing -X (yaw -PI/2), right is -Z: a sideways step walks into the wall.
    {
      label: 'sideways',
      yaw: -Math.PI / 2,
      input: { forward: 0, strafe: 1 },
      wall: () => wallAtZ(-1),
    },
    {
      label: 'running (analog, full stick)',
      yaw: 0,
      input: { forward: -1, strafe: 0, analog: true },
      wall: () => wallAtZ(-1),
    },
    {
      label: 'sprinting',
      yaw: 0,
      input: { forward: -1, strafe: 0, sprint: true },
      wall: () => wallAtZ(-1),
    },
  ];

  for (const { label, yaw, input, wall } of cases) {
    it(`walking ${label} into a wall: stops, and is IDLE from contact on (no flicker)`, () => {
      const box = wall();
      const controller = new FirstPersonController({ colliders: [box] });
      controller.yaw = yaw;
      const { states, speeds } = drive(controller, 120, input);
      const contact = states.findIndex((state, i) => i > 0 && state === 'IDLE');
      expect(contact).toBeGreaterThan(0);
      // Every frame after the first contact is idle, and nothing more is covered.
      expect(new Set(states.slice(contact))).toEqual(new Set(['IDLE']));
      expect(Math.max(...speeds.slice(contact))).toBeLessThan(0.2);
      expect(controller.gait).toBe('idle');
      // The child's body rests at the wall: their footprint touches it, not inside, not short.
      const reach = controller.collision.radius + controller.collision.skin;
      expect(controller.position.z).toBeGreaterThanOrEqual(-1 + reach - 1e-6);
      expect(controller.position.z).toBeLessThan(-1 + reach + 0.01);
    });
  }

  it('walking diagonally into a wall slides along it, and walks while sliding', () => {
    const controller = new FirstPersonController({ colliders: [wallAtZ(-1)] });
    const { states } = drive(controller, 120, { forward: -1, strafe: 1 });
    expect(controller.position.z).toBeGreaterThanOrEqual(-1);
    expect(controller.position.x).toBeLessThan(-1); // right at yaw 0 is -X
    expect(states.at(-1)).toBe('WALK');
    expect(controller.locomotionSpeed).toBeGreaterThan(1);
  });

  it('a child standing still on a moving platform is IDLE, not walking', () => {
    const controller = new FirstPersonController();
    for (let i = 0; i < 60; i += 1) {
      controller.carry(0.05, 0, 0); // 3 m/s of platform
      controller.update(FRAME, { forward: 0, strafe: 0 });
    }
    expect(controller.position.x).toBeCloseTo(3, 5);
    expect(controller.movementState).toBe('IDLE');
    expect(controller.locomotionSpeed).toBe(0);
  });

  it('still walks in the open, and still jumps and lands', () => {
    const controller = new FirstPersonController();
    drive(controller, 30, { forward: 1, strafe: 0 });
    expect(controller.movementState).toBe('WALK');
    controller.pressJump();
    const { states } = drive(controller, 90, { forward: 0, strafe: 0 });
    expect(states).toContain('JUMP_START');
    expect(states).toContain('FALLING');
    expect(states).toContain('LANDING');
    expect(states.at(-1)).toBe('IDLE');
  });

  it('a teleport stops the gait at once', () => {
    const controller = new FirstPersonController();
    drive(controller, 30, { forward: 1, strafe: 0 });
    controller.teleport(5, 5, 0);
    expect(controller.locomotionSpeed).toBe(0);
    expect(controller.gait).toBe('idle');
  });
});

function hipsWorldAt(scene: Group, hips: Bone, clip: AnimationClip, time: number): Vector3 {
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(clip).play();
  mixer.setTime(time);
  scene.updateMatrixWorld(true);
  const at = hips.getWorldPosition(new Vector3());
  mixer.stopAllAction();
  return at;
}

describe('no animation root motion, whatever the rig', () => {
  it('finds the skeleton root bone below the armature', () => {
    const { scene, hips } = mixamoRig();
    expect(rootBonesOf(scene)).toEqual([hips]);
  });

  it('reproduces the defect: unstripped, the walk carries the hips 1.5 m forward', () => {
    const { scene, hips } = mixamoRig();
    const moved = hipsWorldAt(scene, hips, rootMotionWalk(), 0.99);
    expect(moved.z).toBeGreaterThan(1.4);
  });

  it('pins the hips horizontally to their rest position through the whole cycle', () => {
    const { scene, hips } = mixamoRig();
    const [clip] = withoutRootMotionFor([rootMotionWalk()], scene);
    for (const time of [0, 0.25, 0.5, 0.75, 0.99]) {
      const at = hipsWorldAt(scene, hips, clip!, time);
      expect(Math.abs(at.x)).toBeLessThan(1e-6);
      expect(Math.abs(at.z)).toBeLessThan(1e-6);
    }
  });

  it('keeps the vertical bob and every bone rotation', () => {
    const { scene, hips } = mixamoRig();
    const [clip] = withoutRootMotionFor([rootMotionWalk()], scene);
    expect(hipsWorldAt(scene, hips, clip!, 0).y).toBeCloseTo(1, 6);
    expect(hipsWorldAt(scene, hips, clip!, 0.5).y).toBeCloseTo(1.05, 6);
    expect(clip!.tracks.map((track) => track.name)).toEqual([
      'mixamorigHips.position',
      'mixamorigSpine.quaternion',
    ]);
  });

  it('never changes the loaded clip (it belongs to the shared asset cache)', () => {
    const { scene } = mixamoRig();
    const original = rootMotionWalk();
    const before = Array.from(original.tracks[0]!.values);
    const [clip] = withoutRootMotionFor([original], scene);
    expect(clip).not.toBe(original);
    expect(Array.from(original.tracks[0]!.values)).toEqual(before);
  });

  it('pins a glTF CUBICSPLINE track too, keeping only vertical tangents', () => {
    const { scene } = mixamoRig();
    // (in-tangent, value, out-tangent) per key.
    const values = [0, 50, 0, 0, 0, -100, 0, 50, 0, 0, 50, 0, 0, 150, -100, 0, 50, 0];
    const track = new VectorKeyframeTrack('mixamorigHips.position', [0, 1], values);
    const [clip] = withoutRootMotionFor([new AnimationClip('Walk', 1, [track])], scene);
    const pinned = Array.from(clip!.tracks[0]!.values);
    // Values: horizontal (Y here) at rest 0; tangents: horizontal part gone.
    expect(pinned[4]).toBeCloseTo(0);
    expect(pinned[13]).toBeCloseTo(0);
    expect(pinned[1]).toBeCloseTo(0);
    expect(pinned[16]).toBeCloseTo(0);
  });

  it('still drops a top-level position track, and leaves an in-place clip as it was', () => {
    const { scene } = mixamoRig();
    const topLevel = new AnimationClip('Run', 1, [
      new VectorKeyframeTrack('Armature.position', [0, 1], [0, 0, 0, 0, 0, 2]),
    ]);
    expect(withoutRootMotionFor([topLevel], scene)[0]!.tracks).toHaveLength(0);
    const inPlace = new AnimationClip('Idle', 1, [
      new QuaternionKeyframeTrack('mixamorigSpine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    expect(withoutRootMotionFor([inPlace], scene)[0]).toBe(inPlace);
  });
});

describe('third-person camera when the child backs into a wall', () => {
  function input(overrides: Partial<PlayerCameraInput> = {}): PlayerCameraInput {
    return { feet: { x: 0, y: 0, z: 0 }, grounded: true, yaw: 0, pitch: -0.25, ...overrides };
  }
  // A 3 m wall 0.6 m behind the child (behind is -Z at yaw 0).
  const wall = () => new Box3(new Vector3(-5, 0, -1), new Vector3(5, 3, -0.6));

  function camera(boxes: Box3[], reducedMotion = false) {
    return new PlayerCameraController(DEFAULT_PLAYER_CAMERA, 'third-person', {
      eyeHeight: 1.6,
      reducedMotion,
      obstruction: colliderObstruction(boxes),
    });
  }

  it('is pulled in at once, then lifts over the wall and keeps the child in view', () => {
    const boxes = [wall()];
    const cam = camera(boxes);
    const first = cam.update(FRAME, input());
    expect(first.distance).toBeLessThan(BOOM_LIFT_TRIGGER);
    const firstHeight = first.position.y; // the frame's vector is reused
    let frame = first;
    for (let i = 0; i < 180; i += 1) {
      frame = cam.update(FRAME, input());
      // Never inside the wall on any frame of the lift.
      expect(boxes[0]!.containsPoint(frame.position)).toBe(false);
    }
    expect(frame.avatarVisible).toBe(true);
    expect(frame.distance).toBeGreaterThan(AVATAR_HIDE_DISTANCE);
    expect(frame.pitch).toBeLessThan(-0.25); // looking down over the child
    // Raised up the wall's face, on the child's side of it.
    expect(frame.position.y).toBeGreaterThan(firstHeight + 0.5);
    expect(frame.position.z).toBeGreaterThan(-0.6);
  });

  it('eases rather than swings: the first lifted frame moves only a little', () => {
    const cam = camera([wall()]);
    const a = cam.update(FRAME, input());
    const b = cam.update(FRAME, input());
    expect(Math.abs(b.pitch - a.pitch)).toBeLessThan(0.05);
  });

  it('lifts more slowly under reduced motion', () => {
    const normal = camera([wall()]);
    const reduced = camera([wall()], true);
    let n = normal.update(FRAME, input());
    let r = reduced.update(FRAME, input());
    for (let i = 0; i < 20; i += 1) {
      n = normal.update(FRAME, input());
      r = reduced.update(FRAME, input());
    }
    expect(r.pitch).toBeGreaterThan(n.pitch);
  });

  it('settles back to the child’s own pitch once the way is clear', () => {
    const boxes = [wall()];
    const cam = camera(boxes);
    for (let i = 0; i < 120; i += 1) cam.update(FRAME, input());
    boxes.length = 0;
    let frame = cam.update(FRAME, input());
    for (let i = 0; i < 300; i += 1) frame = cam.update(FRAME, input());
    expect(frame.pitch).toBeCloseTo(-0.25, 3);
    expect(frame.distance).toBeCloseTo(DEFAULT_PLAYER_CAMERA.distance, 2);
  });

  it('follows the player and never moves them', () => {
    const cam = camera([wall()]);
    const feet = { x: 0.2, y: 0, z: 0.1 };
    for (let i = 0; i < 60; i += 1) cam.update(FRAME, input({ feet }));
    expect(feet).toEqual({ x: 0.2, y: 0, z: 0.1 });
    const frame = cam.update(FRAME, input({ feet }));
    expect(frame.aimOrigin.x).toBeCloseTo(0.2);
    expect(frame.aimOrigin.z).toBeCloseTo(0.1);
  });
});
