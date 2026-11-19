import { afterEach, describe, expect, it, vi } from 'vitest';
import { EYE_HEIGHT } from '../sceneKit';
import {
  FACE_NORTH,
  mount,
  named,
  standAt,
  type Drive,
  type Harness,
} from './testing/engineHarness';
import { PIRATE_BUILDER_BAY_MANIFEST } from './manifests/pirateBuilderBay';
import { STORYKEEPER_CASTLE_MANIFEST } from './manifests/storykeeperCastle';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { DEFAULT_JUMP_CONFIGURATION } from '../jumpConfiguration';

/**
 * LAI-JMP-01 through the shared location runtime: the same controller, camera
 * and events every manifest-driven location uses.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

function walkNorth(): Drive {
  return (controller, delta) => {
    controller.yaw = FACE_NORTH;
    controller.update(delta, { forward: 1, strafe: 0 });
  };
}

function idle(): Drive {
  return (controller, delta) => controller.update(delta, { forward: 0, strafe: 0 });
}

/** Frames until the player is back on the ground, at most `limit`. */
function untilGrounded(h: Harness, controllerGrounded: () => boolean, limit = 200) {
  for (let i = 0; i < limit; i += 1) {
    h.runFrames(1);
    if (controllerGrounded()) return;
  }
  throw new Error('never landed');
}

describe('jumping in the shared location runtime (LAI-JMP-01)', () => {
  it('is on by default in a location that says nothing about movement', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    expect(harness.engine.jump).toEqual(DEFAULT_JUMP_CONFIGURATION);
  });

  it('jumps on a press, lifts the camera, and reports jumped then landed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.setDrive(idle());
    harness.runFrames(2);
    const groundEye = harness.camera().position.y;
    expect(groundEye).toBeCloseTo(EYE_HEIGHT);

    harness.engine.pressJump();
    harness.runFrames(10);
    expect(harness.camera().position.y).toBeGreaterThan(groundEye + 0.5);
    expect(named(harness.events, 'PlayerJumped')).toEqual([{ airJump: false }]);

    harness.runFrames(60);
    expect(harness.camera().position.y).toBeCloseTo(groundEye, 2);
    const landed = named(harness.events, 'PlayerLanded') as { impactSpeed: number }[];
    expect(landed).toHaveLength(1);
    expect(landed[0].impactSpeed).toBeGreaterThan(5);
  });

  it('does nothing on a press where the location turns jumping off', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({
      manifest: { ...WELCOME_HARBOR_MANIFEST, movement: { jump: { enabled: false } } },
    });
    harness.setDrive(idle());
    expect(harness.engine.jump.enabled).toBe(false);
    harness.engine.pressJump();
    harness.runFrames(10);
    expect(harness.camera().position.y).toBeCloseTo(EYE_HEIGHT);
    expect(named(harness.events, 'PlayerJumped')).toEqual([]);
  });

  it('uses Storykeeper Castle’s lower indoor jump', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: STORYKEEPER_CASTLE_MANIFEST });
    expect(harness.engine.jump.jumpHeight).toBe(0.9);
    expect(harness.engine.jump.enabled).toBe(true);
  });

  it('lets the child hop onto Pirate Builder Bay’s low crates, which block walking', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: PIRATE_BUILDER_BAY_MANIFEST });
    let grounded = true;
    let feetY = 0;
    let z = 0;
    const observe =
      (drive: Drive): Drive =>
      (controller, delta) => {
        drive(controller, delta);
        grounded = controller.grounded;
        feetY = controller.position.y;
        z = controller.position.z;
      };

    // South of the crate pair (z -5.1 to -4.2), walking north into it.
    harness.setDrive(standAt(-6.2, -6.5, FACE_NORTH));
    harness.runFrames(1);
    harness.setDrive(observe(walkNorth()));
    harness.runFrames(90);
    expect(z).toBeLessThan(-5.1);
    expect(feetY).toBe(0);

    // Jump while walking, then steer back in the air to stay over the crates.
    harness.setDrive(
      observe((controller, delta) => {
        controller.yaw = FACE_NORTH;
        const forward = controller.position.z < -4.9 ? 1 : controller.position.z > -4.5 ? -1 : 0;
        controller.update(delta, { forward, strafe: 0 });
      }),
    );
    harness.engine.pressJump();
    harness.runFrames(3);
    untilGrounded(harness, () => grounded);
    expect(feetY).toBeCloseTo(0.8, 5);
    harness.setDrive(observe(idle()));
    harness.runFrames(30);
    expect(harness.camera().position.y).toBeCloseTo(EYE_HEIGHT + 0.8, 2);
  });

  it('never jumps the bridge gap: the broken bridge stays solid at every height', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: PIRATE_BUILDER_BAY_MANIFEST });
    const gap = PIRATE_BUILDER_BAY_MANIFEST.colliders.find((collider) => collider.requirements);
    expect(gap).toBeDefined();
    expect(gap?.jumpable).toBeUndefined();
    const gated = PIRATE_BUILDER_BAY_MANIFEST.colliders.filter((c) => c.jumpable);
    expect(gated.every((collider) => collider.requirements === undefined)).toBe(true);
  });

  it('resetInput forwards to the input layer', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.engine.resetInput();
    expect(harness.controls.resetInput).toHaveBeenCalledTimes(1);
  });

  it('ignores a press after disposal', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.engine.dispose();
    expect(() => harness?.engine.pressJump()).not.toThrow();
  });
});
