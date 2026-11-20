import { describe, expect, it } from 'vitest';
import type { FirstPersonController } from '@lai/game-engine/movement';
import { createEngineBridgeExtension } from '../../../game-engine/bridge/engineBridge';
import type { JsonValue, ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { mount, standAt, type Harness } from './testing/engineHarness';

/**
 * GE-066 (Storykeeper request): an Area whose course checkpoints live on the engine bridge
 * (`scene.engineBridge` gameplay.checkpoints) must send a fall below the ground (the live
 * controller's own recovery) to the same checkpoint a bridge hazard would, and name it.
 */

function clearSpot(controller: FirstPersonController): { x: number; z: number } {
  for (let x = -9; x <= 9; x += 1) {
    for (let z = -7; z <= 7; z += 1) {
      if (controller.canStandAt(x, z) && controller.canStandAt(x + 3, z)) return { x, z };
    }
  }
  throw new Error('no clear spot in the test location');
}

async function withBridge(checkpoint: (spot: { x: number; z: number }) => { readonly [key: string]: JsonValue } | null): Promise<{
  harness: Harness;
  controller: FirstPersonController;
  spot: { x: number; z: number };
}> {
  // A first mount just to find standable ground in the harbour.
  const probe = mount({ manifest: WELCOME_HARBOR_MANIFEST });
  await probe.engine.ready;
  let probeController: FirstPersonController | null = null;
  probe.setDrive((c) => {
    probeController = c;
  });
  probe.runFrames(1);
  const spot = clearSpot(probeController!);
  probe.engine.dispose();

  const point = checkpoint(spot);
  const manifest: ThreeLocationManifest = {
    ...WELCOME_HARBOR_MANIFEST,
    extensions: [
      ...WELCOME_HARBOR_MANIFEST.extensions,
      {
        extensionId: 'engineBridge',
        config: point ? { capabilities: [{ id: 'gameplay.checkpoints', config: { checkpoints: [point] } }] } : { capabilities: [] },
      },
    ],
  };
  const harness = mount({ manifest, extensions: [createEngineBridgeExtension()] });
  await harness.engine.ready;
  let controller: FirstPersonController | null = null;
  harness.setDrive((c) => {
    controller = c;
  });
  harness.runFrames(1);
  return { harness, controller: controller!, spot };
}

function fallOutOfTheWorld(harness: Harness, controller: FirstPersonController, at: { x: number; z: number }): void {
  harness.setDrive(() => {
    controller.position.set(at.x, -50, at.z);
  });
  harness.runFrames(1);
  // Physics runs (the drive replaces the harness's update): the controller notices it is lost.
  harness.setDrive((c, delta) => c.update(delta, { forward: 0, strafe: 0 }));
  harness.runFrames(3);
}

describe('live fall recovery with bridge checkpoints', () => {
  it('returns a fallen child to the latest bridge checkpoint and names it', async () => {
    const { harness, controller, spot } = await withBridge((s) => ({
      id: 'cp.harbour',
      courseId: 'course.test',
      position: { x: s.x, y: 0, z: s.z },
      label: 'the harbour steps',
      halfSize: 1,
    }));
    harness.setDrive(standAt(spot.x, spot.z, 0));
    harness.runFrames(2);
    harness.setDrive((c, delta) => c.update(delta, { forward: 0, strafe: 0 }));
    harness.runFrames(6); // the bridge reaches its checkpoint from the host's player state
    expect(harness.events.some((e) => e.name === 'CourseCheckpointReached')).toBe(true);

    fallOutOfTheWorld(harness, controller, { x: spot.x + 3, z: spot.z });
    expect(controller.position.x).toBeCloseTo(spot.x, 5);
    expect(controller.position.z).toBeCloseTo(spot.z, 5);
    const recovered = harness.events.filter((e) => e.name === 'PlayerRecovered').map((e) => e.detail);
    expect(recovered.at(-1)).toMatchObject({ reason: 'FELL_OUT_OF_WORLD', checkpointId: 'cp.harbour' });
    harness.engine.dispose();
  });

  it('with no checkpoint reached, falls back to the last safe ground and names no checkpoint', async () => {
    const { harness, controller, spot } = await withBridge(() => null);
    harness.setDrive(standAt(spot.x, spot.z, 0));
    harness.runFrames(2);
    harness.setDrive((c, delta) => c.update(delta, { forward: 0, strafe: 0 }));
    harness.runFrames(6); // stands on safe ground, which the controller remembers
    fallOutOfTheWorld(harness, controller, { x: spot.x + 3, z: spot.z });
    expect(controller.position.y).toBeGreaterThan(-1);
    const recovered = harness.events.filter((e) => e.name === 'PlayerRecovered').map((e) => e.detail);
    expect(recovered.at(-1)).toMatchObject({ reason: 'FELL_OUT_OF_WORLD' });
    expect((recovered.at(-1) as { checkpointId?: unknown }).checkpointId ?? null).toBeNull();
    harness.engine.dispose();
  });
});
