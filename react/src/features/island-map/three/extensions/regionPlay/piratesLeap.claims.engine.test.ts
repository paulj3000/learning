// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import { bootstrapJson, piratesLeapSceneJson } from '../../../../../test/playFixtures';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../../../../discovery/checkpoints';
import { createEngineBridgeExtension } from '../../../../game-engine/bridge/engineBridge';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { mount, named, standingBox, type Drive, type Harness } from '../../runtime/testing/engineHarness';
import { regionPlaySceneExtension } from './regionPlayScene';
import { recoveredText } from '../../platforms/platformCopy';
import { bridgeCheckpointLabels } from '../../runtime/ThreeLocationWorldView';

/**
 * GE-071: Pirate's Leap on the Game Engine Core, as the child plays it. The seeded course's
 * checkpoints, goal and jump challenges run in the engine bridge, so the bridge's claims are
 * checked here: a jump route and its walking route end in the same completion claim, and the
 * course reports its checkpoints and its end. Claims are facts for Django, never awards; the
 * scoring lead derives the course award from the server's quest completion, never from these.
 */

const REGION = 'treasure-rush-cove';
const SESSION = '0b5f8c4e-6d0a-4c43-9b6c-2f2b1b3f9a10';

const place =
  (x: number, y: number, z: number): Drive =>
  (controller) => {
    controller.position.set(x, y, z);
  };
const idle: Drive = (controller, delta) => controller.update(delta, { forward: 0, strafe: 0 });

async function course(): Promise<{ harness: Harness; claims: AnyGameplayEvent[] }> {
  const region = { ...bootstrapJson().region, scene: await piratesLeapSceneJson() };
  const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
  const built = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
  publishRegionCheckpoints(REGION, built.checkpoints);
  const claims: AnyGameplayEvent[] = [];
  const bridge = createEngineBridgeExtension({
    claims: {
      context: { realmId: 'pirate-builder-bay', adventureId: REGION, areaId: REGION, sessionRef: SESSION },
    },
    onGameplayEvent: (event) => claims.push(event),
  });
  const harness = mount({
    manifest: built.manifest,
    extensions: [regionPlaySceneExtension, bridge],
    loadModel: async () => standingBox(),
  });
  await harness.engine.ready;
  return { harness, claims };
}

/** Stands the child at a spot (on a platform top when `y` > 0) and lets a few frames run. */
function standAt(h: Harness, x: number, y: number, z: number) {
  h.setDrive(place(x, y, z));
  h.runFrames(1);
  h.setDrive(idle);
  h.runFrames(4);
}

const ofType = (claims: AnyGameplayEvent[], type: AnyGameplayEvent['type']) =>
  claims.filter((claim) => claim.type === type).map((claim) => claim.payload);

afterEach(() => unpublishRegionCheckpoints(REGION));

describe("Pirate's Leap on the Game Engine Core (GE-071)", () => {
  it('a jump route and its walking route end in the same completion claim', async () => {
    const jumper = await course();
    standAt(jumper.harness, -26.2, 0.9, -19); // on the last barrel, over the pool
    const walker = await course();
    standAt(walker.harness, -28.6, 0, -19); // round the pool, on the barrel bank

    const jumped = ofType(jumper.claims, 'jump.challenge.completed');
    const walked = ofType(walker.claims, 'jump.challenge.completed');
    expect(jumped).toContainEqual({ challengeId: 'leap-barrels', routeId: 'leap-barrels-jump' });
    expect(walked).toContainEqual({ challengeId: 'leap-barrels', routeId: 'leap-barrels-walk' });
    // Same claim, same challenge, same keys: only the route id differs (contract rule 4).
    const [j] = jumped.filter((p) => 'challengeId' in p && p.challengeId === 'leap-barrels');
    const [w] = walked.filter((p) => 'challengeId' in p && p.challengeId === 'leap-barrels');
    expect(Object.keys(j!).sort()).toEqual(Object.keys(w!).sort());
    // The walking route is also noted as such, for information only.
    expect(ofType(walker.claims, 'jump.alternative.used')).toContainEqual({
      challengeId: 'leap-barrels',
      routeId: 'leap-barrels-walk',
    });
    expect(ofType(jumper.claims, 'jump.alternative.used')).toEqual([]);
    // Standing on a barrel inside the pool is not falling in: nothing is recovered.
    expect(named(jumper.harness.events, 'PlayerRecovered')).toEqual([]);
  });

  it('the treasure ledge: the bounce drum and the lift are the same challenge, completed once', async () => {
    const lift = await course();
    standAt(lift.harness, -18, 0.2, -28); // on the lift, no jump
    expect(ofType(lift.claims, 'jump.challenge.completed')).toContainEqual({
      challengeId: 'leap-ledge',
      routeId: 'leap-ledge-lift',
    });
    // A child who then also tries the drum completes nothing twice.
    standAt(lift.harness, -15.6, 0.3, -25.4);
    const ledge = ofType(lift.claims, 'jump.challenge.completed').filter(
      (p) => 'challengeId' in p && p.challengeId === 'leap-ledge',
    );
    expect(ledge).toHaveLength(1);
  });

  it('reports each checkpoint once and the end of the course at the crow’s nest', async () => {
    const { harness, claims } = await course();
    standAt(harness, -15.8, 0, -18); // the training yard
    standAt(harness, -15.8, 0, -18); // again: no second claim
    expect(ofType(claims, 'course.checkpoint.reached')).toEqual([
      { courseId: 'pirates-leap', checkpointId: 'leap-cp-yard' },
    ]);
    expect(named(harness.events, 'CourseCheckpointReached')).toContainEqual({
      checkpointId: 'leap-cp-yard',
      label: 'the training yard',
    });
    standAt(harness, -18, 3.4, -23); // on the nest, beside the treasure
    expect(ofType(claims, 'course.completed')).toEqual([{ courseId: 'pirates-leap', goalId: 'leap-goal-nest' }]);
    expect(named(harness.events, 'PlatformGoalReached')).toContainEqual({ goalId: 'leap-goal-nest' });
  });

  it('every claim is a valid v1 event bound to the session, with nothing graded or scored in it', async () => {
    const { harness, claims } = await course();
    standAt(harness, -15.8, 0, -18);
    standAt(harness, -26.2, 0.9, -19);
    standAt(harness, -18, 3.4, -23);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(validateGameplayEvent(claim).ok).toBe(true);
      expect(claim.sessionRef).toBe(SESSION);
      expect(JSON.stringify(claim.payload)).not.toMatch(/correct|score|points|xp|coins/i);
    }
  });

  it('still tells the child where they are back to, now that the checkpoints are on the bridge', async () => {
    const region = { ...bootstrapJson().region, scene: await piratesLeapSceneJson() };
    const model = toRegionSceneModel(read(bootstrapJson({ region }), parse.regionBootstrap));
    const { manifest } = buildRegionManifest(model, { worldSlug: 'learning-adventure-island' });
    // The live platform block no longer lists checkpoints; their labels come from the bridge.
    expect(manifest.platforming?.checkpoints ?? []).toEqual([]);
    const labels = bridgeCheckpointLabels(manifest);
    expect(recoveredText(manifest.platforming, 'leap-cp-yard', labels)).toBe(
      'Splash! Back to the training yard. Have another go!',
    );
    expect(recoveredText(manifest.platforming, 'leap-cp-dock', labels)).toBe(
      'Splash! Back to the far dock. Have another go!',
    );
  });
});
