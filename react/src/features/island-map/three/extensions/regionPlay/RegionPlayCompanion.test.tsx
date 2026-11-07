import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../../../api/errors';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { PlayApi } from '../../../../../api/play/playApi';
import type { AnswerOutcome, LaunchStart, Upserted } from '../../../../../api/play/types';
import { setSoundSink, type SoundCue } from '../../../../region-play/soundCues';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import { PLAY_COPY } from '../../../../region-play/regionPlayUi';
import {
  ATTEMPT_ID,
  CHILD_A,
  CHILD_B,
  bootstrapJson,
  challengeJson,
  launchPointJson,
  launchStartJson,
  signpostJson,
  outcomeJson,
  progressJson,
  pipsBootstrapJson,
  questJson,
  SESSION_ID,
  sessionJson,
} from '../../../../../test/playFixtures';
import type { WorldInteraction } from '../../../worldObjects';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import { SOURCE_WORLD_EXTENSIONS } from '..';
import { SOURCE_VIEW_EXTENSIONS } from '../viewExtensions';
import { RegionPlayCompanion } from './RegionPlayCompanion';
import { regionPlayViewExtension } from './regionPlayViewExtension';
import type { RegionPlaySceneApi } from './regionPlayScene';

const refresh = vi.fn(async () => undefined);
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('../../../../auth/AuthContext', () => ({ useAuth: () => ({ refresh }) }));

const apis = new Map<string, PlayApi>();
vi.mock('../../../../../api/play/playApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../api/play/playApi')>()),
  playApiFor: (childId: string) => apis.get(childId),
}));

const REGION = 'treasure-rush-cove';
const CHEST = `${REGION}:chest:cove-chest`;
const PIP = `${REGION}:talk:cove-pip`;
const bootstrap = (overrides = {}, chest = {}) =>
  read(bootstrapJson(overrides, chest), parse.regionBootstrap);
const outcome = (correct: boolean, overrides = {}) =>
  read(outcomeJson(correct, overrides), parse.answerOutcome);
const challenge = (overrides = {}) => ({
  value: read(challengeJson(overrides), parse.issuedChallenge),
  created: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Like the server: once a session is started, the region bootstrap reports it as open. */
function fakeApi(overrides: Partial<PlayApi> = {}): PlayApi {
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
    changeSession: vi.fn(async (_id, action) =>
      read(
        sessionJson(action === 'complete' ? { status: 'COMPLETED', completedAt: 'x' } : {}),
        parse.session,
      ),
    ),
    acceptQuest: vi.fn(async () => ({
      value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest),
      created: true,
    })),
    requestChestChallenge: vi.fn(async () => challenge()),
    submitAnswer: vi.fn(async () => outcome(true)),
    getProgress: vi.fn(async () =>
      read({ ...progressJson(), inventory: [] }, parse.playerProgress),
    ),
    startLaunchPoint: vi.fn(),
    collectPickup: vi.fn(),
    talkToNpc: vi.fn(async () => ({ flagsSet: [], questUpdates: [], completionRewards: [] })),
    ...overrides,
  };
}

function fakeScene(open = false) {
  const drawn = new Map([['cove-chest', open]]);
  const scene: RegionPlaySceneApi & { setChestOpen: ReturnType<typeof vi.fn> } = {
    setChestOpen: vi.fn((id: string, value: boolean) => void drawn.set(id, value)),
    isChestOpen: (id: string) => drawn.get(id),
    setChestLock: vi.fn(),
    setPickupCollected: vi.fn(),
    setRuneNumbers: vi.fn(),
    setUnlocked: vi.fn((_unlocked: boolean) => true),
    isUnlocked: () => false,
    pressRune: vi.fn(),
    flashRunes: vi.fn(),
    reactNpc: vi.fn(),
    entityPositionReader: vi.fn(() => undefined),
    unlockPositionReader: vi.fn(() => undefined),
    listenerSource: () => ({ matrixWorld: { elements: new Array(16).fill(0) } }),
    onFrame: vi.fn(() => () => undefined),
  };
  return scene;
}

const config = buildRegionManifest(toRegionSceneModel(bootstrap()), {
  worldSlug: 'learning-adventure-island',
}).manifest.extensions[0].config;

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

function props(overrides: Partial<LocationCompanionProps> = {}): LocationCompanionProps {
  return {
    childId: CHILD_A,
    regionId: REGION,
    ageBand: 'PATHFINDER',
    aiEnabled: false,
    config,
    bus: new WorldEngineEventBus(),
    sceneApi: fakeScene(),
    worldState: { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] },
    claimedInteraction: null,
    openInteraction: null,
    onCloseInteraction: vi.fn(),
    showToast: vi.fn(),
    setFocusLabel: vi.fn(),
    limitReached: false,
    refreshWorld: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Renders with the chest claimed and waits for the server's challenge to show. */
async function atTheChest(api: PlayApi, extra: Partial<LocationCompanionProps> = {}) {
  apis.set(CHILD_A, api);
  const view = render(
    <RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST), ...extra })} />,
  );
  await screen.findByRole('button', { name: '5' });
  return view;
}

afterEach(() => setSoundSink(null));

/** Replaces the game's own sound sink with one that writes down the moments it is given (SM-P3). */
function listen(): SoundCue[] {
  const heard: SoundCue[] = [];
  setSoundSink((cue) => heard.push(cue));
  return heard;
}

beforeEach(() => {
  apis.clear();
  refresh.mockClear();
  navigate.mockClear();
});

describe('entering the cove', () => {
  it('starts or resumes the session once, and never accepts a quest', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    const view = render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(api.startSession).toHaveBeenCalledTimes(1));
    view.rerender(<RegionPlayCompanion {...props()} />);
    await act(async () => undefined);
    expect(api.startSession).toHaveBeenCalledTimes(1);
    expect(api.acceptQuest).not.toHaveBeenCalled();
  });

  it('resumes an open session instead of starting another', async () => {
    const api = fakeApi({ getRegion: vi.fn(async () => bootstrap({ session: sessionJson() })) });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(api.getRegion).toHaveBeenCalled());
    await act(async () => undefined);
    expect(api.startSession).not.toHaveBeenCalled();
  });

  it('draws a chest open when the server says it is, and only then', async () => {
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) }));
    const scene = fakeScene(false);
    render(<RegionPlayCompanion {...props({ sceneApi: scene })} />);
    await waitFor(() => expect(scene.setChestOpen).toHaveBeenCalledWith('cove-chest', true));

    const closedApi = fakeApi();
    apis.set(CHILD_B, closedApi);
    const untouched = fakeScene(false);
    render(<RegionPlayCompanion {...props({ childId: CHILD_B, sceneApi: untouched })} />);
    await waitFor(() => expect(closedApi.startSession).toHaveBeenCalled());
    expect(untouched.setChestOpen).not.toHaveBeenCalled();
  });

  it('completes the session at the calm stop', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    const view = render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    view.rerender(<RegionPlayCompanion {...props({ limitReached: true })} />);
    await waitFor(() =>
      expect(api.changeSession).toHaveBeenCalledWith(
        expect.any(String),
        'complete',
        expect.any(AbortSignal),
      ),
    );
  });
});

describe('talking to Pip', () => {
  it('shows Pip’s offer from the server and accepts only when the child says yes', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    const dialog = await screen.findByRole('dialog', { name: 'Pirate Pip' });
    expect(dialog).toHaveTextContent(
      'Find the treasure chest in the cove and open it with a number puzzle.',
    );
    expect(api.acceptQuest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await waitFor(() =>
      expect(api.acceptQuest).toHaveBeenCalledWith('treasure-rush-cove', expect.any(AbortSignal)),
    );
    expect(await screen.findByText(/Quest accepted!/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Treasure Rush' })).toHaveTextContent(
      'Open the treasure chest in the cove',
    );
  });

  it('sends one request for a double-tapped accept', async () => {
    const pending = deferred<Awaited<ReturnType<PlayApi['acceptQuest']>>>();
    const api = fakeApi({ acceptQuest: vi.fn(() => pending.promise) });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    const accept = await screen.findByRole('button', { name: 'Yes, I will help!' });
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    await act(async () => {
      accept.click();
      accept.click();
    });
    expect(api.acceptQuest).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve({
        value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest),
        created: true,
      }),
    );
  });

  it('shows an accepted quest as in progress and a finished one as done on a later visit', async () => {
    const active = questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' });
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [active] })) }));
    const view = render(
      <RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />,
    );
    expect(
      await screen.findByText('The treasure is waiting for you. Here is what to do.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Quest accepted!/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, I will help!' })).not.toBeInTheDocument();
    view.unmount();

    const done = questJson({
      status: 'COMPLETED',
      currentStageId: 'open-the-chest',
      completedAt: '2026-10-24T18:02:41Z',
      stages: [
        {
          ...questJson().stages[0],
          complete: true,
          objectives: [{ ...questJson().stages[0].objectives[0], complete: true }],
        },
      ],
    });
    apis.set(CHILD_B, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [done] })) }));
    render(
      <RegionPlayCompanion
        {...props({ childId: CHILD_B, claimedInteraction: interaction(PIP) })}
      />,
    );
    expect(
      await screen.findByText('You found the treasure! Thank you, friend.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Treasure Rush' })).toHaveTextContent('Done');
  });

  it('says hello when Pip has nothing to offer', async () => {
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [] })) }));
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    expect(await screen.findByText('Ahoy! Enjoy the cove.')).toBeInTheDocument();
  });
});

describe('the chest', () => {
  it('asks the server for the challenge and shows its picture, question, and choices', async () => {
    const api = fakeApi();
    await atTheChest(api);
    expect(api.requestChestChallenge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: '2 coins and 3 coins more.' })).toBeInTheDocument();
    expect(screen.getByText('How many coins are there altogether?')).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['3', '4', '5', '6']),
    );
  });

  it('takes a typed answer for a number-input challenge', async () => {
    const typed = challenge({
      challenge: {
        skillId: 'subtraction-within-ten',
        operation: 'SUBTRACT',
        operands: [7, 3],
        responseMode: 'NUMBER_INPUT',
        choices: [],
      },
    });
    const api = fakeApi({
      requestChestChallenge: vi.fn(async () => typed),
      submitAnswer: vi.fn(async () => outcome(false)),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    const input = await screen.findByLabelText('Your answer');
    expect(screen.getByText('How many coins are left?')).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open it!' });
    expect(open).toBeDisabled();
    await userEvent.type(input, '4');
    await userEvent.click(open);
    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith(
        typed.value.attemptId,
        { answer: 4, hintLevel: 0 },
        expect.any(AbortSignal),
      ),
    );
  });

  it('gives a hint that never says the answer, and reports how many were used', async () => {
    const api = fakeApi();
    await atTheChest(api);
    await userEvent.click(screen.getByRole('button', { name: 'Help me' }));
    expect(screen.getByText('Count the first pile of coins.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith(
        expect.any(String),
        { answer: 5, hintLevel: 1 },
        expect.any(AbortSignal),
      ),
    );
  });

  it('cheers a wrong answer on and offers another challenge from the server', async () => {
    const api = fakeApi({ submitAnswer: vi.fn(async () => outcome(false)) });
    await atTheChest(api);
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    expect(
      await screen.findByText('Not quite. The lock is still shut. Let us try another one!'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Golden Doubloon')).not.toBeInTheDocument();
    vi.mocked(api.requestChestChallenge).mockResolvedValueOnce(
      challenge({ attemptId: 'attempt-2', attemptNumber: 2 }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: '5' })).toBeInTheDocument();
    expect(api.requestChestChallenge).toHaveBeenCalledTimes(2);
  });

  it('sends a double-tapped answer once and disables the choices while checking', async () => {
    const pending = deferred<AnswerOutcome>();
    const api = fakeApi({ submitAnswer: vi.fn(() => pending.promise) });
    await atTheChest(api);
    const five = screen.getByRole('button', { name: '5' });
    await act(async () => {
      five.click();
      five.click();
    });
    expect(api.submitAnswer).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled();
    expect(screen.getByText('Checking...')).toBeInTheDocument();
    await act(async () => pending.resolve(outcome(false)));
  });

  it('shows no reward, open chest, or quest change before the server confirms', async () => {
    const pending = deferred<AnswerOutcome>();
    const scene = fakeScene(false);
    const api = fakeApi({ submitAnswer: vi.fn(() => pending.promise) });
    await atTheChest(api, { sceneApi: scene });
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.queryByText('Golden Doubloon')).not.toBeInTheDocument();
    expect(scene.setChestOpen).not.toHaveBeenCalled();
    await act(async () => pending.resolve(outcome(false)));
    expect(screen.queryByText('Golden Doubloon')).not.toBeInTheDocument();
    expect(scene.setChestOpen).not.toHaveBeenCalled();
  });

  it('on the server’s yes: opens the chest in the world, reveals the doubloon, and completes the quest', async () => {
    const scene = fakeScene(false);
    const api = fakeApi();
    await atTheChest(api, { sceneApi: scene });
    vi.mocked(api.getRegion).mockResolvedValue(
      bootstrap(
        {
          session: sessionJson(),
          quests: [questJson({ status: 'COMPLETED', currentStageId: 'open-the-chest' })],
        },
        { isOpen: true },
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    const reveal = await screen.findByRole('dialog', { name: 'Click! The chest is open!' });
    expect(reveal).toHaveTextContent('Golden Doubloon');
    expect(reveal).toHaveTextContent('You opened the chest and found a Golden Doubloon!');
    expect(reveal).toHaveTextContent('Quest complete! Treasure Rush');
    await waitFor(() => expect(scene.setChestOpen).toHaveBeenCalledWith('cove-chest', true));
    await waitFor(() => expect(api.getProgress).toHaveBeenCalledTimes(2)); // refreshed after the reward
  });

  it('reveals the reward once, and never for a replayed answer', async () => {
    const onCloseInteraction = vi.fn();
    const api = fakeApi();
    const view = await atTheChest(api, { onCloseInteraction });
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await screen.findByRole('dialog', { name: 'Click! The chest is open!' });
    await userEvent.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(onCloseInteraction).toHaveBeenCalled();
    view.rerender(
      <RegionPlayCompanion {...props({ claimedInteraction: null, onCloseInteraction })} />,
    );
    await act(async () => undefined);
    expect(
      screen.queryByRole('dialog', { name: 'Click! The chest is open!' }),
    ).not.toBeInTheDocument();
  });

  it('sounds a gentle retry once for a wrong answer, and nothing else (SM-P3-06)', async () => {
    const api = fakeApi({ submitAnswer: vi.fn(async () => outcome(false)) });
    const view = await atTheChest(api);
    const heard = listen();
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    await screen.findByText('Not quite. The lock is still shut. Let us try another one!');
    view.rerender(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    await act(async () => undefined);
    expect(heard).toEqual(['answerRetry']);
  });

  it('tells the sound where the chest is, so it can be heard from there (SM-P7)', async () => {
    const api = fakeApi();
    await atTheChest(api);
    const places: Array<[SoundCue, unknown]> = [];
    setSoundSink((cue, at) => places.push([cue, at]));
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await screen.findByRole('dialog', { name: 'Click! The chest is open!' });
    const open = places.find(([cue]) => cue === 'chestOpen');
    expect(open?.[1]).toEqual({ entityId: 'cove-chest' });
    // Feedback stays flat: it is not given a place.
    expect(places.find(([cue]) => cue === 'answerRight')?.[1]).toBeUndefined();
  });

  it('sounds the right answer and the open chest only after the server says yes, once (SM-P3-04, 06)', async () => {
    const api = fakeApi();
    const view = await atTheChest(api);
    const heard = listen();
    expect(heard).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await screen.findByRole('dialog', { name: 'Click! The chest is open!' });
    view.rerender(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    await act(async () => undefined);
    // The default server answer also finishes the quest, so that moment follows, once.
    expect(heard).toEqual(['answerRight', 'chestOpen', 'questComplete']);
  });

  it('shows nothing celebratory when the server refuses a replay', async () => {
    const api = fakeApi({
      submitAnswer: vi.fn(async () => {
        throw new ApiError('conflict', { status: 409, code: 'attempt_already_answered' });
      }),
    });
    await atTheChest(api);
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await waitFor(() => expect(api.getRegion).toHaveBeenCalledTimes(2)); // re-reads the truth
    expect(screen.queryByText('Golden Doubloon')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Click! The chest is open!' }),
    ).not.toBeInTheDocument();
  });

  it('says an open chest is open, and asks for nothing', async () => {
    const api = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    expect(await screen.findByText('This chest is already open.')).toBeInTheDocument();
    await act(async () => undefined);
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
  });

  it('says a chest with no challenge for this child is not ready', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => bootstrap({}, { challengeAvailable: false })),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    expect(
      await screen.findByText('This chest is not ready yet. Come back soon!'),
    ).toBeInTheDocument();
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
  });

  it('explains a failed request calmly and lets the child try again', async () => {
    const api = fakeApi({
      requestChestChallenge: vi
        .fn()
        .mockRejectedValueOnce(new ApiError('unavailable', { status: 503 }))
        .mockResolvedValue(challenge()),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Let us try that again.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try that again' }));
    expect(await screen.findByRole('button', { name: '5' })).toBeInTheDocument();
  });

  it('hands an expired sign-in to the app and asks for a grown-up', async () => {
    const api = fakeApi({
      requestChestChallenge: vi.fn(async () => {
        throw new ApiError('unauthenticated', { status: 401 });
      }),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please ask a grown-up to sign in again.',
    );
    expect(refresh).toHaveBeenCalled();
  });
});

describe('panels and the keyboard', () => {
  it('focuses the panel heading, closes on Escape, and keeps movement keys from walking away', async () => {
    const onCloseInteraction = vi.fn();
    const keys: string[] = [];
    const listener = (event: KeyboardEvent) => keys.push(event.key);
    window.addEventListener('keydown', listener);
    try {
      await atTheChest(fakeApi(), { onCloseInteraction });
      expect(screen.getByRole('heading', { name: 'Treasure chest' })).toHaveFocus();
      await userEvent.keyboard('w{ArrowUp}e{Enter}');
      expect(keys).toEqual([]);
      await userEvent.keyboard('{Escape}');
      expect(onCloseInteraction).toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });

  it('does not trap focus: Tab moves on through the panel and out', async () => {
    await atTheChest(fakeApi());
    await userEvent.tab();
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });
});

describe('the backpack', () => {
  it('shows the server’s inventory and quests, read through the progress API', async () => {
    const api = fakeApi({
      getProgress: vi.fn(async () => read(progressJson(), parse.playerProgress)),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props()} />);
    const button = await screen.findByRole('button', { name: /Backpack/ });
    await waitFor(() => expect(button).toHaveTextContent('1'));
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'My backpack' });
    expect(dialog).toHaveTextContent('Golden Doubloon');
    expect(dialog).toHaveTextContent('Treasure Rush');
    expect(dialog).toHaveTextContent('Done');
  });

  it('says so when the backpack is empty', async () => {
    apis.set(CHILD_A, fakeApi());
    render(<RegionPlayCompanion {...props()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Backpack/ }));
    expect(
      await screen.findByText('Nothing here yet. Open a chest to find treasure!'),
    ).toBeInTheDocument();
  });
});

describe('objective and hint (TR-12)', () => {
  it('puts the objective in the HUD from the server quest state, and gives the cue back on leaving', async () => {
    const setQuestCue = vi.fn();
    apis.set(CHILD_A, fakeApi());
    const view = render(<RegionPlayCompanion {...props({ setQuestCue })} />);
    await waitFor(() =>
      expect(setQuestCue).toHaveBeenLastCalledWith('Talk to Pirate Pip to start an adventure'),
    );
    view.unmount();
    expect(setQuestCue).toHaveBeenLastCalledWith(null);
  });

  it('shows the current stage, with a count only when it has more than one objective (TR-14)', async () => {
    const setQuestCue = vi.fn();
    apis.set(
      CHILD_A,
      fakeApi({
        getRegion: vi.fn(async () =>
          bootstrap({
            quests: [questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' })],
          }),
        ),
      }),
    );
    render(<RegionPlayCompanion {...props({ setQuestCue })} />);
    await waitFor(() => expect(setQuestCue).toHaveBeenLastCalledWith('Open the treasure chest'));
  });

  it('shows a hint only when asked, and puts it away', async () => {
    apis.set(CHILD_A, fakeApi());
    render(<RegionPlayCompanion {...props()} />);
    const hint = await screen.findByRole('button', { name: 'Hint' });
    await waitFor(() => expect(hint).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await userEvent.click(hint);
    expect(await screen.findByRole('status')).toHaveTextContent(/Walk up to Pirate Pip/);
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('puts its controls in the stage slot when the view offers one, so they stay in full screen (TR-13)', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    apis.set(CHILD_A, fakeApi());
    render(<RegionPlayCompanion {...props({ hudSlot: slot })} />);
    const hint = await screen.findByRole('button', { name: 'Hint' });
    expect(slot).toContainElement(hint);
    expect(slot).toContainElement(screen.getByRole('button', { name: /Backpack/ }));
    await userEvent.click(hint);
    expect(slot).toContainElement(await screen.findByRole('status'));
    slot.remove();
  });

  it('puts the Sound button in the stage slot, opens the mix controls and closes them (SM-P5)', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    apis.set(CHILD_A, fakeApi());
    render(<RegionPlayCompanion {...props({ hudSlot: slot })} />);
    const sound = await screen.findByRole('button', { name: 'Sound' });
    expect(slot).toContainElement(sound);
    await userEvent.click(sound);
    const panel = await screen.findByRole('dialog', { name: 'Sound' });
    expect(within(panel).getByRole('slider', { name: 'Music' })).toBeInTheDocument();
    expect(within(panel).getByRole('slider', { name: 'Everything' })).toBeInTheDocument();
    // The game controls give way while it is open, and return when it closes.
    expect(screen.queryByRole('button', { name: 'Hint' })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: 'Hint' })).toBeInTheDocument();
    slot.remove();
  });

  it('hides the hint button while a panel is open', async () => {
    await atTheChest(fakeApi());
    expect(screen.queryByRole('button', { name: 'Hint' })).not.toBeInTheDocument();
  });
});

describe('switching children', () => {
  it('starts fresh for the new child, with nothing carried over', async () => {
    const apiA = fakeApi();
    const apiB = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) });
    apis.set(CHILD_A, apiA);
    apis.set(CHILD_B, apiB);
    const view = await atTheChest(apiA);
    view.rerender(
      <RegionPlayCompanion
        {...props({ childId: CHILD_B, claimedInteraction: interaction(CHEST) })}
      />,
    );
    expect(await screen.findByText('This chest is already open.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5' })).not.toBeInTheDocument();
    await waitFor(() => expect(apiB.startSession).toHaveBeenCalled());
  });
});

describe('region-play registration', () => {
  it('is registered as both a scene and a view extension', () => {
    expect(SOURCE_WORLD_EXTENSIONS.get('region-play')).toBeDefined();
    expect(SOURCE_VIEW_EXTENSIONS.get('region-play')).toBe(regionPlayViewExtension);
  });

  it('claims only the interactions its binding names', () => {
    const context = { ageBand: 'SPROUT' as const, config };
    expect(regionPlayViewExtension.claimsInteraction(interaction(CHEST), context)).toBe(true);
    expect(
      regionPlayViewExtension.claimsInteraction(interaction('pirate-builder-bay:toolbox'), context),
    ).toBe(false);
    expect(
      regionPlayViewExtension.claimsInteraction(interaction(CHEST), { ...context, config: {} }),
    ).toBe(false);
  });
});

describe('beginning an adventure from the cove (ADR-041)', () => {
  const SIGNPOST = `${REGION}:launch:cove-bridge-signpost`;
  const withSignpost = (overrides: Record<string, unknown> = {}) =>
    bootstrap({
      objects: [signpostJson()],
      launchPoints: [launchPointJson()],
      ...overrides,
    });
  const launchConfig = buildRegionManifest(toRegionSceneModel(withSignpost()), {
    worldSlug: 'learning-adventure-island',
  }).manifest.extensions[0].config;

  function launchApi(overrides: Partial<PlayApi> = {}) {
    return fakeApi({
      getRegion: vi.fn(async () => withSignpost()),
      startLaunchPoint: vi.fn(async () => ({
        value: read(launchStartJson(), parse.launchStart),
        created: true,
      })),
      ...overrides,
    });
  }

  it('asks the server to start it, then goes to the adventure with a way back here', async () => {
    const api = launchApi();
    apis.set(CHILD_A, api);
    render(
      <RegionPlayCompanion
        {...props({ config: launchConfig, claimedInteraction: interaction(SIGNPOST) })}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Help Pip repair the Moonlight Bridge' }),
    );
    expect(api.startLaunchPoint).toHaveBeenCalledWith(
      REGION,
      'signpost-repair-the-moonlight-bridge',
    );
    expect(navigate).toHaveBeenCalledWith(
      `/island/${CHILD_A}/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge` +
        `?returnTo=${encodeURIComponent(`/island/${CHILD_A}/explore/${REGION}`)}`,
    );
    expect(screen.getByText('The sign points to the broken bridge.')).toBeInTheDocument();
  });

  it('sends one request for a double tap', async () => {
    let finish: () => void = () => undefined;
    const api = launchApi({
      startLaunchPoint: vi.fn(
        () =>
          new Promise<Upserted<LaunchStart>>((resolve) => {
            finish = () =>
              resolve({ value: read(launchStartJson(), parse.launchStart), created: true });
          }),
      ),
    });
    apis.set(CHILD_A, api);
    render(
      <RegionPlayCompanion
        {...props({ config: launchConfig, claimedInteraction: interaction(SIGNPOST) })}
      />,
    );
    const button = await screen.findByRole('button', {
      name: 'Help Pip repair the Moonlight Bridge',
    });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(api.startLaunchPoint).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('stays in the cove and says so calmly when the server refuses', async () => {
    const api = launchApi({
      startLaunchPoint: vi.fn(async () => {
        throw new ApiError('conflict', { code: 'content_unavailable' });
      }),
    });
    apis.set(CHILD_A, api);
    render(
      <RegionPlayCompanion
        {...props({ config: launchConfig, claimedInteraction: interaction(SIGNPOST) })}
      />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Help Pip repair the Moonlight Bridge' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This adventure is not ready right now. Keep exploring!',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('lets an NPC offer an adventure next to its quest', async () => {
    const api = launchApi({
      getRegion: vi.fn(async () =>
        bootstrap({ launchPoints: [launchPointJson({ entityId: 'cove-pip', objectKind: 'NPC' })] }),
      ),
    });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Help Pip repair the Moonlight Bridge' }),
    );
    expect(api.startLaunchPoint).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalled();
  });
});

describe("Pip's Missing Treasure (TR-14)", () => {
  const PEDESTAL = `${REGION}:chest:cove-ruins-pedestal`;
  const BEACH = `${REGION}:chest:cove-beach-chest`;
  const KEY = `${REGION}:pickup:cove-brass-key`;
  const STONE = (n: number) => `${REGION}:rune:cove-rune-stone-${n}`;
  const pips = (chests: Record<string, Record<string, unknown>> = {}) =>
    read(pipsBootstrapJson({ session: sessionJson() }, chests), parse.regionBootstrap);
  const pipsConfig = buildRegionManifest(toRegionSceneModel(pips()), {
    worldSlug: 'learning-adventure-island',
  }).manifest.extensions[0].config;
  const unlocked = { 'cove-ruins-pedestal': { locked: false, lockReason: null } };
  const keyItem = {
    itemId: 'old-brass-key',
    displayName: 'Old Brass Key',
    description: 'A heavy key.',
    category: 'QUEST_ITEM' as const,
    assetId: '',
  };
  const puzzle = (overrides = {}) =>
    challenge({
      targetEntityId: 'cove-ruins-pedestal',
      challenge: {
        skillId: 'addition-within-ten',
        operation: 'ADD',
        operands: [3, 4],
        responseMode: 'CHOICE',
        choices: [6, 7, 9],
      },
      ...overrides,
    });

  function playing(api: PlayApi, extra: Partial<LocationCompanionProps> = {}) {
    apis.set(CHILD_A, api);
    return props({ config: pipsConfig, ...extra });
  }

  it('tells the server each time the child talks to Pip, and nothing else', async () => {
    const api = fakeApi({ getRegion: vi.fn(async () => pips()) });
    const talk = interaction(PIP); // one visit: the view keeps the same claimed interaction
    const view = render(<RegionPlayCompanion {...playing(api, { claimedInteraction: talk })} />);
    await waitFor(() =>
      expect(api.talkToNpc).toHaveBeenCalledWith(SESSION_ID, 'cove-pip', expect.any(AbortSignal)),
    );
    expect(await screen.findByText(/Follow the flowers in the grove!/)).toBeInTheDocument();
    view.rerender(<RegionPlayCompanion {...playing(api, { claimedInteraction: talk })} />);
    await act(async () => undefined);
    expect(api.talkToNpc).toHaveBeenCalledTimes(1);
  });

  it('brings the finale when the server says returning to Pip completed the quest', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => pips()),
      talkToNpc: vi.fn(async () => ({
        flagsSet: ['cove-treasure-returned'],
        questUpdates: [
          {
            questId: 'pips-missing-treasure',
            status: 'COMPLETED' as const,
            currentStageId: 'return-to-pip',
            justCompleted: true,
            newlyCompletedObjectiveIds: ['cove-return-to-pip'],
          },
        ],
        completionRewards: [
          {
            ruleId: 'reward-pips',
            items: [
              {
                ...keyItem,
                itemId: 'treasure-cove-explorer',
                displayName: 'Treasure Cove Explorer Badge',
                category: 'KEEPSAKE' as const,
              },
            ],
            message: 'You are a Treasure Cove Explorer!',
          },
        ],
      })),
    });
    render(<RegionPlayCompanion {...playing(api, { claimedInteraction: interaction(PIP) })} />);
    const finale = await screen.findByRole('dialog', { name: 'You found all my treasure!' });
    expect(finale).toHaveTextContent('Treasure Cove Explorer Badge');
    expect(finale).toHaveTextContent('You are a Treasure Cove Explorer!');
  });

  it('sounds the quest-complete moment once for the finale (SM-P3-06)', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => pips()),
      talkToNpc: vi.fn(async () => ({
        flagsSet: [],
        questUpdates: [
          {
            questId: 'pips-missing-treasure',
            status: 'COMPLETED' as const,
            currentStageId: 'return-to-pip',
            justCompleted: true,
            newlyCompletedObjectiveIds: [],
          },
        ],
        completionRewards: [],
      })),
    });
    const claimed = interaction(PIP);
    const view = render(<RegionPlayCompanion {...playing(api, { claimedInteraction: claimed })} />);
    const heard = listen();
    await screen.findByRole('dialog', { name: 'You found all my treasure!' });
    view.rerender(<RegionPlayCompanion {...playing(api, { claimedInteraction: claimed })} />);
    await act(async () => undefined);
    expect(heard).toEqual(['questComplete']);
  });

  it('picks the key up through the server and shows what was found', async () => {
    const onCloseInteraction = vi.fn();
    const api = fakeApi({
      getRegion: vi.fn(async () => pips()),
      collectPickup: vi.fn(async () => ({
        value: {
          entityId: 'cove-brass-key',
          pickedUp: true,
          collected: true,
          newItems: [keyItem],
          rewardMessage: 'It is in your backpack.',
          questUpdates: [],
          completionRewards: [],
        },
        created: true,
      })),
    });
    render(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(KEY), onCloseInteraction })}
      />,
    );
    const reveal = await screen.findByRole('dialog', { name: 'You found something!' });
    expect(reveal).toHaveTextContent('Old Brass Key');
    expect(api.collectPickup).toHaveBeenCalledTimes(1);
    expect(onCloseInteraction).toHaveBeenCalled();
  });

  // Found in browser acceptance: opening the beach chest re-rendered with a new bootstrap, and
  // the key's reveal came back on top of the chest's reward.
  it('reveals a pickup once, however often the scene or bootstrap changes afterwards', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => pips()),
      collectPickup: vi.fn(async () => ({
        value: {
          entityId: 'cove-brass-key',
          pickedUp: true,
          collected: true,
          newItems: [keyItem],
          rewardMessage: null,
          questUpdates: [],
          completionRewards: [],
        },
        created: true,
      })),
    });
    const view = render(
      <RegionPlayCompanion {...playing(api, { claimedInteraction: interaction(KEY) })} />,
    );
    await screen.findByRole('dialog', { name: 'You found something!' });
    await userEvent.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(screen.queryByRole('dialog', { name: 'You found something!' })).toBeNull();
    // A new scene handle makes every reaction callback new, as a new bootstrap does in play.
    view.rerender(<RegionPlayCompanion {...playing(api, { sceneApi: fakeScene() })} />);
    await act(async () => undefined);
    expect(screen.queryByRole('dialog', { name: 'You found something!' })).toBeNull();
  });

  it('brings the finale once, however often the scene changes afterwards', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () => pips()),
      talkToNpc: vi.fn(async () => ({
        flagsSet: [],
        questUpdates: [
          {
            questId: 'pips-missing-treasure',
            status: 'COMPLETED' as const,
            currentStageId: 'return-to-pip',
            justCompleted: true,
            newlyCompletedObjectiveIds: ['cove-return-to-pip'],
          },
        ],
        completionRewards: [],
      })),
    });
    // Closing gives the claim back, as the view does, so Pip is not talked to again.
    const onCloseInteraction = vi.fn(() =>
      view.rerender(<RegionPlayCompanion {...playing(api, { onCloseInteraction })} />),
    );
    const view = render(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(PIP), onCloseInteraction })}
      />,
    );
    await screen.findByRole('dialog', { name: 'You found all my treasure!' });
    await userEvent.click(screen.getByRole('button', { name: 'Keep exploring' }));
    expect(api.talkToNpc).toHaveBeenCalledTimes(1);
    view.rerender(
      <RegionPlayCompanion {...playing(api, { sceneApi: fakeScene(), onCloseInteraction })} />,
    );
    await act(async () => undefined);
    expect(screen.queryByRole('dialog', { name: 'You found all my treasure!' })).toBeNull();
  });

  it('says a chest needs its key, with Pip’s clue, and asks for no challenge', async () => {
    const api = fakeApi({
      getRegion: vi.fn(async () =>
        pips({ 'cove-beach-chest': { lockReason: 'ITEM' }, 'cove-grove-chest': { isOpen: true } }),
      ),
    });
    render(<RegionPlayCompanion {...playing(api, { claimedInteraction: interaction(BEACH) })} />);
    expect(await screen.findByText(PLAY_COPY.chestNeedsKey)).toBeInTheDocument();
    expect(screen.getByText(/X in the sand/)).toBeInTheDocument();
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
  });

  it('puts the puzzle’s numbers on the stones and answers with the stone the child touches', async () => {
    const scene = fakeScene();
    const api = fakeApi({
      getRegion: vi.fn(async () => pips(unlocked)),
      requestChestChallenge: vi.fn(async () => puzzle()),
      submitAnswer: vi.fn(async () => outcome(true, { chestOpened: true, newItems: [] })),
    });
    const view = render(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(PEDESTAL), sceneApi: scene })}
      />,
    );
    expect(await screen.findByText(PLAY_COPY.puzzleTouch)).toBeInTheDocument();
    await waitFor(() =>
      expect(scene.setRuneNumbers).toHaveBeenLastCalledWith(
        new Map([
          ['cove-rune-stone-1', 6],
          ['cove-rune-stone-2', 7],
          ['cove-rune-stone-3', 9],
        ]),
      ),
    );
    view.rerender(
      <RegionPlayCompanion {...playing(api, { claimedInteraction: null, sceneApi: scene })} />,
    );
    view.rerender(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(STONE(2)), sceneApi: scene })}
      />,
    );
    await waitFor(() => expect(api.submitAnswer).toHaveBeenCalledTimes(1));
    expect(api.submitAnswer).toHaveBeenCalledWith(
      ATTEMPT_ID,
      { answer: 7, hintLevel: 0 },
      expect.any(AbortSignal),
    );
  });

  it('asks the child to read the pedestal first when no puzzle is out', async () => {
    const showToast = vi.fn();
    const api = fakeApi({ getRegion: vi.fn(async () => pips(unlocked)) });
    render(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(STONE(1)), showToast })}
      />,
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(PLAY_COPY.puzzleFirst));
    expect(api.submitAnswer).not.toHaveBeenCalled();
  });

  it('after a wrong stone, says so and asks the server for new numbers', async () => {
    const showToast = vi.fn();
    const api = fakeApi({
      getRegion: vi.fn(async () => pips(unlocked)),
      requestChestChallenge: vi.fn(async () => puzzle()),
      submitAnswer: vi.fn(async () => outcome(false)),
    });
    const view = render(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(PEDESTAL), showToast })}
      />,
    );
    await screen.findByText(PLAY_COPY.puzzleTouch);
    view.rerender(
      <RegionPlayCompanion {...playing(api, { claimedInteraction: null, showToast })} />,
    );
    view.rerender(
      <RegionPlayCompanion
        {...playing(api, { claimedInteraction: interaction(STONE(1)), showToast })}
      />,
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(PLAY_COPY.puzzleWrong));
    await waitFor(() => expect(api.requestChestChallenge).toHaveBeenCalledTimes(2));
  });
});

describe('Lookout Point and the spyglass (TR-17, TR-20)', () => {
  const SPYGLASS = `${REGION}:chest:cove-lookout-spyglass`;
  const STONE = (n: number) => `${REGION}:rune:cove-rune-stone-${n}`;
  const QUEST_COMPLETE = {
    locationSlug: 'pirate-builder-bay',
    changeType: 'UNLOCK',
    changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
    payload: {},
    createdAt: '2026-11-02T18:00:00.000000Z',
  };
  const unlockLayout = {
    unlock: {
      changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
      openColliders: ['cove-ruins-gate:collider'],
      showWhenOpen: ['cove-bridge'],
      hideWhenOpen: ['cove-broken-bridge'],
      liftGates: ['cove-ruins-gate'],
    },
  };
  const region = { ...bootstrapJson().region, scene: { layout: unlockLayout } };
  const unlockedSpyglass = { 'cove-lookout-spyglass': { locked: false, lockReason: null } };

  const lookout = (done: boolean, chests: Record<string, Record<string, unknown>> = {}) =>
    read(
      pipsBootstrapJson(
        {
          region,
          session: sessionJson(),
          worldChanges: done ? [QUEST_COMPLETE] : [],
          ...(done
            ? { quests: [questJson({ questId: 'pips-missing-treasure', status: 'COMPLETED' })] }
            : {}),
        },
        done ? { ...unlockedSpyglass, ...chests } : chests,
      ),
      parse.regionBootstrap,
    );
  const lookoutConfig = buildRegionManifest(toRegionSceneModel(lookout(false)), {
    worldSlug: 'learning-adventure-island',
  }).manifest.extensions[0].config;

  const spyglassChallenge = (overrides = {}) =>
    challenge({
      targetEntityId: 'cove-lookout-spyglass',
      challenge: {
        skillId: 'counting-sets',
        operation: 'COUNT',
        operands: [4],
        responseMode: 'CHOICE',
        choices: [3, 4, 5],
      },
      ...overrides,
    });
  const replayOutcome = (correct: boolean) =>
    outcome(correct, {
      chestOpened: false,
      newItems: [],
      rewardMessage: null,
      questUpdates: [],
    });

  function visit(api: PlayApi, extra: Partial<LocationCompanionProps> = {}) {
    apis.set(CHILD_A, api);
    return props({ config: lookoutConfig, ...extra });
  }

  it('opens the gate and lays the bridge the moment the server reports the quest complete', async () => {
    const scene = fakeScene();
    const showToast = vi.fn();
    let done = false;
    const api = fakeApi({
      getRegion: vi.fn(async () => lookout(done)),
      talkToNpc: vi.fn(async () => {
        done = true;
        return {
          flagsSet: ['cove-treasure-returned'],
          questUpdates: [
            {
              questId: 'pips-missing-treasure',
              status: 'COMPLETED' as const,
              currentStageId: 'return-to-pip',
              justCompleted: true,
              newlyCompletedObjectiveIds: ['cove-return-to-pip'],
            },
          ],
          completionRewards: [],
        };
      }),
    });
    render(
      <RegionPlayCompanion
        {...visit(api, { claimedInteraction: interaction(PIP), sceneApi: scene, showToast })}
      />,
    );
    await waitFor(() => expect(scene.setUnlocked).toHaveBeenCalledWith(true));
    expect(showToast).toHaveBeenCalledWith(PLAY_COPY.bridgeOpened);
    expect(scene.reactNpc).toHaveBeenCalledWith('cove-pip', 'cheer');
  });

  it('leaves the way shut for a child who has not earned it', async () => {
    const scene = fakeScene();
    const api = fakeApi({ getRegion: vi.fn(async () => lookout(false)) });
    render(<RegionPlayCompanion {...visit(api, { sceneApi: scene })} />);
    await waitFor(() => expect(api.getRegion).toHaveBeenCalled());
    await act(async () => undefined);
    expect(scene.setUnlocked).not.toHaveBeenCalled();
  });

  it('says nothing on a later visit, when the cove was built open already', async () => {
    const scene = fakeScene();
    (scene.setUnlocked as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const showToast = vi.fn();
    const api = fakeApi({ getRegion: vi.fn(async () => lookout(true)) });
    render(<RegionPlayCompanion {...visit(api, { sceneApi: scene, showToast })} />);
    await waitFor(() => expect(scene.setUnlocked).toHaveBeenCalledWith(true));
    expect(showToast).not.toHaveBeenCalledWith(PLAY_COPY.bridgeOpened);
  });

  it('ignores a same-named world change from another place', async () => {
    const scene = fakeScene();
    const api = fakeApi({
      getRegion: vi.fn(async () =>
        read(
          pipsBootstrapJson({
            region,
            session: sessionJson(),
            worldChanges: [{ ...QUEST_COMPLETE, locationSlug: 'wonderwild-forest' }],
          }),
          parse.regionBootstrap,
        ),
      ),
    });
    render(<RegionPlayCompanion {...visit(api, { sceneApi: scene })} />);
    await waitFor(() => expect(api.getRegion).toHaveBeenCalled());
    await act(async () => undefined);
    expect(scene.setUnlocked).not.toHaveBeenCalled();
  });

  it('tells the child the spyglass is not ready yet, and asks the server for nothing', async () => {
    const api = fakeApi({ getRegion: vi.fn(async () => lookout(false)) });
    render(<RegionPlayCompanion {...visit(api, { claimedInteraction: interaction(SPYGLASS) })} />);
    expect(await screen.findByText(PLAY_COPY.chestNotYet)).toBeInTheDocument();
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
  });

  it('asks a fresh question each time, thanks the child kindly, and never shows a chest or a reward', async () => {
    const user = userEvent.setup();
    const request = vi
      .fn()
      .mockResolvedValueOnce(spyglassChallenge())
      .mockResolvedValueOnce(
        spyglassChallenge({ attemptId: '22222222-2222-4222-8222-222222222222' }),
      );
    const api = fakeApi({
      getRegion: vi.fn(async () => lookout(true)),
      requestChestChallenge: request,
      submitAnswer: vi.fn(async () => replayOutcome(true)),
    });
    render(<RegionPlayCompanion {...visit(api, { claimedInteraction: interaction(SPYGLASS) })} />);
    await user.click(await screen.findByRole('button', { name: '4' }));
    const done = await screen.findByRole('dialog', { name: PLAY_COPY.replayGreat });
    expect(done).toHaveTextContent(PLAY_COPY.replayNote);
    expect(screen.queryByText(PLAY_COPY.chestOpened)).not.toBeInTheDocument();
    expect(screen.queryByText(PLAY_COPY.youFound)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: PLAY_COPY.replayAgain }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenCalledWith(
      SESSION_ID,
      'cove-lookout-spyglass',
      expect.any(AbortSignal),
    );
    expect(await screen.findByRole('button', { name: '4' })).toBeInTheDocument();
  });

  it('lets a wrong answer try again with a new question, and shows no thanks', async () => {
    const user = userEvent.setup();
    const request = vi.fn(async () => spyglassChallenge());
    const api = fakeApi({
      getRegion: vi.fn(async () => lookout(true)),
      requestChestChallenge: request,
      submitAnswer: vi.fn(async () => replayOutcome(false)),
    });
    render(<RegionPlayCompanion {...visit(api, { claimedInteraction: interaction(SPYGLASS) })} />);
    await user.click(await screen.findByRole('button', { name: '3' }));
    await user.click(await screen.findByRole('button', { name: PLAY_COPY.tryAgain }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: PLAY_COPY.replayGreat })).not.toBeInTheDocument();
  });

  it('makes Pip listen when talked to, and the stones show the verdict (TR-18, TR-16)', async () => {
    const scene = fakeScene();
    const api = fakeApi({
      getRegion: vi.fn(async () =>
        lookout(false, { 'cove-ruins-pedestal': { locked: false, lockReason: null } }),
      ),
      requestChestChallenge: vi.fn(async () =>
        challenge({
          targetEntityId: 'cove-ruins-pedestal',
          challenge: {
            skillId: 'addition-within-ten',
            operation: 'ADD',
            operands: [3, 4],
            responseMode: 'CHOICE',
            choices: [6, 7, 9],
          },
        }),
      ),
      submitAnswer: vi.fn(async () => outcome(true, { chestOpened: true, newItems: [] })),
    });
    const view = render(
      <RegionPlayCompanion
        {...visit(api, { claimedInteraction: interaction(PIP), sceneApi: scene })}
      />,
    );
    await waitFor(() => expect(scene.reactNpc).toHaveBeenCalledWith('cove-pip', 'talk'));

    view.rerender(
      <RegionPlayCompanion
        {...visit(api, {
          claimedInteraction: interaction(`${REGION}:chest:cove-ruins-pedestal`),
          sceneApi: scene,
        })}
      />,
    );
    await screen.findByText(PLAY_COPY.puzzleTouch);
    view.rerender(
      <RegionPlayCompanion {...visit(api, { claimedInteraction: null, sceneApi: scene })} />,
    );
    view.rerender(
      <RegionPlayCompanion
        {...visit(api, { claimedInteraction: interaction(STONE(2)), sceneApi: scene })}
      />,
    );
    await waitFor(() => expect(scene.pressRune).toHaveBeenCalledWith('cove-rune-stone-2'));
    await waitFor(() => expect(scene.flashRunes).toHaveBeenCalledWith(true));
  });
});
