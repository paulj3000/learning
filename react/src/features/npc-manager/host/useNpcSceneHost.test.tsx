import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Group } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/errors';
import { resetSharedSoundManager } from '../../../audio/sharedSoundManager';
import type { AnswerOutcome } from '../../../api/play/types';
import { emptyScene, type NpcApi } from '../api/npcApi';
import { behaviorControllerFactory } from '../behavior';
import type { BehaviorControllerFactory, PlayerPose } from '../contracts/engine';
import type {
  InteractionResponse,
  NpcSceneResponse,
  RuntimeCharacter,
  RuntimeChoice,
  RuntimeNode,
} from '../contracts/types';
import type { AdventureEvent } from '../contracts/vocabulary';
import type { NpcDialogueApi } from '../dialogue/npcDialogueApi';
import type { NpcHintApi } from './npcHintApi';
import {
  useNpcSceneHost,
  type NpcHostScene,
  type NpcSceneHost,
  type UseNpcSceneHostOptions,
} from './useNpcSceneHost';

afterEach(() => resetSharedSoundManager());

const CHILD = 'child-1';
const AREA = 'treasure-rush-cove';
const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const PIP: RuntimeCharacter = {
  npcId: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'QUEST_GIVER',
  ageBands: [],
  personality: {},
  dialogueMode: 'AUTHORED',
  voiceProfile: null,
  defaultVariant: 'classic',
  variants: [
    {
      variantKey: 'classic',
      displayName: 'Classic',
      model: { assetId: 'npc-pip', version: null },
      portrait: null,
      scale: 1,
      rotationOffsetY: 0,
      positionOffsetY: 0,
      animationMap: { idle: 'Idle', talk: 'Talk', wave: 'Wave' },
      extras: [],
    },
  ],
};

const SCENE: NpcSceneResponse = {
  contractVersion: 1,
  release: 1,
  scope: { place: 'pirate-builder-bay', area: AREA },
  characters: { 'pirate-pip': PIP },
  placements: [
    {
      placementKey: 'cove-pip',
      npcId: 'pirate-pip',
      variant: 'classic',
      behavior: null,
      position: { x: 3, y: 0, z: 6 },
      rotationY: 0,
      scale: 1,
      interactionRadius: 2.5,
    },
  ],
};

function node(nodeKey: string, text: string, extra: Partial<RuntimeNode> = {}): RuntimeNode {
  return {
    nodeKey,
    text,
    emotion: 'happy',
    animationState: null,
    audio: null,
    speech: null,
    allowAiHint: false,
    ...extra,
  };
}

function reply(
  shown: RuntimeNode | null,
  choices: RuntimeChoice[] = [],
  extra: Partial<InteractionResponse> = {},
): InteractionResponse {
  return {
    contractVersion: 1,
    release: 1,
    npcId: 'pirate-pip',
    conversationId: shown ? CONVERSATION : null,
    dialogueKey: shown ? 'mission-offer' : null,
    node: shown,
    choices,
    ended: shown === null,
    questOffer: null,
    ...extra,
  };
}

const ASK = node('ask', 'Will you help me?');
const NONE = reply(null);

function fakeDialogueApi(onInteract: InteractionResponse = reply(node('ahoy', 'Ahoy!'))) {
  const api = {
    start: vi.fn(async (_npc: string, request: { trigger: string }) =>
      request.trigger === 'on_interact' ? onInteract : NONE,
    ),
    choose: vi.fn(async () => reply(node('thanks', 'Thank you, friend!'))),
    advance: vi.fn(async () => NONE),
    end: vi.fn(async () => NONE),
  } satisfies NpcDialogueApi;
  return api;
}

/** A behaviour factory that records what the runtime asks of each controller. */
function spyBehavior() {
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

function fakeScene() {
  const parent = new Group();
  const frames = new Set<(dt: number) => void>();
  let pose: PlayerPose | null = { x: 0, z: 20 };
  const stops = vi.fn();
  const scene: NpcHostScene = {
    parent,
    onFrame: (callback) => {
      frames.add(callback);
      return () => {
        stops();
        frames.delete(callback);
      };
    },
    playerPose: () => pose,
    isBlocked: () => false,
  };
  return {
    scene,
    parent,
    stops,
    frames,
    moveTo(next: PlayerPose | null) {
      pose = next;
      act(() => {
        for (const frame of [...frames]) frame(1 / 30);
      });
    },
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

interface Setup {
  api?: NpcApi;
  dialogueApi?: ReturnType<typeof fakeDialogueApi>;
  hintApi?: NpcHintApi;
  props?: Partial<UseNpcSceneHostOptions>;
}

function setup(options: Setup = {}) {
  const world = fakeScene();
  const behavior = spyBehavior();
  const api: NpcApi = options.api ?? {
    getCatalog: vi.fn(),
    getAreaNpcs: vi.fn(async () => SCENE),
    getPlaceNpcs: vi.fn(),
  };
  const dialogueApi = options.dialogueApi ?? fakeDialogueApi();
  const hintApi: NpcHintApi = options.hintApi ?? { hint: vi.fn() };
  const deps = {
    api,
    dialogueApi,
    hintApi,
    loadModel: async () => ({ scene: new Group(), animations: [] }),
    behaviorFactory: behavior.factory,
    speechSource: null,
  };
  const host: { current: NpcSceneHost | null } = { current: null };
  function Probe(props: Partial<UseNpcSceneHostOptions>) {
    const value = useNpcSceneHost({
      childId: CHILD,
      scope: { kind: 'area', regionId: AREA },
      scene: world.scene,
      reducedMotion: false,
      deps,
      ...options.props,
      ...props,
    });
    host.current = value;
    return (
      <>
        <p data-testid="status">{value.status}</p>
        {value.prompt}
        {value.panel}
      </>
    );
  }
  const view = render(<Probe />);
  return { world, behavior, api, dialogueApi, hintApi, host, view, Probe };
}

const npcRoots = (parent: Group) => parent.children.filter((c) => c.name.startsWith('npc:'));

describe('NPC scene host: lifecycle', () => {
  it('fetches the area, mounts the NPC under the scene, drives it per frame and disposes', async () => {
    const { world, api, host, view, behavior } = setup();
    await flush();
    expect(api.getAreaNpcs).toHaveBeenCalledWith(AREA, expect.any(AbortSignal));
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(npcRoots(world.parent)).toHaveLength(1);
    expect(host.current?.managedNpcIds).toEqual(new Set(['pirate-pip']));
    expect(world.frames.size).toBe(1);
    expect(host.current?.positionOf('pirate-pip')).toEqual({ x: 3, z: 6 });
    view.unmount();
    expect(world.stops).toHaveBeenCalledTimes(1);
    expect(world.frames.size).toBe(0);
    expect(npcRoots(world.parent)).toHaveLength(0);
    expect(behavior.calls).toContain('dispose');
  });

  it('waits for the scene before fetching anything', async () => {
    const { api } = setup({ props: { scene: null } });
    await flush();
    expect(api.getAreaNpcs).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('shows an empty scene, not an error, when nothing is published', async () => {
    const api: NpcApi = {
      getCatalog: vi.fn(),
      getAreaNpcs: vi.fn(async () => emptyScene('', AREA)),
      getPlaceNpcs: vi.fn(),
    };
    const { world, host } = setup({ api });
    await flush();
    expect(screen.getByTestId('status').textContent).toBe('empty');
    expect(npcRoots(world.parent)).toHaveLength(0);
    expect(host.current?.managedNpcIds.size).toBe(0);
    expect(host.current?.panel).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports failed (and serves no NPCs) when Django is off or the request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api: NpcApi = {
      getCatalog: vi.fn(),
      getAreaNpcs: vi.fn(async () => Promise.reject(new ApiError('disabled'))),
      getPlaceNpcs: vi.fn(),
    };
    const { world, host } = setup({ api });
    await flush();
    expect(screen.getByTestId('status').textContent).toBe('failed');
    expect(npcRoots(world.parent)).toHaveLength(0);
    expect(host.current?.managedNpcIds.size).toBe(0);
    warn.mockRestore();
  });

  it('greets on spawn through the dialogue API (on_spawn), once per placement', async () => {
    const { dialogueApi } = setup();
    await flush();
    const triggers = dialogueApi.start.mock.calls.map(([, request]) => request.trigger);
    expect(triggers).toEqual(['on_spawn']);
  });
});

describe('NPC scene host: prompt and conversation', () => {
  it('shows the Talk prompt between approach and leave', async () => {
    const { world } = setup();
    await flush();
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();
    world.moveTo({ x: 3, z: 7 });
    expect(screen.getByRole('button', { name: 'Talk to Pirate Pip' })).toBeTruthy();
    world.moveTo({ x: 3, z: 20 });
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();
  });

  it('starts, chooses and closes a conversation, interrupting and resuming the behaviour', async () => {
    const order: string[] = [];
    const onInteract = vi.fn(async () => void order.push('talked'));
    const dialogueApi = fakeDialogueApi(
      reply(ASK, [
        { choiceKey: 'yes', label: 'Yes, I will help!', action: 'NONE' },
        { choiceKey: 'later', label: 'Maybe later', action: 'END' },
      ]),
    );
    dialogueApi.start.mockImplementation(async (_npc, request) => {
      order.push(request.trigger);
      return request.trigger === 'on_interact'
        ? reply(ASK, [{ choiceKey: 'yes', label: 'Yes, I will help!', action: 'NONE' }])
        : NONE;
    });
    const { world, behavior } = setup({ dialogueApi, props: { onInteract } });
    await flush();
    world.moveTo({ x: 3, z: 7 });
    await userEvent.click(screen.getByRole('button', { name: 'Talk to Pirate Pip' }));
    await flush();
    // The world's own "talked" call finishes before the conversation is asked for.
    expect(order).toEqual(['on_spawn', 'talked', 'on_interact']);
    expect(onInteract).toHaveBeenCalledWith('pirate-pip', 'cove-pip');
    expect(screen.getByRole('dialog', { name: 'Pirate Pip' })).toBeTruthy();
    expect(screen.getByText('Will you help me?')).toBeTruthy(); // the caption, voice or not
    expect(behavior.calls).toContain('interrupt');
    expect(screen.queryByRole('button', { name: 'Talk to Pirate Pip' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await flush();
    expect(dialogueApi.choose).toHaveBeenCalledWith(
      'pirate-pip',
      CONVERSATION,
      'yes',
      expect.any(AbortSignal),
    );
    expect(screen.getByText('Thank you, friend!')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialogueApi.end).toHaveBeenCalledWith('pirate-pip', CONVERSATION);
    expect(behavior.calls.lastIndexOf('resume')).toBeGreaterThan(
      behavior.calls.lastIndexOf('interrupt'),
    );
  });

  it('a conversation that ends by itself resumes the behaviour and closes the panel', async () => {
    const { world, host, behavior, dialogueApi } = setup();
    await flush();
    act(() => void host.current?.interact('pirate-pip'));
    await flush();
    expect(screen.getByText('Ahoy!')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await flush();
    expect(dialogueApi.advance).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(behavior.calls.at(-1)).toBe('resume');
    world.moveTo({ x: 3, z: 7 });
    expect(screen.getByRole('button', { name: 'Talk to Pirate Pip' })).toBeTruthy();
  });

  it('walking away interrupts the conversation', async () => {
    const { world, dialogueApi } = setup();
    await flush();
    world.moveTo({ x: 3, z: 7 });
    await userEvent.click(screen.getByRole('button', { name: 'Talk to Pirate Pip' }));
    await flush();
    expect(screen.getByRole('dialog')).toBeTruthy();
    world.moveTo({ x: 3, z: 30 });
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialogueApi.end).toHaveBeenCalled();
  });

  it('a failed conversation shows the calm fallback line, never an error screen', async () => {
    const dialogueApi = fakeDialogueApi();
    dialogueApi.start.mockImplementation(async (_npc, request) => {
      if (request.trigger === 'on_interact') throw new ApiError('network');
      return NONE;
    });
    const { host } = setup({ dialogueApi });
    await flush();
    act(() => void host.current?.interact('pirate-pip'));
    await flush();
    expect(screen.getByText('Let us chat again in a little while.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hands an OFFER_QUEST choice to the world, once', async () => {
    const onQuestOffer = vi.fn();
    const dialogueApi = fakeDialogueApi(
      reply(ASK, [{ choiceKey: 'yes', label: 'Yes, I will help!', action: 'OFFER_QUEST' }]),
    );
    dialogueApi.choose.mockResolvedValue(
      reply(node('thanks', 'Thank you, friend!'), [], {
        questOffer: { questId: 'pips-missing-treasure' },
      }),
    );
    const { host } = setup({ dialogueApi, props: { onQuestOffer } });
    await flush();
    act(() => void host.current?.interact('pirate-pip'));
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await flush();
    expect(onQuestOffer).toHaveBeenCalledTimes(1);
    expect(onQuestOffer).toHaveBeenCalledWith('pips-missing-treasure', 'pirate-pip');
  });

  it('asks the hint route after a REQUEST_HINT choice and shows its words', async () => {
    const dialogueApi = fakeDialogueApi(
      reply(ASK, [{ choiceKey: 'help', label: 'Help me', action: 'REQUEST_HINT' }]),
    );
    dialogueApi.choose.mockResolvedValue(
      reply(node('hint', 'Count slowly.', { allowAiHint: true })),
    );
    const hintApi: NpcHintApi = {
      hint: vi.fn(async () => ({
        contractVersion: 1,
        hint: { text: 'Touch each coin as you count.', source: 'FALLBACK' as const, speech: null },
      })),
    };
    const { host } = setup({ dialogueApi, hintApi });
    await flush();
    act(() => void host.current?.interact('pirate-pip'));
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Help me' }));
    await flush();
    expect(hintApi.hint).toHaveBeenCalledWith('pirate-pip', CONVERSATION);
    expect(screen.getByText('Touch each coin as you count.')).toBeTruthy();
  });

  it('keeps the authored line when the hint route refuses', async () => {
    const dialogueApi = fakeDialogueApi(
      reply(ASK, [{ choiceKey: 'help', label: 'Help me', action: 'REQUEST_HINT' }]),
    );
    dialogueApi.choose.mockResolvedValue(reply(node('hint', 'Count slowly.')));
    const hintApi: NpcHintApi = {
      hint: vi.fn(async () => Promise.reject(new ApiError('conflict', { code: 'x' }))),
    };
    const { host } = setup({ dialogueApi, hintApi });
    await flush();
    act(() => void host.current?.interact('pirate-pip'));
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Help me' }));
    await flush();
    expect(screen.getByText('Count slowly.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports the Sound Manager NPC moments', async () => {
    const onSound = vi.fn();
    const dialogueApi = fakeDialogueApi();
    const { world } = setup({ dialogueApi, props: { onSound } });
    await flush();
    world.moveTo({ x: 3, z: 7 });
    await userEvent.click(screen.getByRole('button', { name: 'Talk to Pirate Pip' }));
    await flush();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    world.moveTo({ x: 3, z: 30 });
    const moments = onSound.mock.calls.map(([moment]) => moment);
    expect(moments).toEqual(['on_approach', 'on_interact', 'on_dialogue_start', 'on_exit']);
  });
});

describe('NPC scene host: play outcomes', () => {
  const answer = (overrides: Partial<AnswerOutcome> = {}): AnswerOutcome => ({
    attemptId: 'att-1',
    correct: true,
    feedback: {} as AnswerOutcome['feedback'],
    canRetry: false,
    chestOpened: true,
    newItems: [],
    rewardMessage: null,
    questUpdates: [],
    completionRewards: [],
    ...overrides,
  });

  it('reacts to every adventure event and says one line for the most important trigger', async () => {
    const { host, behavior, dialogueApi } = setup();
    await flush();
    act(() => host.current?.notifyPlay({ kind: 'answer', outcome: answer() }));
    await flush();
    expect(behavior.calls).toContain('react:answer.correct');
    expect(behavior.calls).toContain('react:treasure.found');
    const triggers = dialogueApi.start.mock.calls.map(([, request]) => request.trigger);
    expect(triggers).toEqual(['on_spawn', 'on_treasure_found']);
  });

  it('holds ambient lines while another panel is open, then says the latest one', async () => {
    const { host, dialogueApi, view, Probe } = setup({ props: { suspended: true } });
    await flush();
    act(() =>
      host.current?.notifyPlay({
        kind: 'answer',
        outcome: answer({ correct: false, chestOpened: false }),
      }),
    );
    act(() => host.current?.notifyPlay({ kind: 'answer', outcome: answer() }));
    await flush();
    expect(dialogueApi.start).not.toHaveBeenCalled();
    view.rerender(<Probe suspended={false} />);
    await flush();
    const triggers = dialogueApi.start.mock.calls.map(([, request]) => request.trigger);
    expect(triggers).toEqual(['on_treasure_found', 'on_spawn']);
  });

  it('queues triggers that arrive before the NPCs are loaded', async () => {
    let resolve!: (scene: NpcSceneResponse) => void;
    const api: NpcApi = {
      getCatalog: vi.fn(),
      getAreaNpcs: vi.fn(() => new Promise<NpcSceneResponse>((r) => (resolve = r))),
      getPlaceNpcs: vi.fn(),
    };
    const { host, dialogueApi } = setup({ api });
    await flush();
    act(() =>
      host.current?.notifyPlay({
        kind: 'session_upserted',
        result: { created: false, value: {} as never },
      }),
    );
    await act(async () => resolve(SCENE));
    await flush();
    const triggers = dialogueApi.start.mock.calls.map(([, request]) => request.trigger);
    expect(triggers[0]).toBe('on_return_visit');
  });
});
