import { describe, expect, it } from 'vitest';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { PickupOutcome, TalkOutcome } from '../../api/play/types';
import { coveSceneJson, pipsBootstrapJson } from '../../test/playFixtures';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { buildRegionManifest, REGION_ACTIONS } from './regionManifest';
import { tryParseRegionPlayConfig } from './regionPlayConfig';
import { resolveRegionPlayInteraction } from './regionPlayInteractions';
import { initialRegionPlayState, regionPlayReducer, scopeKey } from './regionPlayState';
import { nextStepHint, objectiveCue, questObjective } from './regionPlayUi';
import { toRegionSceneModel } from './sceneModel';

/**
 * Pip's Missing Treasure (TR-14) on the client: how the server's encounters become a scene, what
 * touching each thing means, what the HUD and hints say, and what the state keeps. Every input is
 * a play API response; nothing here decides an outcome.
 */

const REGION = 'treasure-rush-cove';

function bootstrap(
  overrides: Record<string, unknown> = {},
  chests: Record<string, Record<string, unknown>> = {},
) {
  return read(pipsBootstrapJson(overrides, chests), parse.regionBootstrap);
}

function build(data = bootstrap()) {
  const built = buildRegionManifest(toRegionSceneModel(data), {
    worldSlug: 'learning-adventure-island',
  });
  return { ...built, config: tryParseRegionPlayConfig(built.manifest.extensions[0]!.config)! };
}

const giver = () => 'Pirate Pip';

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('the cove scene from the server (TR-14)', () => {
  it('builds a manifest the engine validator accepts, on the real cove layout', async () => {
    const base = pipsBootstrapJson();
    const data = read(
      { ...base, region: { ...base.region, scene: await coveSceneJson() } },
      parse.regionBootstrap,
    );
    const built = build(data);
    publishRegionCheckpoints(REGION, built.checkpoints);
    expect(validateLocationManifest(built.manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('makes the key something to pick up and the rune stones something to touch', () => {
    const { manifest, config } = build();
    const key = manifest.props.find((p) => p.entityId === 'cove-brass-key');
    expect(key?.action).toBe(REGION_ACTIONS.pickUp);
    expect(config.pickups).toEqual([{ entityId: 'cove-brass-key' }]);
    const stone = manifest.props.find((p) => p.entityId === 'cove-rune-stone-2');
    expect(stone?.action).toBe(REGION_ACTIONS.touch);
    expect(config.runes).toContainEqual({
      entityId: 'cove-rune-stone-2',
      puzzleEntityId: 'cove-ruins-pedestal',
      index: 1,
    });
    expect(manifest.props.find((p) => p.entityId === 'cove-ruins-pedestal')?.action).toBe(
      REGION_ACTIONS.read,
    );
  });

  it('carries each chest’s presentation and lock to the scene', () => {
    const { config } = build();
    const byId = new Map(config.chests.map((c) => [c.entityId, c]));
    expect(byId.get('cove-grove-chest')?.presentation).toBe('HIDDEN');
    expect(byId.get('cove-beach-chest')?.lockReason).toBe('PROGRESS');
    expect(byId.get('cove-ruins-pedestal')?.presentation).toBe('PUZZLE');
    expect(byId.get('cove-chest')?.presentation).toBeUndefined();
  });

  it('leaves out a key the child already picked up, so it is never drawn again', () => {
    const data = bootstrap();
    data.objects[0] = { ...data.objects[0]!, collected: true };
    const { manifest, config } = build(data);
    expect(manifest.props.some((p) => p.entityId === 'cove-brass-key')).toBe(false);
    expect(config.pickups).toEqual([]);
  });
});

describe('what touching things means (TR-14)', () => {
  const resolve = (interactionId: string, data = bootstrap()) =>
    resolveRegionPlayInteraction(build(data).config, data, interactionId, true);

  it('never asks for a challenge for a locked chest, and says why', () => {
    const event = resolve(`${REGION}:chest:cove-beach-chest`);
    expect(event).toMatchObject({
      kind: 'chest',
      lockReason: 'PROGRESS',
      canRequestChallenge: false,
    });
    const open = resolve(`${REGION}:chest:cove-grove-chest`);
    expect(open).toMatchObject({ kind: 'chest', lockReason: null, canRequestChallenge: true });
  });

  it('turns the key into a pickup and a stone into its choice of the puzzle', () => {
    expect(resolve(`${REGION}:pickup:cove-brass-key`)).toEqual({
      kind: 'pickup',
      entityId: 'cove-brass-key',
      label: 'Old brass key',
    });
    expect(resolve(`${REGION}:rune:cove-rune-stone-3`)).toEqual({
      kind: 'rune',
      entityId: 'cove-rune-stone-3',
      puzzleEntityId: 'cove-ruins-pedestal',
      index: 2,
    });
  });

  it('offers nothing for a key already picked up', () => {
    const before = bootstrap();
    const { config } = build(before);
    const after = bootstrap();
    after.objects[0] = { ...after.objects[0]!, collected: true };
    expect(
      resolveRegionPlayInteraction(config, after, `${REGION}:pickup:cove-brass-key`, true),
    ).toBeNull();
  });
});

describe('the objective and hints through the adventure (TR-14)', () => {
  it('counts the current stage: the four treasures, then the walk back to Pip', () => {
    const objective = questObjective(bootstrap().quests, giver);
    expect(objectiveCue(objective!)).toBe("Find Pip's treasures: 1 of 4");
    const back = bootstrap();
    back.quests[0] = { ...back.quests[0]!, currentStageId: 'return-to-pip' };
    expect(objectiveCue(questObjective(back.quests, giver)!)).toBe(
      'Bring the treasure back to Pip',
    );
  });

  it('points the hint at the next encounter in order, in Pip’s words', () => {
    const data = bootstrap();
    const objective = questObjective(data.quests, giver);
    expect(nextStepHint(objective, data.chests)).toBe('Follow the flowers in the grove!');
    const keyNext = bootstrap(
      {},
      {
        'cove-grove-chest': { isOpen: true },
        'cove-beach-chest': { lockReason: 'ITEM' },
      },
    );
    expect(nextStepHint(objective, keyNext.chests)).toMatch(/X in the sand/);
  });

  it('sends the child back to Pip when every encounter is done', () => {
    const done = bootstrap(
      {},
      {
        'cove-grove-chest': { isOpen: true },
        'cove-beach-chest': { isOpen: true, lockReason: null },
        'cove-ruins-pedestal': { isOpen: true, lockReason: null },
      },
    );
    expect(nextStepHint(questObjective(done.quests, giver), done.chests)).toMatch(
      /Walk back to Pirate Pip/,
    );
  });
});

describe('what the state keeps (TR-14)', () => {
  const scope = scopeKey('child', REGION);
  const key = {
    itemId: 'old-brass-key',
    displayName: 'Old Brass Key',
    description: '',
    category: 'QUEST_ITEM' as const,
    assetId: '',
  };
  const badge = { ...key, itemId: 'treasure-cove-explorer', category: 'KEEPSAKE' as const };

  it('keeps the server’s pickup and talk replies and adds what they granted once each', () => {
    const pickup: PickupOutcome = {
      entityId: 'cove-brass-key',
      pickedUp: true,
      collected: true,
      newItems: [key],
      rewardMessage: null,
      questUpdates: [],
      completionRewards: [],
    };
    const talk: TalkOutcome = {
      flagsSet: ['cove-treasure-returned'],
      questUpdates: [],
      completionRewards: [{ ruleId: 'r', items: [badge], message: '' }],
    };
    let state = initialRegionPlayState(scope);
    state = regionPlayReducer(state, { scope, type: 'pickedUp', outcome: pickup });
    state = regionPlayReducer(state, { scope, type: 'pickedUp', outcome: pickup });
    state = regionPlayReducer(state, { scope, type: 'talked', outcome: talk });
    expect(state.lastPickup).toBe(pickup);
    expect(state.lastTalk).toBe(talk);
    expect(state.rewards.map((item) => item.itemId)).toEqual([
      'old-brass-key',
      'treasure-cove-explorer',
    ]);
  });

  it('drops a pickup reply meant for another child', () => {
    const state = regionPlayReducer(initialRegionPlayState(scope), {
      scope: scopeKey('someone-else', REGION),
      type: 'pickedUp',
      outcome: {
        entityId: 'k',
        pickedUp: true,
        collected: true,
        newItems: [key],
        rewardMessage: null,
        questUpdates: [],
        completionRewards: [],
      },
    });
    expect(state.lastPickup).toBeNull();
    expect(state.rewards).toEqual([]);
  });
});
