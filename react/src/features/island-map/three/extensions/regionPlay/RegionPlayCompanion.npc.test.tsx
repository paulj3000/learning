import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Group } from 'three';
import { ApiError } from '../../../../../api/errors';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { PlayApi } from '../../../../../api/play/playApi';
import { resetSharedSoundManager } from '../../../../../audio/sharedSoundManager';
import type { NpcApi } from '../../../../npc-manager/api/npcApi';
import type {
  InteractionResponse,
  InteractionStartRequest,
  NpcSceneResponse,
  RuntimeChoice,
} from '../../../../npc-manager/contracts/types';
import type { NpcDialogueApi } from '../../../../npc-manager/dialogue/npcDialogueApi';
import type { NpcHostScene } from '../../../../npc-manager/host';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { PLAY_COPY } from '../../../../region-play/regionPlayUi';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { setSoundSink, type SoundCue, type SoundPlace } from '../../../../region-play/soundCues';
import {
  CHILD_A,
  SESSION_ID,
  bootstrapJson,
  challengeJson,
  outcomeJson,
  progressJson,
  questJson,
  sessionJson,
} from '../../../../../test/playFixtures';
import type { WorldInteraction } from '../../../worldObjects';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import { RegionPlayCompanion } from './RegionPlayCompanion';
import type { RegionPlaySceneApi } from './regionPlayScene';

/**
 * Treasure Rush with the NPC Manager (LAI-NPC-010, -015, -016, -018): exactly one Pip (the
 * manifest Pip is handed over when the NPC Manager serves him, kept when it does not), one
 * reward per outcome, NPC triggers for each play outcome, and session start and resume
 * unchanged. The play API, the NPC APIs and the scene are fakes; the companion, the NPC scene
 * host, the dialogue controller and the NPC runtime are the real ones.
 */

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../../../../auth/AuthContext', () => ({ useAuth: () => ({ refresh: vi.fn() }) }));

let playApi: PlayApi;
vi.mock('../../../../../api/play/playApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../api/play/playApi')>()),
  playApiFor: () => playApi,
}));
let npcApi: NpcApi;
vi.mock('../../../../npc-manager/api/npcApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../npc-manager/api/npcApi')>()),
  npcApiFor: () => npcApi,
}));
let dialogueApi: ReturnType<typeof fakeDialogueApi>;
vi.mock('../../../../npc-manager/dialogue/npcDialogueApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../npc-manager/dialogue/npcDialogueApi')>()),
  npcDialogueApiFor: () => dialogueApi,
}));
vi.mock('../../../../npc-manager/api/npcModelLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../npc-manager/api/npcModelLoader')>()),
  npcModelLoaderFor: () => async () => ({ scene: new Group(), animations: [] }),
}));
vi.mock('../../../../../api/speech/speechApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../api/speech/speechApi')>()),
  speechApiFor: () => null,
}));

const REGION = 'treasure-rush-cove';
const CHEST = `${REGION}:chest:cove-chest`;
const PIP = `${REGION}:talk:cove-pip`;
const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const bootstrap = (overrides = {}) => read(bootstrapJson(overrides), parse.regionBootstrap);
const config = buildRegionManifest(toRegionSceneModel(bootstrap()), {
  worldSlug: 'learning-adventure-island',
}).manifest.extensions[0].config;

const MANAGED_SCENE: NpcSceneResponse = {
  contractVersion: 1,
  release: 1,
  scope: { place: 'pirate-builder-bay', area: REGION },
  characters: {
    'pirate-pip': {
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
    },
  },
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

function interactionReply(
  text: string,
  choices: RuntimeChoice[] = [],
  extra: Partial<InteractionResponse> = {},
): InteractionResponse {
  return {
    contractVersion: 1,
    release: 1,
    npcId: 'pirate-pip',
    conversationId: CONVERSATION,
    dialogueKey: 'd',
    node: {
      nodeKey:
        text
          .slice(0, 8)
          .toLowerCase()
          .replace(/[^a-z]/g, '-') || 'n',
      text,
      emotion: 'happy',
      animationState: null,
      audio: null,
      speech: null,
      allowAiHint: false,
    },
    choices,
    ended: false,
    questOffer: null,
    ...extra,
  };
}

const NO_DIALOGUE: InteractionResponse = {
  contractVersion: 1,
  release: 1,
  npcId: 'pirate-pip',
  conversationId: null,
  dialogueKey: null,
  node: null,
  choices: [],
  ended: true,
  questOffer: null,
};

/** Pip's published lines by trigger, like the seeded content (only what the tests need). */
const LINES: Partial<Record<string, InteractionResponse>> = {
  on_interact: interactionReply('Pip lost four treasures around the cove. Will you help me?', [
    { choiceKey: 'yes', label: 'Yes, I will help!', action: 'OFFER_QUEST' },
    { choiceKey: 'later', label: 'Maybe later', action: 'END' },
  ]),
  on_treasure_found: interactionReply('Arr, you found treasure! Keep going, friend.'),
  on_return_visit: interactionReply('Ahoy again, friend! Welcome back to the cove.'),
};

function fakeDialogueApi() {
  return {
    start: vi.fn(
      async (_npc: string, request: InteractionStartRequest) =>
        LINES[request.trigger] ?? NO_DIALOGUE,
    ),
    choose: vi.fn(async () =>
      interactionReply('Thank you, friend! The treasure is waiting for you.', [], {
        questOffer: { questId: 'treasure-rush-cove' },
      }),
    ),
    advance: vi.fn(async () => NO_DIALOGUE),
    end: vi.fn(async () => NO_DIALOGUE),
  } satisfies NpcDialogueApi;
}

function fakePlayApi(overrides: Partial<PlayApi> = {}): PlayApi {
  let started = false;
  return {
    getRegion: vi.fn(async () =>
      bootstrap({ quests: [questJson()], session: started ? sessionJson() : null }),
    ),
    startSession: vi.fn(async () => {
      started = true;
      return { value: read(sessionJson(), parse.session), created: true };
    }),
    getSession: vi.fn(),
    changeSession: vi.fn(async () => read(sessionJson(), parse.session)),
    acceptQuest: vi.fn(async () => ({
      value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest),
      created: true,
    })),
    requestChestChallenge: vi.fn(async () => ({
      value: read(challengeJson(), parse.issuedChallenge),
      created: true,
    })),
    submitAnswer: vi.fn(async () => read(outcomeJson(true), parse.answerOutcome)),
    getProgress: vi.fn(async () =>
      read({ ...progressJson(), inventory: [] }, parse.playerProgress),
    ),
    startLaunchPoint: vi.fn(),
    solvePuzzle: vi.fn(),
    collectPickup: vi.fn(),
    talkToNpc: vi.fn(async () => ({ flagsSet: [], questUpdates: [], completionRewards: [] })),
    ...overrides,
  };
}

function fakeScene() {
  const parent = new Group();
  const proxied = new Map<string, () => { x: number; z: number } | null>();
  const npcScene: NpcHostScene = {
    parent,
    onFrame: () => () => undefined,
    playerPose: () => ({ x: 0, z: 30 }),
    isBlocked: () => false,
  };
  const scene: RegionPlaySceneApi = {
    setChestOpen: vi.fn(),
    isChestOpen: () => false,
    effects: {
      setChangeKeys: vi.fn(),
      useReturn: vi.fn(() => false),
      previewSteamCleared: vi.fn(),
      safeCheckpoint: () => null,
      subscribe: () => () => undefined,
    },
    puzzles: {
      showArrangement: vi.fn(),
      showValveTurns: vi.fn(),
      discover: vi.fn(async () => undefined),
      setVisible: vi.fn(),
    },
    setChestLock: vi.fn(),
    setPickupCollected: vi.fn(),
    setRuneNumbers: vi.fn(),
    setUnlocked: vi.fn(() => true),
    isUnlocked: () => false,
    pressRune: vi.fn(),
    flashRunes: vi.fn(),
    reactNpc: vi.fn(),
    entityPositionReader: vi.fn(() => undefined),
    unlockPositionReader: vi.fn(() => undefined),
    listenerSource: () => ({ matrixWorld: { elements: new Array(16).fill(0) } }),
    onFrame: vi.fn(() => () => undefined),
    npcHostScene: () => npcScene,
    setNpcProxy: vi.fn((entityId: string, follow) => {
      if (follow) proxied.set(entityId, follow);
      else proxied.delete(entityId);
    }),
    isNpcProxied: (entityId) => proxied.has(entityId),
  };
  return { scene, parent, proxied };
}

function interaction(id: string): WorldInteraction {
  return {
    id,
    type: 'OBJECT',
    trigger: 'TAP',
    title: 't',
    targetId: 'x',
    action: { kind: 'SHOW_MESSAGE', message: 'm' },
  };
}

/** The view's part: a claimed interaction stays open until the companion closes it. */
const claim: { open: ((id: string | null) => void) | null } = { open: null };
function Visit(props: { sceneApi: RegionPlaySceneApi }) {
  const [claimed, setClaimed] = useState<WorldInteraction | null>(null);
  claim.open = (id) => setClaimed(id ? interaction(id) : null);
  const companionProps: LocationCompanionProps = {
    childId: CHILD_A,
    regionId: REGION,
    ageBand: 'PATHFINDER',
    aiEnabled: false,
    config,
    bus: new WorldEngineEventBus(),
    sceneApi: props.sceneApi,
    worldState: { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] },
    claimedInteraction: claimed,
    openInteraction: null,
    onCloseInteraction: () => setClaimed(null),
    showToast: vi.fn(),
    setFocusLabel: vi.fn(),
    refreshWorld: vi.fn(async () => undefined),
  };
  return <RegionPlayCompanion {...companionProps} />;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const triggers = () => dialogueApi.start.mock.calls.map(([, request]) => request.trigger);

function managed() {
  npcApi = {
    getCatalog: vi.fn(),
    getAreaNpcs: vi.fn(async () => MANAGED_SCENE),
    getPlaceNpcs: vi.fn(),
  };
}

beforeEach(() => {
  playApi = fakePlayApi();
  dialogueApi = fakeDialogueApi();
  managed();
});
afterEach(() => {
  setSoundSink(null);
  resetSharedSoundManager();
});

describe('exactly one Pip', () => {
  it('hands the manifest Pip over when the NPC Manager serves him', async () => {
    const { scene, parent, proxied } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(npcApi.getAreaNpcs).toHaveBeenCalledWith(REGION, expect.any(AbortSignal));
    expect([...proxied.keys()]).toEqual(['cove-pip']);
    expect(proxied.get('cove-pip')?.()).toEqual({ x: 3, z: 6 }); // follows the managed Pip
    expect(parent.children.filter((c) => c.name === 'npc:cove-pip')).toHaveLength(1);
  });

  it('talking to Pip runs the published dialogue, never PipDialog, with one talk call', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => claim.open?.(PIP));
    await settle();
    expect(playApi.talkToNpc).toHaveBeenCalledTimes(1);
    expect(playApi.talkToNpc).toHaveBeenCalledWith(SESSION_ID, 'cove-pip', expect.any(AbortSignal));
    expect(triggers()).toContain('on_interact');
    expect(
      screen.getByText('Pip lost four treasures around the cove. Will you help me?'),
    ).toBeInTheDocument();
    // The legacy dialog is not shown.
    expect(document.getElementById('region-play-npc-title')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(scene.reactNpc).not.toHaveBeenCalled(); // the hidden manifest Pip never gestures
  });

  it('accepts the offered quest through the existing accept flow, once', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => claim.open?.(PIP));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await settle();
    expect(playApi.acceptQuest).toHaveBeenCalledTimes(1);
    expect(playApi.acceptQuest).toHaveBeenCalledWith('treasure-rush-cove', expect.any(AbortSignal));
  });

  it.each([
    ['no release', async () => ({ ...MANAGED_SCENE, release: 0, characters: {}, placements: [] })],
    ['Django off', async () => Promise.reject(new ApiError('disabled'))],
    ['a failed load', async () => Promise.reject(new ApiError('network'))],
  ])('keeps the legacy Pip and PipDialog on %s', async (_label, getAreaNpcs) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    npcApi = { getCatalog: vi.fn(), getAreaNpcs: vi.fn(getAreaNpcs), getPlaceNpcs: vi.fn() };
    const { scene, proxied } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(proxied.size).toBe(0);
    expect(scene.setNpcProxy).not.toHaveBeenCalled();
    act(() => claim.open?.(PIP));
    await settle();
    expect(await screen.findByText(/Will you help me\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PLAY_COPY.pipAccept })).toBeInTheDocument();
    expect(document.getElementById('region-play-npc-title')).not.toBeNull();
    expect(playApi.talkToNpc).toHaveBeenCalledTimes(1);
    expect(dialogueApi.start).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('play outcomes become NPC triggers, with rewards unchanged', () => {
  it('starts a session once and greets the adventure start', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(playApi.startSession).toHaveBeenCalledTimes(1);
    expect(triggers()).toEqual(expect.arrayContaining(['on_adventure_start', 'on_spawn']));
  });

  it('resumes an open session as before and welcomes the returning player', async () => {
    playApi = fakePlayApi({
      getRegion: vi.fn(async () => bootstrap({ quests: [questJson()], session: sessionJson() })),
      startSession: vi.fn(async () => ({
        value: read(sessionJson(), parse.session),
        created: false,
      })),
    });
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(playApi.startSession).not.toHaveBeenCalled();
    // A session already in the bootstrap is resumed without a call: no resume outcome to report.
    expect(triggers()).not.toContain('on_adventure_start');
  });

  it('reports a resumed session (200) as a return visit', async () => {
    playApi = fakePlayApi({
      startSession: vi.fn(async () => ({
        value: read(sessionJson(), parse.session),
        created: false,
      })),
    });
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(playApi.startSession).toHaveBeenCalledTimes(1);
    expect(triggers()).toContain('on_return_visit');
    expect(triggers()).not.toContain('on_adventure_start');
    expect(
      await screen.findByText('Ahoy again, friend! Welcome back to the cove.'),
    ).toBeInTheDocument();
  });

  it('one answer: one submit, one reveal, then Pip speaks once the reveal is closed', async () => {
    playApi = fakePlayApi({
      submitAnswer: vi.fn(async () =>
        read(outcomeJson(true, { questUpdates: [] }), parse.answerOutcome),
      ),
    });
    const heard: { cue: SoundCue; at?: SoundPlace }[] = [];
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    setSoundSink((cue, at) => heard.push({ cue, at }));
    act(() => claim.open?.(CHEST));
    await screen.findByRole('button', { name: '5' });
    expect(triggers()).not.toContain('on_challenge_start'); // held while the chest is open
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    const reveal = await screen.findByRole('dialog', { name: PLAY_COPY.chestOpened });
    expect(reveal).toHaveTextContent('Golden Doubloon');
    expect(triggers()).not.toContain('on_treasure_found'); // never on top of the reveal
    await userEvent.click(screen.getByRole('button', { name: PLAY_COPY.keepExploring }));
    await settle();
    expect(playApi.submitAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: PLAY_COPY.chestOpened })).toBeNull();
    // The answer's most important trigger, once (it outranks the challenge and the answer).
    expect(triggers().filter((t) => t === 'on_treasure_found')).toHaveLength(1);
    expect(triggers()).not.toContain('on_challenge_start');
    expect(
      await screen.findByText('Arr, you found treasure! Keep going, friend.'),
    ).toBeInTheDocument();
    // The reward moments sounded once each; the NPC's talk is an NPC moment for Pip.
    expect(heard.filter((h) => h.cue === 'answerRight')).toHaveLength(1);
    expect(heard.filter((h) => h.cue === 'chestOpen')).toHaveLength(1);
    expect(heard).toContainEqual({ cue: 'npcTalk', at: { npcId: 'pirate-pip' } });
    // Nothing on the NPC side asked for a reward, a quest or a pickup.
    expect(playApi.acceptQuest).not.toHaveBeenCalled();
    expect(playApi.collectPickup).not.toHaveBeenCalled();
    expect(dialogueApi.choose).not.toHaveBeenCalled();
  });

  it('a wrong answer asks Pip for a hint line (on_incorrect_answer) after the chest closes', async () => {
    playApi = fakePlayApi({
      submitAnswer: vi.fn(async () => read(outcomeJson(false), parse.answerOutcome)),
    });
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => claim.open?.(CHEST));
    await userEvent.click(await screen.findByRole('button', { name: '4' }));
    await screen.findByText(PLAY_COPY.wrong);
    act(() => claim.open?.(null));
    await settle();
    expect(triggers().filter((t) => t === 'on_incorrect_answer')).toHaveLength(1);
    expect(playApi.submitAnswer).toHaveBeenCalledTimes(1);
  });

  it('a talk that completes the quest shows the finale once and asks for on_quest_complete', async () => {
    playApi = fakePlayApi({
      talkToNpc: vi.fn(async () => ({
        flagsSet: [],
        questUpdates: [
          {
            questId: 'treasure-rush-cove',
            status: 'COMPLETED' as const,
            currentStageId: 'open-the-chest',
            justCompleted: true,
            newlyCompletedObjectiveIds: [],
          },
        ],
        completionRewards: [],
      })),
    });
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => claim.open?.(PIP));
    await settle();
    expect(screen.getAllByRole('dialog', { name: PLAY_COPY.finaleTitle })).toHaveLength(1);
    expect(playApi.talkToNpc).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: PLAY_COPY.keepExploring }));
    await settle();
    // The conversation the tap started shows now; the quest's line waits until it closes.
    expect(triggers()).not.toContain('on_quest_complete');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    await waitFor(() => expect(triggers()).toContain('on_quest_complete'));
  });
});
