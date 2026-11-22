import { describe, expect, it } from 'vitest';
import { createEngineRuntime } from '../core/runtime';
import type { EventMap } from '../core/eventBus';
import {
  ASSET_MANAGER,
  INVENTORY,
  MULTIPLAYER,
  QUESTION_STUDIO,
  QUEST_SERVICE,
  REWARDS,
  SAVE_RESTORE,
  SOUND_MANAGER,
  createDisabledMultiplayer,
  createFakeAssetManager,
  createFakeInventory,
  createFakeNpcManager,
  createFakePublishedContent,
  createFakeQuestService,
  createFakeQuestionStudio,
  createFakeRewards,
  createFakeSaveRestore,
  createFakeSoundManager,
  provideFakeServices,
  reconcileSnapshot,
  validatePresentationSnapshot,
  type PresentationSnapshot,
} from './index';

const snapshot: PresentationSnapshot = {
  version: 1,
  adventureId: 'demo-adventure',
  areaId: 'demo-cove',
  player: { x: 1, y: 0, z: 2, yaw: 0.5 },
  cameraMode: 'third-person',
  confirmedOpenDoorIds: ['door-a', 'door-b'],
};

describe('service fakes', () => {
  it('provides every port on a runtime and clears them on dispose', () => {
    const runtime = createEngineRuntime<EventMap>({ id: 'demo' });
    const fakes = provideFakeServices(runtime);
    expect(runtime.services.require(ASSET_MANAGER)).toBe(fakes.assets);
    expect(runtime.services.require(MULTIPLAYER).enabled).toBe(false);
    expect(runtime.services.ids()).toHaveLength(10);
    runtime.dispose();
    expect(runtime.services.ids()).toHaveLength(0);
  });

  it('lets a host replace a port', () => {
    const runtime = createEngineRuntime<EventMap>({ id: 'demo' });
    const sound = createFakeSoundManager();
    provideFakeServices(runtime, { replace: { sound } });
    expect(runtime.services.require(SOUND_MANAGER)).toBe(sound);
  });

  it('asset manager resolves, loads and disposes handles', async () => {
    const assets = createFakeAssetManager([
      { assetId: 'tree', version: null, kind: 'model', url: 'https://cdn/tree.glb' },
    ]);
    expect(await assets.resolve('tree')).toMatchObject({ url: 'https://cdn/tree.glb' });
    expect(await assets.resolve('nope')).toBeNull();
    const handle = await assets.load('tree');
    expect(assets.liveHandles()).toHaveLength(1);
    handle.dispose();
    expect(handle.disposed).toBe(true);
    expect(assets.liveHandles()).toHaveLength(0);
    await expect(assets.load('nope')).rejects.toMatchObject({ code: 'ASSET_LOAD_FAILED' });
  });

  it('sound manager records cues, emitters and never rejects', async () => {
    const sound = createFakeSoundManager();
    expect(await sound.play('sfx.ding', { emitterId: 'missing' })).toBeNull();
    sound.setEmitter('bell', { x: 0, y: 1, z: 0 });
    const playback = await sound.play('sfx.ding', { emitterId: 'bell' });
    expect(playback?.cueId).toBe('sfx.ding');
    sound.stop('sfx.ding');
    expect(sound.played).toEqual(['sfx.ding']);
    sound.removeEmitter('bell');
    expect(sound.emitters.size).toBe(0);
  });

  it('npc manager returns definitions by reference only', () => {
    const npcs = createFakeNpcManager([
      {
        npcId: 'captain',
        displayNameKey: 'npc.captain.name',
        voiceProfile: null,
        ageBands: ['SPROUT'],
        modelAssetId: 'captain-model',
        approachLineRef: 'line.captain.hello',
        interactionLineRefs: { greet: 'line.captain.greet' },
      },
    ]);
    expect(npcs.get('captain')?.interactionLineRefs.greet).toBe('line.captain.greet');
    expect(npcs.get('ghost')).toBeUndefined();
  });

  it('question studio exposes presentation only and returns an opaque server verdict', async () => {
    const studio = createFakeQuestionStudio(
      [
        {
          questionId: 'q1',
          ageBand: 'SPROUT',
          promptRef: 'q.q1.prompt',
          choices: [{ choiceId: 'a', labelRef: 'q.q1.a' }],
        },
      ],
      { grade: 'server' },
    );
    expect(await studio.fetchQuestion('q1', 'SPROUT')).not.toBeNull();
    expect(await studio.fetchQuestion('q1', 'EXPLORER')).toBeNull();
    const question = (await studio.fetchQuestion('q1', 'SPROUT'))!;
    expect(Object.keys(question.choices[0]!)).not.toContain('correct');
    const verdict = await studio.submitAnswer(
      { kind: 'QUESTION_ITEM', questionId: 'q1', challengeAttemptId: 'att-1' },
      'a',
    );
    expect(verdict).toEqual({ verdict: { grade: 'server' } });
    expect(studio.submissions).toHaveLength(1);
    expect(QUESTION_STUDIO.id).toBe('lai.questionStudio');
  });

  it('quest service is read-only plus a claim the server resolves', async () => {
    const quests = createFakeQuestService([
      {
        questId: 'q',
        status: 'ACTIVE',
        activeStepId: 's1',
        completedStepIds: [],
        stepOrder: ['s1', 's2'],
      },
    ]);
    const seen: string[] = [];
    quests.subscribe((state) => seen.push(state.status));
    expect((await quests.claimStepComplete('q', 's2')).activeStepId).toBe('s1'); // server refuses
    expect((await quests.claimStepComplete('q', 's1')).activeStepId).toBe('s2');
    expect((await quests.claimStepComplete('q', 's2')).status).toBe('COMPLETED');
    expect(seen).toEqual(['ACTIVE', 'COMPLETED']);
    expect(QUEST_SERVICE.id).toBe('lai.questService');
  });

  it('inventory and rewards have no grant method', () => {
    const inventory = createFakeInventory(['key']);
    const rewards = createFakeRewards();
    expect(inventory.has('key')).toBe(true);
    for (const port of [inventory, rewards] as object[]) {
      expect(Object.keys(port).filter((key) => /grant(?!ed)|award|add|give/i.test(key))).toEqual(
        [],
      );
    }
    const seen: string[] = [];
    rewards.subscribe((r) => seen.push(r.rewardId));
    rewards.announce({ rewardId: 'r1', titleKey: 'reward.r1.title', itemIds: ['shell'] });
    expect(seen).toEqual(['r1']);
    expect(rewards.granted()).toHaveLength(1);
    expect(INVENTORY.id).toBe('lai.inventory');
    expect(REWARDS.id).toBe('lai.rewards');
  });

  it('published content loads by id and version', async () => {
    const content = createFakePublishedContent({ areas: { cove: { v: 1 }, 'cove@2': { v: 2 } } });
    expect(await content.loadArea({ id: 'cove', version: 2 })).toEqual({ v: 2 });
    expect(await content.loadArea({ id: 'cove' })).toEqual({ v: 1 });
    expect(await content.loadAdventure({ id: 'none' })).toBeNull();
  });

  it('multiplayer is disabled by default', () => {
    const mp = createDisabledMultiplayer();
    expect(mp.enabled).toBe(false);
    expect(mp.presenceIds()).toEqual([]);
    expect(() => mp.subscribe(() => undefined)()).not.toThrow();
  });
});

describe('save and restore', () => {
  it('round-trips a valid snapshot and returns copies', () => {
    const store = createFakeSaveRestore();
    store.save(snapshot);
    const loaded = store.load('demo-adventure')!;
    expect(loaded).toEqual(snapshot);
    loaded.player.x = 99;
    expect(store.load('demo-adventure')!.player.x).toBe(1);
    store.clear('demo-adventure');
    expect(store.load('demo-adventure')).toBeNull();
    expect(SAVE_RESTORE.id).toBe('lai.saveRestore');
  });

  it('rejects wrong versions, bad numbers and any extra (child data) keys', () => {
    expect(validatePresentationSnapshot({ ...snapshot, version: 2 }).ok).toBe(false);
    expect(
      validatePresentationSnapshot({ ...snapshot, player: { x: NaN, y: 0, z: 0, yaw: 0 } }).ok,
    ).toBe(false);
    const withName = validatePresentationSnapshot({ ...snapshot, childName: 'Sam' });
    expect(withName.ok).toBe(false);
    expect(
      validatePresentationSnapshot({ ...snapshot, player: { ...snapshot.player, age: 4 } }).ok,
    ).toBe(false);
    const store = createFakeSaveRestore();
    store.save({ ...snapshot, childName: 'Sam' } as never);
    expect(store.size).toBe(0);
  });

  it('server state wins: doors the server does not report open are dropped', () => {
    const { snapshot: restored, droppedDoorIds } = reconcileSnapshot(snapshot, {
      openDoorIds: ['door-a', 'door-z'],
    });
    expect(restored.confirmedOpenDoorIds).toEqual(['door-a']);
    expect(droppedDoorIds).toEqual(['door-b']);
    expect(restored.player).toEqual(snapshot.player);
  });
});
