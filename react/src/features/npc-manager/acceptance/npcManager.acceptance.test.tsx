/**
 * NPC Manager acceptance flow (LAI-NPC-040), React side, no browser.
 *
 * One continuous scenario through the real scene host (`useNpcSceneHost`) with the real runtime,
 * animator, behaviour controllers, dialogue controller, voice coordinator and UI, and only the
 * edges faked: the runtime read API, the interaction API, the hint API, the model loader, the
 * speech source and the world's frame clock. The scripted replies mirror the real seeded Pip
 * (`lai/apps/npcs/pip_content.py`), so the flow reads like the browser checklist:
 *
 *   NPCs load -> a failing model shows a placeholder -> approach -> Talk prompt -> interact ->
 *   panel with the authored caption -> voice muted: text only -> OFFER_QUEST choice -> close
 *   returns focus -> leave hides the prompt -> a treasure-found outcome makes Pip react and
 *   speak -> unmount disposes everything (no timers, no listeners, loader never per frame).
 *
 * The per-piece behaviour is tested next to each module; this file only proves they join up.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Group, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerOutcome } from '../../../api/play/types';
import { getSharedSoundManager, resetSharedSoundManager } from '../../../audio/sharedSoundManager';
import type { SpeechSource } from '../../../audio/speech/SpeechPlayer';
import type { NpcApi } from '../api/npcApi';
import { behaviorControllerFactory } from '../behavior';
import type { BehaviorControllerFactory, PlayerPose } from '../contracts/engine';
import type {
  InteractionResponse,
  NpcAssetRef,
  NpcSceneResponse,
  RuntimeCharacter,
  RuntimeChoice,
  RuntimeNode,
} from '../contracts/types';
import type { AdventureEvent } from '../contracts/vocabulary';
import type { NpcDialogueApi } from '../dialogue/npcDialogueApi';
import type { LoadedNpcModel } from '../engine/createNpcRuntime';
import type { NpcHintApi } from '../host/npcHintApi';
import { useNpcSceneHost, type NpcHostScene, type NpcSceneHost } from '../host/useNpcSceneHost';

const CHILD = 'child-accept';
const AREA = 'treasure-rush-cove';
const CONVERSATION = '11111111-2222-3333-4444-555555555555';
const QUEST = 'pips-missing-treasure';

// --- the published scene: Pip (model loads) and a second NPC whose model is broken ------------

function character(npcId: string, displayName: string, assetId: string): RuntimeCharacter {
  return {
    npcId,
    displayName,
    role: 'QUEST_GIVER',
    ageBands: [],
    personality: {},
    dialogueMode: 'AUTHORED',
    voiceProfile: npcId === 'pirate-pip' ? 'pirate-pip' : null,
    defaultVariant: 'classic',
    variants: [
      {
        variantKey: 'classic',
        displayName: 'Classic',
        model: { assetId, version: null },
        portrait: null,
        scale: 1,
        rotationOffsetY: 0,
        positionOffsetY: 0,
        animationMap: { idle: 'Idle', talk: 'Talk', wave: 'Wave' },
        extras: [],
      },
    ],
  };
}

const SCENE: NpcSceneResponse = {
  contractVersion: 1,
  release: 1,
  scope: { place: 'pirate-builder-bay', area: AREA },
  characters: {
    'pirate-pip': character('pirate-pip', 'Pirate Pip', 'npc-pip'),
    'deckhand-dot': character('deckhand-dot', 'Deckhand Dot', 'npc-broken'),
  },
  placements: [
    {
      placementKey: 'cove-pip',
      npcId: 'pirate-pip',
      variant: 'classic',
      behavior: {
        key: 'pip-landing',
        type: 'stationary',
        parameters: {
          boundsRadius: 15, // the server's default, filled by runtime_parameters
          facePlayer: true,
          reactions: { 'answer.correct': 'wave', 'treasure.found': 'celebrate' },
        },
      },
      position: { x: 3, y: 0, z: 6 },
      rotationY: 0,
      scale: 1,
      interactionRadius: 2.5,
    },
    {
      placementKey: 'cove-dot',
      npcId: 'deckhand-dot',
      variant: 'classic',
      behavior: null,
      position: { x: -20, y: 0, z: -20 },
      rotationY: 0,
      scale: 1,
      interactionRadius: 2.5,
    },
  ],
};

// --- the interaction API, scripted like the seeded Pip ----------------------------------------

function node(nodeKey: string, text: string, extra: Partial<RuntimeNode> = {}): RuntimeNode {
  return {
    nodeKey,
    text,
    emotion: 'happy',
    animationState: 'talk',
    audio: null,
    speech: {
      kind: 'npcDialogueNode',
      npcId: 'pirate-pip',
      release: 1,
      dialogueKey: 'mission-offer',
      nodeKey,
    },
    allowAiHint: false,
    ...extra,
  };
}

function reply(
  dialogueKey: string | null,
  shown: RuntimeNode | null,
  choices: RuntimeChoice[] = [],
  extra: Partial<InteractionResponse> = {},
): InteractionResponse {
  return {
    contractVersion: 1,
    release: 1,
    npcId: 'pirate-pip',
    conversationId: shown ? CONVERSATION : null,
    dialogueKey: shown ? dialogueKey : null,
    node: shown,
    choices,
    ended: shown === null,
    questOffer: null,
    ...extra,
  };
}

const ASK_TEXT =
  'Pip lost four treasures around the cove. Find them all and bring them back to Pip! Will you help me?';
const THANKS_TEXT = 'Thank you, friend! The treasure is waiting for you.';
const FOUND_TEXT = 'Arr, you found treasure! Keep going, friend.';
const ENDED = reply(null, null);

function pipDialogueApi() {
  const api = {
    start: vi.fn(async (_npcId: string, request: { trigger: string }) => {
      if (request.trigger === 'on_interact') {
        return reply('mission-offer', node('ask', ASK_TEXT), [
          { choiceKey: 'yes', label: 'Yes, I will help!', action: 'OFFER_QUEST' },
          { choiceKey: 'later', label: 'Maybe later', action: 'END' },
        ]);
      }
      if (request.trigger === 'on_treasure_found') {
        return reply('treasure-found', node('found', FOUND_TEXT, { animationState: 'celebrate' }));
      }
      return ENDED; // on_spawn: the first greeting was already seen in this scenario
    }),
    choose: vi.fn(async () =>
      reply('mission-offer', node('thanks', THANKS_TEXT, { animationState: 'wave' }), [], {
        questOffer: { questId: QUEST },
      }),
    ),
    advance: vi.fn(async () => ENDED),
    end: vi.fn(async () => ENDED),
  } satisfies NpcDialogueApi;
  return api;
}

// --- the world's edges: frame clock, loader, behaviour spy, listener ledger -------------------

/** The world's render loop, driven by hand: each tick is one 30 fps frame. */
function fakeSceneClock() {
  const parent = new Group();
  const frames = new Set<(dt: number) => void>();
  let pose: PlayerPose | null = { x: 0, z: 30 };
  const scene: NpcHostScene = {
    parent,
    onFrame: (callback) => {
      frames.add(callback);
      return () => frames.delete(callback);
    },
    playerPose: () => pose,
    isBlocked: () => false,
  };
  return {
    scene,
    parent,
    frames,
    tick(count = 1) {
      act(() => {
        for (let i = 0; i < count; i += 1) for (const frame of [...frames]) frame(1 / 30);
      });
    },
    moveTo(next: PlayerPose | null) {
      pose = next;
      this.tick();
    },
  };
}

/** Resolves Pip's model, rejects the broken one; counts every call. */
function fakeLoader() {
  const calls: string[] = [];
  const disposed: string[] = []; // models whose lease the runtime returned
  const loadModel = vi.fn(async (ref: NpcAssetRef): Promise<LoadedNpcModel> => {
    calls.push(ref.assetId);
    if (ref.assetId === 'npc-broken') throw new Error('model unavailable');
    const scene = new Group();
    scene.name = `model:${ref.assetId}`;
    return { scene, animations: [], release: () => void disposed.push(ref.assetId) };
  });
  return { loadModel, calls, disposed };
}

function behaviorSpy() {
  const calls: string[] = [];
  const factory: BehaviorControllerFactory = (args) => {
    const real = behaviorControllerFactory(args);
    return {
      update: (dt, player) => real.update(dt, player),
      interrupt: (reason) => {
        calls.push('interrupt');
        real.interrupt(reason);
      },
      resume: () => {
        calls.push('resume');
        real.resume();
      },
      cancel: () => real.cancel(),
      react: (event: AdventureEvent) => {
        calls.push(`react:${event}`);
        return real.react(event);
      },
      state: () => real.state(),
      dispose: () => {
        calls.push('dispose');
        real.dispose();
      },
    };
  };
  return { calls, factory };
}

/**
 * Listeners the harness keeps for the document's lifetime, not the host's: user-event's focus
 * tracking and React DOM's once-per-document `selectionchange` listener.
 */
const fromHarness = () => /@testing-library[\\/]user-event|react-dom/.test(new Error().stack ?? '');

/** Counts window and document listeners added and removed while the scenario runs. */
function listenerLedger() {
  const live = new Map<string, number>();
  const spies = [window, document].flatMap((target) => {
    const name = target === window ? 'window' : 'document';
    const add = vi.spyOn(target, 'addEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (!fromHarness()) live.set(`${name}:${type}`, (live.get(`${name}:${type}`) ?? 0) + 1);
      return EventTarget.prototype.addEventListener.call(this, type, listener, options);
    });
    const remove = vi.spyOn(target, 'removeEventListener').mockImplementation(function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (!fromHarness()) live.set(`${name}:${type}`, (live.get(`${name}:${type}`) ?? 0) - 1);
      return EventTarget.prototype.removeEventListener.call(this, type, listener, options);
    });
    return [add, remove];
  });
  return {
    /** Listener types whose add and remove counts do not balance. */
    unbalanced: () => [...live].filter(([, count]) => count !== 0).map(([type]) => type),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

/** A media query stub that counts its live `change` listeners (reduced motion). */
function mediaQueryLedger() {
  const original = window.matchMedia;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  })) as unknown as typeof window.matchMedia;
  return { listeners, restore: () => (window.matchMedia = original) };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

const answer = (): AnswerOutcome => ({
  attemptId: 'att-1',
  correct: true,
  feedback: {} as AnswerOutcome['feedback'],
  canRetry: false,
  chestOpened: true,
  newItems: [],
  rewardMessage: null,
  questUpdates: [],
  completionRewards: [],
});

const npcRoot = (parent: Object3D, key: string) =>
  parent.children.find((child) => child.name === `npc:${key}`);

describe('NPC Manager acceptance: Treasure Cove with managed Pip (fakes only)', () => {
  let ledger: ReturnType<typeof listenerLedger>;
  let media: ReturnType<typeof mediaQueryLedger>;

  beforeEach(() => {
    media = mediaQueryLedger();
    ledger = listenerLedger();
  });

  afterEach(() => {
    ledger.restore();
    media.restore();
    resetSharedSoundManager();
    vi.useRealTimers();
  });

  it('loads, talks, offers the quest, reacts to treasure and disposes cleanly', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = fakeSceneClock();
    const loader = fakeLoader();
    const behavior = behaviorSpy();
    const dialogueApi = pipDialogueApi();
    const api: NpcApi = {
      getCatalog: vi.fn(),
      getAreaNpcs: vi.fn(async () => SCENE),
      getPlaceNpcs: vi.fn(),
    };
    const hintApi: NpcHintApi = { hint: vi.fn() };
    const speechSource: SpeechSource = {
      request: vi.fn(async () => ({
        url: 'https://speech.test/pip.mp3',
        expiresInSeconds: 900,
        text: ASK_TEXT,
        voiceProfile: 'pirate-pip',
        cached: true,
      })),
    };
    const onQuestOffer = vi.fn();
    const host: { current: NpcSceneHost | null } = { current: null };
    const deps = {
      api,
      dialogueApi,
      hintApi,
      loadModel: loader.loadModel,
      behaviorFactory: behavior.factory,
      speechSource,
    };

    function TreasureCove() {
      const value = useNpcSceneHost({
        childId: CHILD,
        scope: { kind: 'area', regionId: AREA },
        scene: clock.scene,
        reducedMotion: false,
        onQuestOffer,
        deps,
      });
      host.current = value;
      return (
        <>
          <p data-testid="status">{value.status}</p>
          {value.prompt}
          {value.panel}
          {value.bubble}
        </>
      );
    }

    // 1. NPCs load; the broken model leaves a placeholder that can still be found.
    const view = render(<TreasureCove />);
    await flush();
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(api.getAreaNpcs).toHaveBeenCalledTimes(1);
    expect(host.current?.managedNpcIds).toEqual(new Set(['pirate-pip', 'deckhand-dot']));
    const pip = npcRoot(clock.parent, 'cove-pip');
    const dot = npcRoot(clock.parent, 'cove-dot');
    expect(pip?.getObjectByName('model:npc-pip')).toBeTruthy();
    expect(pip?.getObjectByName('npc-placeholder:cove-pip')).toBeUndefined();
    expect(dot?.getObjectByName('npc-placeholder:cove-dot')).toBeTruthy();
    expect([...loader.calls].sort()).toEqual(['npc-broken', 'npc-pip']);
    // on_spawn is asked once per placement, placeholder included; nothing is shown for it.
    const spawned = dialogueApi.start.mock.calls.filter(([, r]) => r.trigger === 'on_spawn');
    expect(spawned.map(([npcId]) => npcId).sort()).toEqual(['deckhand-dot', 'pirate-pip']);
    expect(screen.queryByRole('dialog')).toBeNull();

    // The loader runs once per model, never per frame.
    clock.tick(120);
    expect(loader.loadModel).toHaveBeenCalledTimes(2);

    // 2. Approach: the Talk prompt appears.
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();
    clock.moveTo({ x: 3, z: 7.5 });
    const talk = screen.getByRole('button', { name: 'Talk to Pirate Pip' });

    // 3. Voice muted, then interact: the authored caption shows, with no speech and no replay.
    getSharedSoundManager().setMuted(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(talk);
    await flush();
    expect(dialogueApi.start).toHaveBeenCalledWith(
      'pirate-pip',
      expect.objectContaining({ trigger: 'on_interact', placementKey: 'cove-pip' }),
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('dialog', { name: 'Pirate Pip' })).toBeTruthy();
    expect(screen.getByText(ASK_TEXT)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Hear it again' })).toBeNull();
    expect(speechSource.request).not.toHaveBeenCalled();
    expect(behavior.calls).toContain('interrupt');
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();

    // 4. The OFFER_QUEST choice: the world's accept flow is told once; nothing else happens.
    await user.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await flush();
    expect(dialogueApi.choose).toHaveBeenCalledWith(
      'pirate-pip',
      CONVERSATION,
      'yes',
      expect.any(AbortSignal),
    );
    expect(screen.getByText(THANKS_TEXT)).toBeVisible();
    expect(onQuestOffer).toHaveBeenCalledTimes(1);
    expect(onQuestOffer).toHaveBeenCalledWith(QUEST, 'pirate-pip');
    expect(hintApi.hint).not.toHaveBeenCalled();

    // 5. Close: the panel goes, the behaviour resumes, focus returns to the Talk prompt.
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialogueApi.end).toHaveBeenCalledWith('pirate-pip', CONVERSATION);
    expect(behavior.calls.lastIndexOf('resume')).toBeGreaterThan(
      behavior.calls.lastIndexOf('interrupt'),
    );
    expect(screen.getByRole('button', { name: 'Talk to Pirate Pip' })).toHaveFocus();

    // 6. Leave: the prompt hides.
    clock.moveTo({ x: 3, z: 30 });
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();

    // 7. A treasure-found play outcome: Pip reacts and says his authored line.
    act(() => host.current?.notifyPlay({ kind: 'answer', outcome: answer() }));
    await flush();
    expect(behavior.calls).toContain('react:treasure.found');
    expect(behavior.calls).toContain('react:answer.correct');
    const playTriggers = dialogueApi.start.mock.calls
      .map(([, r]) => r.trigger)
      .filter((t) => t !== 'on_spawn' && t !== 'on_interact');
    expect(playTriggers).toEqual(['on_treasure_found']); // one line for the best trigger
    expect(screen.getByText(FOUND_TEXT)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    clock.tick(60);

    // 8. Unmount: frames stop, roots and models go, behaviours dispose, nothing is left behind.
    const startsBefore = dialogueApi.start.mock.calls.length;
    view.unmount();
    await flush();
    expect(clock.frames.size).toBe(0);
    expect(clock.parent.children.filter((c) => c.name.startsWith('npc:'))).toHaveLength(0);
    expect(behavior.calls.filter((c) => c === 'dispose')).toHaveLength(2);
    expect(loader.disposed).toEqual(['npc-pip']);
    expect(media.listeners.size).toBe(0);
    expect(ledger.unbalanced()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(loader.loadModel).toHaveBeenCalledTimes(2);
    expect(dialogueApi.start.mock.calls.length).toBe(startsBefore);
    warn.mockRestore();
  });
});
