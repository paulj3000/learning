import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_COLLISION_STEP, type MoveInput } from '../firstPersonController';
import { DEFAULT_LOCOMOTION } from '../locomotionConfiguration';
import { coveSceneJson } from '../../../../test/playFixtures';
import { readRegionLayout } from '../../../region-play/regionLayout';
import type { JsonValue } from '../../../../api/parse';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { PIRATE_BUILDER_BAY_MANIFEST } from './manifests/pirateBuilderBay';
import { STORYKEEPER_CASTLE_MANIFEST } from './manifests/storykeeperCastle';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { solidColliders } from './sceneLayout';
import {
  FACE_NORTH,
  mount,
  named,
  standAt,
  type Drive,
  type Harness,
} from './testing/engineHarness';

/** Running & sprinting through the shared location runtime. */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

function quiet() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

const moving =
  (input: MoveInput, yaw = FACE_NORTH): Drive =>
  (controller, delta) => {
    controller.yaw = yaw;
    controller.update(delta, input);
  };

describe('running & sprinting in the shared location runtime', () => {
  it('gives every outdoor location the default speeds, and the castle its gentler indoor ones', () => {
    quiet();
    for (const manifest of [WELCOME_HARBOR_MANIFEST, PIRATE_BUILDER_BAY_MANIFEST]) {
      const h = mount({ manifest });
      expect(h.engine.locomotion).toEqual(DEFAULT_LOCOMOTION);
      h.engine.dispose();
    }
    harness = mount({ manifest: STORYKEEPER_CASTLE_MANIFEST });
    expect(harness.engine.locomotion).toMatchObject({
      walkSpeed: 4,
      runSpeed: 4.8,
      sprintSpeed: 5.6,
    });
  });

  it('reports gait changes and footsteps for sound, faster steps when faster', () => {
    quiet();
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    const steps: string[] = [];
    harness.setDrive(standAt(0, -10, FACE_NORTH));
    harness.runFrames(1);
    const footsteps = () => named(harness!.events, 'PlayerFootstep').length;
    harness.setDrive(moving({ forward: 1, strafe: 0 }));
    harness.runFrames(60);
    const walkSteps = footsteps();
    harness.setDrive(moving({ forward: 1, strafe: 0, sprint: true }));
    harness.runFrames(60);
    const sprintSteps = footsteps() - walkSteps;
    harness.setDrive(moving({ forward: 0, strafe: 0 }));
    harness.runFrames(30);
    for (const event of named(harness.events, 'PlayerGaitChanged') as { gait: string }[]) {
      steps.push(event.gait);
    }
    expect(steps).toEqual(['walk', 'run', 'sprint', 'walk', 'idle']);
    expect(walkSteps).toBeGreaterThan(2);
    expect(sprintSteps).toBeGreaterThan(walkSteps);
  });

  it('widens the view gently while sprinting, in both perspectives, and never with reduced motion', () => {
    quiet();
    for (const cameraMode of ['first-person', 'third-person'] as const) {
      const h = mount({ manifest: WELCOME_HARBOR_MANIFEST, cameraMode });
      h.setDrive(moving({ forward: 1, strafe: 0, sprint: true }));
      h.runFrames(90);
      expect(h.camera().fov, cameraMode).toBeGreaterThan(70);
      expect(h.camera().fov, cameraMode).toBeLessThanOrEqual(73);
      h.setDrive(moving({ forward: 0, strafe: 0 }));
      h.runFrames(120);
      expect(h.camera().fov, cameraMode).toBe(70);
      h.engine.dispose();
    }
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST, reducedMotion: true, cameraMode: null });
    harness.setDrive(moving({ forward: 1, strafe: 0, sprint: true }));
    harness.runFrames(90);
    expect(harness.camera().fov).toBe(70);
  });

  it('never lets a sprinting, jumping child cross Pirate Builder Bay’s broken bridge', () => {
    quiet();
    harness = mount({ manifest: PIRATE_BUILDER_BAY_MANIFEST, cameraMode: null });
    let x = 0;
    harness.setDrive(standAt(-8, 0, Math.PI / 2));
    harness.runFrames(1);
    harness.setDrive((controller, delta) => {
      controller.yaw = Math.PI / 2;
      controller.update(delta, { forward: 1, strafe: 0, sprint: true });
      x = controller.position.x;
    });
    for (let i = 0; i < 10; i += 1) {
      harness.engine.pressJump();
      harness.runFrames(40, 100); // long frames too: 0.1 s each
    }
    expect(x).toBeGreaterThan(-8);
    expect(x).toBeLessThan(0);
  });

  it('has no authored collider thinner than one collision step, so nothing can be tunnelled through', async () => {
    const thinnest: [string, number][] = [];
    for (const manifest of SOURCE_LOCATION_MANIFESTS) {
      for (const solid of solidColliders(manifest)) {
        const { box } = solid;
        thinnest.push([
          `${manifest.regionId}:${solid.id ?? 'wall'}`,
          Math.min(box.maxX - box.minX, box.maxZ - box.minZ),
        ]);
      }
    }
    const cove = readRegionLayout((await coveSceneJson()).layout as JsonValue);
    for (const collider of cove.colliders) {
      const { rect } = collider;
      thinnest.push([
        `treasure-cove:${rect.id}`,
        Math.min(rect.maxX - rect.minX, rect.maxZ - rect.minZ),
      ]);
    }
    const tooThin = thinnest.filter(([, size]) => size <= MAX_COLLISION_STEP);
    expect(tooThin).toEqual([]);
  });
});
