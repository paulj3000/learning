// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, piratesLeapSceneJson } from '../../../../../test/playFixtures';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../../../../discovery/checkpoints';
import { createEngineBridgeExtension } from '../../../../game-engine/bridge/engineBridge';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { mount, named, standingBox, type Drive, type Harness } from '../../runtime/testing/engineHarness';
import { regionPlaySceneExtension } from './regionPlayScene';

/**
 * GE-071 (owner decision 2026-11-19): every part of Pirate's Leap a child needs is reachable on
 * foot, with no jump and no moving platform, so the lift and the moving dock are optional extras.
 * These walks run on the real runtime with the seeded course: walking only, never pressing jump.
 */

const REGION = 'treasure-rush-cove';
const NORTH = 0; // +Z
const SOUTH = Math.PI;
const EAST = -Math.PI / 2; // -X ... see below
const WEST = Math.PI / 2;

async function course(): Promise<Harness> {
  const region = { ...bootstrapJson().region, scene: await piratesLeapSceneJson() };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension, createEngineBridgeExtension()],
    loadModel: async () => standingBox(),
  });
  await harness.engine.ready;
  return harness;
}

const place =
  (x: number, z: number, yaw: number): Drive =>
  (controller) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
  };

/** Walks (never jumps) toward a point until within 0.3 m or the frame budget runs out. */
function walkTo(h: Harness, x: number, z: number, frames = 600) {
  let arrived = false;
  h.setDrive((c, delta) => {
    const dx = x - c.position.x;
    const dz = z - c.position.z;
    if (Math.hypot(dx, dz) < 0.3) {
      arrived = true;
      c.update(delta, { forward: 0, strafe: 0 });
      return;
    }
    c.yaw = Math.atan2(dx, dz); // yaw 0 faces +Z; forward is (sin yaw, cos yaw)
    c.update(delta, { forward: 1, strafe: 0 });
  });
  h.runFrames(frames);
  return arrived;
}

let current: Harness | null = null;
afterEach(() => {
  unpublishRegionCheckpoints(REGION);
  current = null;
});

describe("Pirate's Leap: every required place is reachable on foot (GE-071)", () => {
  it('walks from the log landing round the dock pool to the far dock, without the ferry', async () => {
    current = await course();
    const h = current;
    h.setDrive(place(-28.8, -32.6, NORTH));
    h.runFrames(1);
    expect(walkTo(h, -28.6, -31.0)).toBe(true); // up onto the strip between the two pools
    expect(walkTo(h, -20.0, -31.0)).toBe(true); // east along it
    expect(walkTo(h, -19.8, -33.0)).toBe(true); // down to the far dock
    expect(named(h.events, 'PlayerRecovered')).toEqual([]); // never fell in
    expect(named(h.events, 'PlayerJumped')).toEqual([]);
  });

  it('climbs the stone stairs to the treasure ledge and steps up to the nest, without the lift', async () => {
    current = await course();
    const h = current;
    h.setDrive(place(-26.5, -20.5, SOUTH)); // at the foot of the stairs, below the barrel pool
    h.runFrames(1);
    expect(walkTo(h, -26.5, -25.4)).toBe(true); // up the lower flight to the turn
    expect(walkTo(h, -18.0, -25.4, 900)).toBe(true); // up the upper flight and onto the ledge
    expect(walkTo(h, -18.0, -23.0)).toBe(true); // one small step up onto the nest
    expect(named(h.events, 'PlatformGoalReached')).toContainEqual({ goalId: 'leap-goal-nest' });
    expect(named(h.events, 'PlayerJumped')).toEqual([]);
    expect(named(h.events, 'PlayerRecovered')).toEqual([]);
  });
});

void EAST;
void WEST;
