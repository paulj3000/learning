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
import {
  mount,
  named,
  standingBox,
  type Drive,
  type Harness,
} from '../../runtime/testing/engineHarness';
import type { CameraMode } from '@lai/game-engine/camera';
import { regionPlaySceneExtension } from './regionPlayScene';
import {
  createEngineBridgeExtension,
  ENGINE_BRIDGE_EXTENSION_ID,
  type EngineBridgeApi,
} from '../../../../game-engine/bridge/engineBridge';
import { PlatformsService } from '@lai/game-engine/components';

/**
 * Treasure Cove: Pirate's Leap (LAI-JMP-03) on the real runtime: the course the Django seed
 * writes, the manifest builder, the region-play extension and the engine harness. Walks the
 * adventure the way a child would: lift, ferry, riddle bridge, a missed jump and the goal.
 */

const REGION = 'treasure-rush-cove';
const WEST = -Math.PI / 2; // forward is (sin yaw, cos yaw): -X
const NORTH = 0;
const SOUTH = Math.PI;

async function buildCove(platformTuning?: Record<string, unknown>) {
  const region = { ...bootstrapJson().region, scene: await piratesLeapSceneJson(platformTuning) };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  return built;
}

async function cove(
  options: { cameraMode?: CameraMode; platformTuning?: Record<string, unknown> } = {},
) {
  const built = await buildCove(options.platformTuning);
  const harness = mount({
    manifest: built.manifest,
    // GE-071: the course's checkpoints, water pools, goal and jump challenges run in the engine
    // bridge, which the region manifest binds from `scene.engineBridge`, as in the app.
    extensions: [regionPlaySceneExtension, createEngineBridgeExtension()],
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
// GE-071 (course v4): the course's platforms run in the engine bridge. Its snapshot gives each
// platform's top centre (position.y is the top, not the base, as the live state was).
const bridgeApi = (h: Harness) =>
  h.engine.extensionApi(ENGINE_BRIDGE_EXTENSION_ID) as EngineBridgeApi;
const platform = (h: Harness, id: string) =>
  bridgeApi(h)
    .platforms()
    .find((p) => p.id === id)!;
const isPresent = (h: Harness, id: string) =>
  bridgeApi(h).runtime!.services.require(PlatformsService).isPresent(id);
/** The lift is awake when it is moving: its top rises within a second. */
const liftRises = (h: Harness) => {
  const before = platform(h, 'leap-lift').position.y;
  h.runFrames(60);
  return platform(h, 'leap-lift').position.y > before + 0.1;
};

afterEach(() => {
  unpublishRegionCheckpoints(REGION);
  vi.restoreAllMocks();
});

describe("Treasure Cove: Pirate's Leap on the engine", () => {
  it('builds a valid manifest with the course, its section zones and the cove intact', async () => {
    const built = await buildCove();
    expect(validateLocationManifest(built.manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
    const engineBlock = built.manifest.extensions.find(
      (b) => b.extensionId === ENGINE_BRIDGE_EXTENSION_ID,
    )!;
    const capabilities = engineBlock.config.capabilities as {
      id: string;
      config: { platforms?: unknown[] };
    }[];
    expect(
      capabilities.find((c) => c.id === 'gameplay.platforms')!.config.platforms!.length,
    ).toBeGreaterThanOrEqual(15);
    expect(built.manifest.platforming?.platforms ?? []).toEqual([]); // nothing runs in both systems
    const zones = built.manifest.zones.map((zone) => zone.rect.id);
    expect(zones).toEqual(
      expect.arrayContaining([
        'cove-zone-landing',
        'leap-zone-learn',
        'leap-zone-lift',
        'leap-zone-nest',
      ]),
    );
  });

  it('runs the whole course in the engine bridge, which accepts every capability (GE-071)', async () => {
    const h = await cove();
    expect(bridgeApi(h).issues).toEqual([]);
    expect(
      bridgeApi(h)
        .platforms()
        .map((p) => p.id),
    ).toEqual(
      expect.arrayContaining(['leap-lift', 'leap-moving-dock', 'leap-stair-14', 'leap-nest']),
    );
    expect(
      bridgeApi(h)
        .platforms()
        .find((p) => p.id === 'leap-lift')!.kind,
    ).toBe('moving');
  });

  it('Pip narrates each section as the child walks in', async () => {
    const h = await cove();
    for (const [x, z] of [
      [-17, -18],
      [-24, -20.8],
      [-29, -21.4],
      [-24, -31.4],
      [-19, -29],
    ] as const) {
      h.setDrive(place(x, 0, z));
      h.runFrames(1);
    }
    const entered = named(h.events, 'PlayerEnteredZone').map(
      (d) => (d as { zoneId: string }).zoneId,
    );
    expect(entered).toEqual(
      expect.arrayContaining([
        'leap-zone-learn',
        'leap-zone-barrels',
        'leap-zone-logs',
        'leap-zone-dock',
        'leap-zone-lift',
      ]),
    );
  });

  it('the Pirate Lift: a plate wakes it, the child steps on and rides up to the ledge and the nest', async () => {
    const h = await cove();
    expect(liftRises(h)).toBe(false); // asleep until the plate
    h.setDrive(place(-20.6, 0, -30));
    h.runFrames(2);
    expect(liftRises(h)).toBe(true);
    // Back down for the child to step on (the lift waits at each end).
    for (let i = 0; i < 900 && platform(h, 'leap-lift').position.y > 0.21; i += 1) h.runFrames(1);
    // Step onto the lift from the ground (its top is a 0.2 m step, no jump) and ride.
    h.setDrive(place(-18, 0, -30.2, NORTH));
    h.runFrames(1);
    h.setDrive(go(NORTH));
    h.runFrames(40);
    h.setDrive(idle);
    h.runFrames(20);
    expect(h.engine.childPlacement().z).toBeGreaterThan(-29.2);
    // Up at the top (the lift waits there for 3 s): walk north onto the ledge and the nest.
    for (let i = 0; i < 600 && platform(h, 'leap-lift').position.y < 3.19; i += 1) h.runFrames(1);
    expect(platform(h, 'leap-lift').position.y).toBeGreaterThan(3.19); // top level with the ledge
    h.setDrive(go(NORTH));
    h.runFrames(90);
    expect(named(h.events, 'PlatformGoalReached')).toContainEqual({ goalId: 'leap-goal-nest' });
  });

  it('the lift and the ferry still tell the sound when they start, move and stop (audio parity)', async () => {
    const h = await cove();
    h.setDrive(place(-20.6, 0, -30)); // the gold plate wakes the lift
    h.runFrames(2);
    h.setDrive(idle);
    h.runFrames(60 * 10); // a full trip up, a pause, and back
    const ids = (name: 'PlatformActivated' | 'PlatformMoving' | 'PlatformStopped') =>
      named(h.events, name).map((d) => (d as { platformId: string }).platformId);
    expect(ids('PlatformActivated')).toContain('leap-lift');
    expect(ids('PlatformMoving')).toEqual(
      expect.arrayContaining(['leap-lift', 'leap-moving-dock']),
    );
    expect(ids('PlatformStopped')).toEqual(
      expect.arrayContaining(['leap-lift', 'leap-moving-dock']),
    );
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
    expect(named(h.events, 'CourseCheckpointReached')).toContainEqual({
      checkpointId: 'leap-cp-yard',
      label: 'the training yard',
    });
    h.setDrive(place(-24.4, 0, -20));
    h.runFrames(1);
    h.setDrive(idle);
    h.runFrames(2);
    // GE-071: the engine bridge's recovery also names the pool (PlayerRecovered.hazardId).
    expect(named(h.events, 'PlayerRecovered')).toContainEqual({
      reason: 'HAZARD',
      checkpointId: 'leap-cp-yard',
      hazardId: 'leap-pool-barrels',
    });
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
    expect(isPresent(h, 'leap-secret-bridge')).toBe(false);
    // The companion feeds recorded world changes to the bridge as signals (GE-065 hooks).
    bridgeApi(h).setSignals(['world:PIRATES_LEAP_RIDDLE_SOLVED']);
    h.runFrames(2);
    expect(isPresent(h, 'leap-secret-bridge')).toBe(true);
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
    expect(platform(slow, 'leap-moving-dock').position.x).toBeLessThan(
      platform(fast, 'leap-moving-dock').position.x,
    );
    fast.engine.dispose();
    slow.engine.dispose();
  });

  it('in third person the camera never ends inside an engine platform, riding the lift or not', async () => {
    // Camera contract: never inside a collider. Engine platforms are host colliders (GE-066), so
    // the camera's boom must stop at them as it does at the cove's own props.
    const h = await cove({ cameraMode: 'third-person' });
    const insideAny = () => {
      const eye = h.camera().position;
      return bridgeApi(h)
        .platforms()
        .filter(
          (p) =>
            Math.abs(eye.x - p.position.x) < p.size.x / 2 &&
            Math.abs(eye.z - p.position.z) < p.size.z / 2 &&
            eye.y < p.position.y &&
            eye.y > p.position.y - p.size.y,
        )
        .map((p) => p.id);
    };
    const seen = new Set<string>();
    let longestBoom = 0; // proves the camera really was behind the child, not at the eye
    const watch = (frames: number) => {
      for (let i = 0; i < frames; i += 1) {
        h.runFrames(1);
        for (const id of insideAny()) seen.add(id);
        const eye = h.camera().position;
        const feet = h.engine.childPlacement();
        longestBoom = Math.max(longestBoom, Math.hypot(eye.x - feet.x, eye.z - feet.z));
      }
    };
    h.setDrive(place(-20.6, 0, -30)); // the plate wakes the lift
    watch(2);
    for (let i = 0; i < 900 && platform(h, 'leap-lift').position.y > 0.21; i += 1) h.runFrames(1);
    h.setDrive(place(-18, 0, -30.2, NORTH)); // onto the lift, the camera behind (south of) the child
    watch(1);
    h.setDrive(go(NORTH));
    watch(40);
    h.setDrive(idle);
    watch(300); // up to the ledge and the wait at the top
    // Facing the barrels from the yard, then down the stairs' lower flight: static platforms too.
    h.setDrive(place(-21.2, 0, -19, WEST));
    watch(30);
    h.setDrive(place(-26.5, 0, -21.2, SOUTH));
    watch(30);
    expect(h.engine.cameraMode()).toBe('third-person');
    expect(longestBoom).toBeGreaterThan(1.5);
    expect([...seen]).toEqual([]);
  });

  it('plays in third-person too, and leaves the rest of the cove as it was', async () => {
    const h = await cove({ cameraMode: 'third-person' });
    expect(h.engine.cameraMode()).toBe('third-person');
    h.setDrive(place(-20.6, 0, -30));
    h.runFrames(3);
    expect(liftRises(h)).toBe(true);
    // The landing walk into the ruins still works (the cove's own path).
    h.setDrive(place(0, 0, 2, Math.PI));
    h.runFrames(1);
    h.setDrive(go(Math.PI));
    h.runFrames(400);
    expect(h.engine.childPlacement().z).toBeLessThan(-20);
  });
});
