import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_HIDE_DISTANCE,
  CAMERA_GROUND_CLEARANCE,
  CAMERA_RADIUS,
  colliderObstruction,
  lookDirection,
  NEAREST_CAMERA_DISTANCE,
  PlayerCameraController,
  THIRD_PERSON_MAX_PITCH,
  THIRD_PERSON_MIN_PITCH,
  type PlayerCameraInput,
} from './playerCamera';
import { DEFAULT_PLAYER_CAMERA, resolvePlayerCamera } from './playerPresentation';

const FRAME = 1 / 60;
const EYE = 1.6;

function input(overrides: Partial<PlayerCameraInput> = {}): PlayerCameraInput {
  return { feet: { x: 0, y: 0, z: 0 }, grounded: true, yaw: 0, pitch: -0.25, ...overrides };
}

function thirdPerson(boxes: Box3[] = [], config = DEFAULT_PLAYER_CAMERA, reducedMotion = false) {
  return new PlayerCameraController(config, 'third-person', {
    eyeHeight: EYE,
    reducedMotion,
    obstruction: colliderObstruction(boxes),
  });
}

function run(camera: PlayerCameraController, frames: number, frameInput = input()) {
  let frame = camera.update(FRAME, frameInput);
  for (let i = 1; i < frames; i += 1) frame = camera.update(FRAME, frameInput);
  return frame;
}

describe('PlayerCameraController (LAI-JMP-01a)', () => {
  describe('first-person', () => {
    it('is exactly the existing eye view: 1.6 m above the feet, looking where the player looks', () => {
      const camera = new PlayerCameraController(DEFAULT_PLAYER_CAMERA, 'first-person', {
        eyeHeight: EYE,
      });
      const frame = camera.update(FRAME, input({ feet: { x: 2, y: 0, z: 3 }, yaw: 1, pitch: 0.4 }));
      expect(frame.position.toArray()).toEqual([2, EYE, 3]);
      expect(frame.yaw).toBe(1);
      expect(frame.pitch).toBe(0.4);
      expect(frame.aimOrigin.toArray()).toEqual([2, EYE, 3]);
      expect(frame.avatarVisible).toBe(false);
    });
  });

  describe('third-person follow', () => {
    it('sits behind and above the player and looks at a point over their head', () => {
      const frame = thirdPerson().update(FRAME, input({ yaw: 0, pitch: -0.25 }));
      // Facing +Z, so behind is -Z.
      expect(frame.position.z).toBeCloseTo(-DEFAULT_PLAYER_CAMERA.distance * Math.cos(0.25), 5);
      expect(frame.position.y).toBeGreaterThan(DEFAULT_PLAYER_CAMERA.heightOffset);
      expect(frame.distance).toBeCloseTo(DEFAULT_PLAYER_CAMERA.distance);
      expect(frame.avatarVisible).toBe(true);
      // The camera's forward passes through the follow point.
      const forward = lookDirection(frame.yaw, frame.pitch);
      const reaches = frame.position.clone().addScaledVector(forward, frame.distance);
      expect(
        reaches.distanceTo(new Vector3(0, DEFAULT_PLAYER_CAMERA.heightOffset, 0)),
      ).toBeLessThan(1e-6);
    });

    it('follows walking smoothly, catching up rather than jumping there', () => {
      const camera = thirdPerson();
      run(camera, 2);
      const moved = input({ feet: { x: 1, y: 0, z: 0 } });
      const first = camera.update(FRAME, moved);
      expect(first.position.x).toBeGreaterThan(0);
      expect(first.position.x).toBeLessThan(1);
      expect(run(camera, 120, moved).position.x).toBeCloseTo(1, 3);
    });

    it('rises with a jump more gently than it follows sideways (no lurch)', () => {
      const camera = thirdPerson();
      run(camera, 2);
      const before = camera.update(FRAME, input()).position.y;
      const up = camera.update(FRAME, input({ feet: { x: 0, y: 1, z: 0 }, grounded: false }))
        .position.y;
      const camera2 = thirdPerson();
      run(camera2, 2);
      const sideways = camera2.update(FRAME, input({ feet: { x: 1, y: 0, z: 0 } })).position.x;
      expect(up - before).toBeGreaterThan(0);
      expect(up - before).toBeLessThan(sideways);
    });

    it('rises even more gently with reduced motion', () => {
      const usual = thirdPerson();
      const calm = thirdPerson([], DEFAULT_PLAYER_CAMERA, true);
      for (const camera of [usual, calm]) run(camera, 2);
      const jumped = input({ feet: { x: 0, y: 1, z: 0 }, grounded: false });
      expect(calm.update(FRAME, jumped).position.y).toBeLessThan(
        usual.update(FRAME, jumped).position.y,
      );
    });

    it('snaps after a teleport instead of swooping across the map', () => {
      const camera = thirdPerson();
      run(camera, 2);
      const frame = camera.update(FRAME, input({ feet: { x: 20, y: 0, z: 0 } }));
      expect(frame.position.x).toBeCloseTo(20);
    });

    it('keeps its look within the third-person range and above the ground', () => {
      const camera = thirdPerson();
      expect(camera.update(FRAME, input({ pitch: -3 })).pitch).toBe(THIRD_PERSON_MIN_PITCH);
      const low = camera.update(FRAME, input({ pitch: 3 }));
      expect(low.pitch).toBe(THIRD_PERSON_MAX_PITCH);
      expect(low.position.y).toBeGreaterThanOrEqual(CAMERA_GROUND_CLEARANCE);
    });

    it('aims interactions from the player, not from the camera behind them', () => {
      const camera = thirdPerson();
      run(camera, 2);
      const frame = camera.update(FRAME, input({ feet: { x: 3, y: 0, z: 4 } }));
      expect(frame.aimOrigin.toArray()).toEqual([3, DEFAULT_PLAYER_CAMERA.heightOffset, 4]);
      expect(frame.position.distanceTo(frame.aimOrigin)).toBeGreaterThan(0.5);
    });
  });

  describe('camera collision', () => {
    // A wall 1 m behind the player (facing +Z, so behind is -Z), 3 m tall like every wall.
    const wallBehind = () => new Box3(new Vector3(-5, -1, -1.5), new Vector3(5, 3, -1));

    it('stops in front of a wall behind the player, at once', () => {
      const frame = thirdPerson([wallBehind()]).update(FRAME, input());
      expect(frame.position.z).toBeGreaterThan(-1);
      expect(frame.distance).toBeLessThan(1.2);
    });

    it('never shows through a wall the player backs up against: pulled in on the very frame', () => {
      const camera = thirdPerson([new Box3(new Vector3(-5, -1, -6), new Vector3(5, 3, -5.5))]);
      run(camera, 60);
      // Back up to 1 m from that wall: the camera must already be in front of it.
      const frame = camera.update(FRAME, input({ feet: { x: 0, y: 0, z: -4.5 } }));
      expect(frame.position.z).toBeGreaterThan(-5.5);
    });

    it('eases back out to its distance once the way is clear', () => {
      const boxes = [wallBehind()];
      const camera = thirdPerson(boxes);
      const close = camera.update(FRAME, input()).distance;
      boxes.length = 0; // the wall goes (a door opens): the probe reads the live list
      const next = camera.update(FRAME, input()).distance;
      expect(next).toBeGreaterThan(close);
      expect(next).toBeLessThan(DEFAULT_PLAYER_CAMERA.distance);
      expect(run(camera, 240).distance).toBeCloseTo(DEFAULT_PLAYER_CAMERA.distance, 2);
    });

    it('hides the avatar when a tight corner forces the camera right against it', () => {
      const tight = new Box3(new Vector3(-5, -1, -0.6), new Vector3(5, 3, -0.4));
      const frame = thirdPerson([tight]).update(FRAME, input());
      expect(frame.distance).toBeLessThanOrEqual(NEAREST_CAMERA_DISTANCE);
      expect(frame.distance).toBeLessThan(AVATAR_HIDE_DISTANCE);
      expect(frame.avatarVisible).toBe(false);
      expect(tight.containsPoint(frame.position)).toBe(false);
    });

    it('stays out of a wall the child is standing flush against', () => {
      // The wall's face is 2 cm behind the child (collision lets them touch it).
      const flush = new Box3(new Vector3(-5, -1, -0.5), new Vector3(5, 3, -0.02));
      const frame = thirdPerson([flush]).update(FRAME, input());
      expect(flush.containsPoint(frame.position)).toBe(false);
      expect(frame.position.z).toBeGreaterThan(-0.02);
    });

    it('stays under a ceiling, even at the top of a jump', () => {
      const camera = thirdPerson([], resolvePlayerCamera({ maxHeight: 2.95, distance: 2.6 }));
      const grounded = camera.update(FRAME, input({ pitch: -1 }));
      expect(grounded.position.y).toBeLessThanOrEqual(2.8 + 1e-9);
      const jumping = run(
        camera,
        30,
        input({ feet: { x: 0, y: 0.9, z: 0 }, grounded: false, pitch: -1 }),
      );
      expect(jumping.position.y).toBeLessThanOrEqual(2.8 + 1e-9);
    });

    it('can be turned off for a location', () => {
      const frame = thirdPerson(
        [wallBehind()],
        resolvePlayerCamera({ collisionEnabled: false }),
      ).update(FRAME, input());
      expect(frame.distance).toBeCloseTo(DEFAULT_PLAYER_CAMERA.distance);
    });

    it('ignores a box the follow point is inside, and boxes beyond the camera', () => {
      const probe = colliderObstruction([
        new Box3(new Vector3(-1, 0, -1), new Vector3(1, 3, 1)), // around the player
        new Box3(new Vector3(-1, 0, -20), new Vector3(1, 3, -19)), // far behind
      ]);
      expect(probe(new Vector3(0, 1.5, 0), new Vector3(0, 0, -1), 4 + CAMERA_RADIUS)).toBeNull();
    });
  });

  describe('switching perspective', () => {
    it('switches first-person to third-person and back, starting fresh each time', () => {
      const camera = new PlayerCameraController(DEFAULT_PLAYER_CAMERA, 'first-person', {
        eyeHeight: EYE,
      });
      expect(camera.update(FRAME, input()).mode).toBe('first-person');
      camera.setMode('third-person');
      const behind = camera.update(FRAME, input({ feet: { x: 5, y: 0, z: 5 } }));
      expect(behind.mode).toBe('third-person');
      expect(behind.distance).toBeCloseTo(DEFAULT_PLAYER_CAMERA.distance);
      expect(behind.avatarVisible).toBe(true);
      camera.setMode('first-person');
      const eyes = camera.update(FRAME, input({ feet: { x: 5, y: 0, z: 5 } }));
      expect(eyes.position.toArray()).toEqual([5, EYE, 5]);
      expect(eyes.avatarVisible).toBe(false);
    });
  });
});

describe('camera while running & sprinting', () => {
  it('widens the view a little while sprinting, eased, and back again', () => {
    const camera = thirdPerson();
    const first = camera.update(FRAME, input({ sprinting: true })).fovOffset;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(DEFAULT_PLAYER_CAMERA.sprintFovBoost);
    expect(run(camera, 120, input({ sprinting: true })).fovOffset).toBe(
      DEFAULT_PLAYER_CAMERA.sprintFovBoost,
    );
    expect(run(camera, 120, input()).fovOffset).toBe(0);
  });

  it('never widens under reduced motion, or where a location turns it off', () => {
    const calm = thirdPerson([], DEFAULT_PLAYER_CAMERA, true);
    expect(run(calm, 60, input({ sprinting: true })).fovOffset).toBe(0);
    const off = thirdPerson([], resolvePlayerCamera({ sprintFovBoost: 0 }));
    expect(run(off, 60, input({ sprinting: true })).fovOffset).toBe(0);
  });

  it('tracks a sprinting child closely: the follow lag stays under a metre', () => {
    const camera = thirdPerson();
    let z = 0;
    let frame = camera.update(FRAME, input());
    for (let i = 0; i < 180; i += 1) {
      z += 6.5 * FRAME;
      frame = camera.update(FRAME, input({ feet: { x: 0, y: 0, z }, sprinting: true }));
    }
    const lag = z - (frame.position.z + frame.distance * Math.cos(0.25));
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(1);
  });

  it('still stops in front of a wall at sprinting speed', () => {
    const wall = new Box3(new Vector3(-5, -1, -1.5), new Vector3(5, 3, -1));
    const frame = thirdPerson([wall]).update(FRAME, input({ sprinting: true }));
    expect(wall.containsPoint(frame.position)).toBe(false);
    expect(frame.position.z).toBeGreaterThan(-1);
  });
});
