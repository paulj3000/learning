import { afterEach, describe, expect, it, vi } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, piratesLeapSceneJson } from '../../../../../test/playFixtures';
import {
  publishRegionCheckpoints,
  unpublishRegionCheckpoints,
} from '../../../../discovery/checkpoints';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { SOURCE_MANIFEST_REGISTRIES } from '../../runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../../runtime/validateLocationManifest';
import { mount, named, standingBox, type Drive, type Harness } from '../../runtime/testing/engineHarness';
import type { CameraMode } from '../../playerPresentation';
import { regionPlaySceneExtension } from './regionPlayScene';

/**
 * Treasure Cove: Pirate's Leap (LAI-JMP-03) on the real runtime: the course the Django seed
 * writes, the manifest builder, the region-play extension and the engine harness. Walks the
 * adventure the way a child would: lift, ferry, riddle bridge, a missed jump and the goal.
 */

const REGION = 'treasure-rush-cove';
const WEST = -Math.PI / 2; // forward is (sin yaw, cos yaw): -X
const NORTH = 0;

async function buildCove(platformTuning?: Record<string, unknown>) {
  const region = { ...bootstrapJson().region, scene: await piratesLeapSceneJson(platformTuning) };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  return built;
}

async function cove(options: { cameraMode?: CameraMode; platformTuning?: Record<string, unknown> } = {}) {
  const built = await buildCove(options.platformTuning);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension],
    loadModel: async () => standingBox(),
    ...(options.cameraMode ? { cameraMode: options.cameraMode } : {}),
  });
  await harness.engine.ready;
  return harness;
}

const place =
  (x: number, y: number, z: number, yaw = NORTH): Drive =>
  (controller) => {
    controller.position.set(x, y, z);
    controller.yaw = yaw;
  };
const idle: Drive = (controller, delta) => controller.update(delta, { forward: 0, strafe: 0 });
const go =
  (yaw: number, extra: { sprint?: boolean } = {}): Drive =>
  (controller, delta) => {
    controller.yaw = yaw;
    controller.update(delta, { forward: 1, strafe: 0, ...extra });
  };
const platform = (h: Harness, id: string) => h.engine.platforms().find((p) => p.spec.id === id)!;

afterEach(() => {
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

describe("Treasure Cove: Pirate's Leap on the engine", () => {
  it('builds a valid manifest with the course, its section zones and the cove intact', async () => {
    const built = await buildCove();
    expect(validateLocationManifest(built.manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
    expect(built.manifest.platforming?.platforms.length).toBeGreaterThanOrEqual(15);
    const zones = built.manifest.zones.map((zone) => zone.rect.id);
    expect(zones).toEqual(expect.arrayContaining(['cove-zone-landing', 'leap-zone-learn', 'leap-zone-lift', 'leap-zone-nest']));
  });

  it('Pip narrates each section as the child walks in', async () => {
    const h = await cove();
    for (const [x, z] of [[-17, -18], [-24, -20.8], [-29, -21.4], [-24, -31.4], [-19, -29]] as const) {
      h.setDrive(place(x, 0, z));
      h.runFrames(1);
    }
    const entered = named(h.events, 'PlayerEnteredZone').map((d) => (d as { zoneId: string }).zoneId);
    expect(entered).toEqual(expect.arrayContaining(['leap-zone-learn', 'leap-zone-barrels', 'leap-zone-logs', 'leap-zone-dock', 'leap-zone-lift']));
  });

  it('the Pirate Lift: a plate wakes it, the child steps on and rides up to the ledge and the nest', async () => {
    const h = await cove();
    expect(platform(h, 'leap-lift').active).toBe(false);
    h.setDrive(place(-20.6, 0, -30));
    h.runFrames(2);
    expect(platform(h, 'leap-lift').active).toBe(true);
    // Step onto the lift from the ground (its top is a 0.2 m step, no jump) and ride.
    h.setDrive(place(-18, 0, -30.2, NORTH));
    h.runFrames(1);
    h.setDrive(go(NORTH));
    h.runFrames(40);
    h.setDrive(idle);
    h.runFrames(20);
    expect(h.engine.childPlacement().z).toBeGreaterThan(-29.2);
    // Up at the top (the lift waits there for 3 s): walk north onto the ledge and the nest.
    const lift = platform(h, 'leap-lift');
    for (let i = 0; i < 600 && lift.position.y < 2.99; i += 1) h.runFrames(1);
    expect(lift.position.y).toBeGreaterThan(2.99);
    h.setDrive(go(NORTH));
    h.runFrames(90);
    expect(named(h.events, 'PlatformGoalReached')).toContainEqual({ goalId: 'leap-goal-nest' });
  });

  it('the Moving Dock carries the child across the water to the far dock', async () => {
    const h = await cove();
    const dock = platform(h, 'leap-moving-dock');
    h.setDrive(place(dock.position.x, 0.2, dock.position.z));
    h.runFrames(1);
    h.setDrive(idle);
    h.runFrames(60 * 7);
    expect(h.engine.childPlacement().x).toBeGreaterThan(-23.5);
    expect(named(h.events, 'PlayerRecovered')).toEqual([]); // never dropped in the water
  });

  it('a missed jump at Barrel Crossing goes back to the training yard, with no loss', async () => {
    const h = await cove();
    h.setDrive(place(-15.8, 0, -18));
    h.runFrames(2);
    expect(named(h.events, 'CourseCheckpointReached')).toContainEqual({ checkpointId: 'leap-cp-yard', label: 'the training yard' });
    h.setDrive(place(-24.4, 0, -20));
    h.runFrames(1);
    h.setDrive(idle);
    h.runFrames(2);
    expect(named(h.events, 'PlayerRecovered')).toContainEqual({ reason: 'HAZARD', checkpointId: 'leap-cp-yard' });
    expect(h.engine.childPlacement().x).toBeCloseTo(-15.8);
  });

  it('a running jump crosses from barrel to barrel', async () => {
    const h = await cove();
    const first = platform(h, 'leap-barrel-1');
    h.setDrive(place(first.position.x + 0.4, 0.9, first.position.z, WEST));
    h.runFrames(1);
    h.setDrive(go(WEST, { sprint: true }));
    h.runFrames(6);
    h.engine.pressJump();
    h.runFrames(60);
    h.setDrive(idle);
    h.runFrames(30);
    expect(h.engine.childPlacement().x).toBeLessThan(first.position.x - 1);
    expect(named(h.events, 'PlayerRecovered')).toEqual([]);
  });

  it("solving Pip's riddle raises the secret bridge at once (a recorded world change)", async () => {
    const h = await cove();
    const bridge = platform(h, 'leap-secret-bridge');
    expect(bridge.present).toBe(false);
    h.engine.signalPlatforms('world:PIRATES_LEAP_RIDDLE_SOLVED');
    h.runFrames(2);
    expect(bridge.present).toBe(true);
    // Walkable: the child crosses the pool on it without jumping.
    h.setDrive(place(-21.4, 0, -17.9, WEST));
    h.runFrames(1);
    h.setDrive(go(WEST));
    h.runFrames(120);
    expect(h.engine.childPlacement().x).toBeLessThan(-27.6);
    expect(named(h.events, 'PlayerRecovered')).toEqual([]);
  });

  it('honours staff tuning from the Area revision (a slower ferry)', async () => {
    const fast = await cove();
    const slow = await cove({ platformTuning: { 'leap-moving-dock': { speed: 0.4 } } });
    fast.runFrames(60);
    slow.runFrames(60);
    expect(platform(slow, 'leap-moving-dock').position.x).toBeLessThan(platform(fast, 'leap-moving-dock').position.x);
    fast.engine.dispose();
    slow.engine.dispose();
  });

  it('plays in third-person too, and leaves the rest of the cove as it was', async () => {
    const h = await cove({ cameraMode: 'third-person' });
    expect(h.engine.cameraMode()).toBe('third-person');
    h.setDrive(place(-20.6, 0, -30));
    h.runFrames(3);
    expect(platform(h, 'leap-lift').active).toBe(true);
    // The landing walk into the ruins still works (the cove's own path).
    h.setDrive(place(0, 0, 2, Math.PI));
    h.runFrames(1);
    h.setDrive(go(Math.PI));
    h.runFrames(400);
    expect(h.engine.childPlacement().z).toBeLessThan(-20);
  });
});
