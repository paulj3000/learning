import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Group } from 'three';
import { ApiError } from '../../../../../api/errors';
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
import { STORYKEEPER_CASTLE_INTERACTIONS, type WorldInteraction } from '../../../worldObjects';
import { STORYKEEPER_CASTLE_MANIFEST } from '../../runtime/manifests/storykeeperCastle';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import type { CastleTravelRefusal } from '../../castleLayout';
import { CastleTaleCompanion } from './CastleTaleCompanion';
import { castleTaleViewExtension } from './castleTaleViewExtension';
import { managedCastleNpcFor, resetCastleNpcHandover } from './castleNpcHandover';
import type { CastleQuillClip, CastleTaleSceneApi } from './castleTaleScene';
import { QUILL_CLIP_STATES } from './useCastleNpcs';

/**
 * Storykeeper's Castle with the NPC Manager (LAI-NPC-039): the castle mounts the shared NPC scene
 * host for its Place, exactly one Keeper Quill (the manifest Quill handed over and his talk
 * claimed while managed, both kept on every fallback), the conversation opens through the host,
 * progression goes through the castle's existing engines, the tale's start and completion
 * become play triggers, and everything is disposed when the child leaves. The NPC APIs, the
 * adventure reads, the legacy progression calls and the scene are fakes; the companion, the
 * host, the dialogue controller and the NPC runtime are the real ones.
 */

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

let activeSession: { id: string } | null = null;
vi.mock('../../../../adventures/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../adventures/api')>()),
  getActiveSession: vi.fn(async () => activeSession),
  listActionsForSessions: vi.fn(async () => []),
}));
// The tale's own session is the Adventure Engine's; a stub stands in, with a way to finish it.
vi.mock('./CastleTaleSession', () => ({
  CastleTaleSession: (props: { onComplete: () => void }) => (
    <div role="region" aria-label="The tale">
      <button type="button" onClick={props.onComplete}>
        Finish the tale
      </button>
    </div>
  ),
}));
vi.mock('./CastleSecretDoorStory', () => ({ CastleSecretDoorStory: () => null }));
vi.mock('./castleNpcProgress', () => ({
  recordLegacyMeeting: vi.fn(async () => undefined),
  acceptLegacyQuest: vi.fn(async () => true),
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

const progress = await import('./castleNpcProgress');

const CHILD = 'child-1';
const QUILL = 'keeper-quill';
const CONVERSATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CONFIG = STORYKEEPER_CASTLE_MANIFEST.extensions[0].config;
const TALK = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === 'talk-to-keeper-quill')!;
const TALE = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === 'castle-story-hall')!;
const GREETING =
  'Welcome to the castle library. Every story here is missing one thing: your ideas.';

const MANAGED_SCENE: NpcSceneResponse = {
  contractVersion: 1,
  release: 2,
  scope: { place: 'storykeeper-castle', area: null },
  characters: {
    [QUILL]: {
      npcId: QUILL,
      displayName: 'Keeper Quill',
      role: 'STORYTELLER',
      ageBands: [],
      personality: {},
      dialogueMode: 'AUTHORED',
      voiceProfile: null,
      defaultVariant: 'storykeeper',
      variants: [
        {
          variantKey: 'storykeeper',
          displayName: 'Storykeeper',
          model: { assetId: 'npc-quill', version: null },
          portrait: null,
          scale: 1,
          rotationOffsetY: 0,
          positionOffsetY: 0,
          animationMap: { idle: 'Idle', talk: 'Talk', celebrate: 'Celebrate' },
          extras: [],
        },
      ],
    },
  },
  placements: [
    {
      placementKey: 'castle-quill',
      npcId: QUILL,
      variant: 'storykeeper',
      behavior: null,
      position: { x: -4.5, y: 0, z: 0 },
      rotationY: -Math.PI / 2,
      scale: 1,
      interactionRadius: 2.5,
    },
  ],
};

function reply(text: string, choices: RuntimeChoice[] = [], extra = {}): InteractionResponse {
  return {
    contractVersion: 1,
    release: 2,
    npcId: QUILL,
    conversationId: CONVERSATION,
    dialogueKey: 'd',
    node: {
      nodeKey: text
        .slice(0, 6)
        .toLowerCase()
        .replace(/[^a-z]/g, '-'),
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
  release: 2,
  npcId: QUILL,
  conversationId: null,
  dialogueKey: null,
  node: null,
  choices: [],
  ended: true,
  questOffer: null,
};

const LINES: Partial<Record<string, InteractionResponse>> = {
  on_interact: reply(GREETING, [
    { choiceKey: 'yes', label: 'Yes, I will help!', action: 'OFFER_QUEST' },
    { choiceKey: 'visiting', label: 'I am just visiting.', action: 'END' },
  ]),
  on_adventure_complete: reply('The story you made is on my shelf now.'),
  on_return_visit: reply('Welcome back to the castle library. Your story is waiting for you.'),
};

function fakeDialogueApi() {
  return {
    start: vi.fn(
      async (_npc: string, request: InteractionStartRequest) =>
        LINES[request.trigger] ?? NO_DIALOGUE,
    ),
    choose: vi.fn(async () =>
      reply('Thank you! Walk into the story hall when you are ready to begin.', [], {
        questOffer: { questId: 'tell-a-story-together' },
      }),
    ),
    advance: vi.fn(async () => NO_DIALOGUE),
    end: vi.fn(async () => NO_DIALOGUE),
  } satisfies NpcDialogueApi;
}

function fakeScene() {
  const parent = new Group();
  const proxied = new Map<string, () => { x: number; z: number } | null>();
  const stops: (() => void)[] = [];
  const npcScene: NpcHostScene = {
    parent,
    onFrame: () => {
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    },
    playerPose: () => ({ x: 0, z: 30 }),
    isBlocked: () => false,
  };
  const scene = {
    ready: Promise.resolve(),
    showChosenHero: vi.fn(),
    showChosenSetting: vi.fn(),
    playQuillClip: vi.fn(),
    resetBindingPlates: vi.fn(),
    resetLibraryClues: vi.fn(),
    resetPatternLockRods: vi.fn(),
    showSecretDoorOpened: vi.fn(),
    showEaselPainting: vi.fn(),
    showStoryTold: vi.fn(),
    quillPositionReader: () => undefined,
    npcHostScene: () => npcScene,
    setNpcProxy: vi.fn(
      (entityId: string, follow: (() => { x: number; z: number } | null) | null) => {
        if (follow) proxied.set(entityId, follow);
        else proxied.delete(entityId);
      },
    ),
    isNpcProxied: (entityId: string) => proxied.has(entityId),
    setQuillGestureSink: vi.fn((sink: ((clip: CastleQuillClip, yaw: number) => void) | null) => {
      gesture.sink = sink;
    }),
    // Castle reboot members on main (secret passage, storybook, room travel): unused here.
    showSecretPassageOpened: vi.fn(),
    showStorybook: vi.fn(),
    currentRoomId: () => undefined,
    goToRoom: vi.fn((): CastleTravelRefusal => ({
      ok: false,
      reason: 'unknown-room',
      message: 'Not here.',
    })),
  } satisfies CastleTaleSceneApi;
  const gesture: { sink: ((clip: CastleQuillClip, yaw: number) => void) | null } = { sink: null };
  return { scene, parent, proxied, stops, gesture };
}

/** The view's part: claims go through `castle-tale`'s own `claimsInteraction`, like the view. */
const view: { open: ((interaction: WorldInteraction | null) => void) | null } = { open: null };
function Visit(props: { sceneApi: CastleTaleSceneApi }) {
  const [claimed, setClaimed] = useState<WorldInteraction | null>(null);
  const [open, setOpen] = useState<WorldInteraction | null>(null);
  view.open = (interaction) => {
    if (!interaction) {
      setClaimed(null);
      setOpen(null);
    } else if (
      castleTaleViewExtension.claimsInteraction(interaction, {
        ageBand: 'PATHFINDER',
        config: CONFIG,
      })
    ) {
      setClaimed(interaction);
    } else {
      setOpen(interaction); // the generic panel (legacy NpcConversation for Quill)
    }
  };
  const companionProps: LocationCompanionProps = {
    childId: CHILD,
    regionId: 'storykeeper-castle',
    ageBand: 'PATHFINDER',
    aiEnabled: false,
    config: CONFIG,
    bus: new WorldEngineEventBus(),
    sceneApi: props.sceneApi,
    worldState: { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] },
    claimedInteraction: claimed,
    openInteraction: open ?? claimed,
    onCloseInteraction: () => setClaimed(null),
    showToast: vi.fn(),
    setFocusLabel: vi.fn(),
    refreshWorld: vi.fn(async () => undefined),
  };
  return (
    <>
      <CastleTaleCompanion {...companionProps} />
      {open ? <p data-testid="legacy-panel">{open.id}</p> : null}
    </>
  );
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const triggers = () => dialogueApi.start.mock.calls.map(([, request]) => request.trigger);

beforeEach(() => {
  activeSession = null;
  dialogueApi = fakeDialogueApi();
  npcApi = {
    getCatalog: vi.fn(),
    getAreaNpcs: vi.fn(),
    getPlaceNpcs: vi.fn(async () => MANAGED_SCENE),
  };
  vi.mocked(progress.recordLegacyMeeting).mockClear();
  vi.mocked(progress.acceptLegacyQuest).mockClear();
});
afterEach(() => {
  resetCastleNpcHandover();
  resetSharedSoundManager();
});

describe('the castle mounts the shared NPC host for its Place', () => {
  it('asks the Place route and hands the manifest Quill over: exactly one Quill', async () => {
    const { scene, parent, proxied } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(npcApi.getPlaceNpcs).toHaveBeenCalledWith('storykeeper-castle', expect.any(AbortSignal));
    expect(npcApi.getAreaNpcs).not.toHaveBeenCalled();
    expect([...proxied.keys()]).toEqual([QUILL]);
    expect(proxied.get(QUILL)?.()).toEqual({ x: -4.5, z: 0 }); // follows the managed Quill
    expect(parent.children.filter((c) => c.name === 'npc:castle-quill')).toHaveLength(1);
    expect(managedCastleNpcFor(TALK)).toBe(QUILL);
  });

  it('talking to Quill opens the published conversation through the host, not the legacy panel', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => view.open?.(TALK));
    await settle();
    expect(screen.queryByTestId('legacy-panel')).toBeNull();
    expect(progress.recordLegacyMeeting).toHaveBeenCalledTimes(1);
    expect(progress.recordLegacyMeeting).toHaveBeenCalledWith(CHILD, QUILL);
    expect(triggers()).toContain('on_interact');
    expect(screen.getByText(GREETING)).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('accepts the offered quest through the castle quest flow, once', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => view.open?.(TALK));
    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await settle();
    expect(progress.acceptLegacyQuest).toHaveBeenCalledTimes(1);
    expect(progress.acceptLegacyQuest).toHaveBeenCalledWith(
      CHILD,
      'tell-a-story-together',
      QUILL,
      'PATHFINDER',
    );
  });

  it.each([
    ['no release', async () => ({ ...MANAGED_SCENE, release: 0, characters: {}, placements: [] })],
    ['Django off', async () => Promise.reject(new ApiError('disabled'))],
    ['a failed load', async () => Promise.reject(new ApiError('network'))],
  ])('keeps the legacy Quill and his conversation on %s', async (_label, getPlaceNpcs) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    npcApi = { getCatalog: vi.fn(), getAreaNpcs: vi.fn(), getPlaceNpcs: vi.fn(getPlaceNpcs) };
    const { scene, proxied } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(proxied.size).toBe(0);
    expect(scene.setNpcProxy).not.toHaveBeenCalled();
    expect(managedCastleNpcFor(TALK)).toBeNull();
    act(() => view.open?.(TALK));
    await settle();
    expect(screen.getByTestId('legacy-panel')).toHaveTextContent('talk-to-keeper-quill');
    expect(dialogueApi.start).not.toHaveBeenCalled();
    expect(progress.recordLegacyMeeting).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("forwards the castle's scripted Quill gestures to the managed Quill, and stops on leaving", async () => {
    const { scene, parent, gesture } = fakeScene();
    const visit = render(<Visit sceneApi={scene} />);
    await settle();
    expect(gesture.sink).toBeTypeOf('function');
    const root = parent.children.find((c) => c.name === 'npc:castle-quill');
    expect(root).toBeDefined();
    act(() => gesture.sink?.('Point', 1.25)); // the hint rung pointing at the mantel
    act(() => gesture.sink?.('Idle', 0));
    expect(QUILL_CLIP_STATES).toEqual({
      Idle: 'idle',
      Talk: 'talk',
      Point: 'point',
      ReactConcerned: 'sad',
      Celebrate: 'celebrate',
    });
    visit.unmount();
    expect(scene.setQuillGestureSink).toHaveBeenLastCalledWith(null);
    expect(gesture.sink).toBeNull();
  });

  it('gives the manifest Quill back and stops the host when the child leaves the castle', async () => {
    const { scene, parent, proxied, stops } = fakeScene();
    const visit = render(<Visit sceneApi={scene} />);
    await settle();
    expect(proxied.size).toBe(1);
    visit.unmount();
    expect(proxied.size).toBe(0);
    expect(scene.setNpcProxy).toHaveBeenLastCalledWith(QUILL, null);
    expect(parent.children.filter((c) => c.name.startsWith('npc:'))).toHaveLength(0);
    expect(stops.every((stop) => vi.mocked(stop).mock.calls.length > 0)).toBe(true);
    expect(managedCastleNpcFor(TALK)).toBeNull();
  });
});

describe('the castle progression is unchanged and its signals reach Quill', () => {
  it('starting the tale still claims the story hall, and its completion asks for Quill’s line', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => view.open?.(TALE));
    await settle();
    expect(screen.getByRole('region', { name: 'The tale' })).toBeInTheDocument();
    // Held while the tale is on screen.
    expect(triggers()).not.toContain('on_adventure_start');
    await userEvent.click(screen.getByRole('button', { name: 'Finish the tale' }));
    await settle();
    expect(triggers().filter((t) => t === 'on_adventure_complete')).toHaveLength(1);
    expect(await screen.findByText('The story you made is on my shelf now.')).toBeInTheDocument();
  });

  it('a session left open resumes as before and is a return visit for Quill', async () => {
    activeSession = { id: 'session-1' };
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    expect(screen.getByRole('region', { name: 'The tale' })).toBeInTheDocument();
    expect(triggers()).not.toContain('on_return_visit'); // held while the tale is open
    await userEvent.click(screen.getByRole('button', { name: 'Finish the tale' }));
    await settle();
    // The completion outranks the waiting return visit: one line, the most important one.
    expect(triggers()).toContain('on_adventure_complete');
    expect(triggers()).not.toContain('on_return_visit');
  });

  it('a tap on Quill mid-tale is let go calmly, never a hidden conversation', async () => {
    const { scene } = fakeScene();
    render(<Visit sceneApi={scene} />);
    await settle();
    act(() => view.open?.(TALE));
    await settle();
    act(() => view.open?.(TALK));
    await settle();
    expect(triggers()).not.toContain('on_interact');
    expect(screen.queryByTestId('legacy-panel')).toBeNull();
  });
});
