import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../../../api/errors';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { PlayApi } from '../../../../../api/play/playApi';
import type { AnswerOutcome } from '../../../../../api/play/types';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import {
  CHILD_A,
  CHILD_B,
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
import { SOURCE_VIEW_EXTENSIONS, SOURCE_WORLD_EXTENSIONS } from '..';
import { RegionPlayCompanion } from './RegionPlayCompanion';
import { regionPlayViewExtension } from './regionPlayViewExtension';
import type { RegionPlaySceneApi } from './regionPlayScene';

const refresh = vi.fn(async () => undefined);
vi.mock('../../../../auth/AuthContext', () => ({ useAuth: () => ({ refresh }) }));

const apis = new Map<string, PlayApi>();
vi.mock('../../../../../api/play/playApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../api/play/playApi')>()),
  playApiFor: (childId: string) => apis.get(childId),
}));

const REGION = 'treasure-rush-cove';
const CHEST = `${REGION}:chest:cove-chest`;
const PIP = `${REGION}:talk:cove-pip`;
const bootstrap = (overrides = {}, chest = {}) => read(bootstrapJson(overrides, chest), parse.regionBootstrap);
const outcome = (correct: boolean, overrides = {}) => read(outcomeJson(correct, overrides), parse.answerOutcome);
const challenge = (overrides = {}) => ({ value: read(challengeJson(overrides), parse.issuedChallenge), created: true });

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
    getRegion: vi.fn(async () => bootstrap({ quests: [questJson()], session: started ? sessionJson() : null })),
    startSession: vi.fn(async () => {
      started = true;
      return { value: read(sessionJson(), parse.session), created: true };
    }),
    getSession: vi.fn(),
    changeSession: vi.fn(async (_id, action) =>
      read(sessionJson(action === 'complete' ? { status: 'COMPLETED', completedAt: 'x' } : {}), parse.session),
    ),
    acceptQuest: vi.fn(async () => ({
      value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest),
      created: true,
    })),
    requestChestChallenge: vi.fn(async () => challenge()),
    submitAnswer: vi.fn(async () => outcome(true)),
    getProgress: vi.fn(async () => read({ ...progressJson(), inventory: [] }, parse.playerProgress)),
    ...overrides,
  };
}

function fakeScene(open = false) {
  const drawn = new Map([['cove-chest', open]]);
  const scene: RegionPlaySceneApi & { setChestOpen: ReturnType<typeof vi.fn> } = {
    setChestOpen: vi.fn((id: string, value: boolean) => void drawn.set(id, value)),
    isChestOpen: (id: string) => drawn.get(id),
  };
  return scene;
}

const config = buildRegionManifest(toRegionSceneModel(bootstrap()), { worldSlug: 'learning-adventure-island' }).manifest
  .extensions[0].config;

function interaction(id: string): WorldInteraction {
  return { id, type: 'OBJECT', trigger: 'TAP', title: 't', targetId: 'x', action: { kind: 'SHOW_MESSAGE', message: 'm' } };
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
  const view = render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST), ...extra })} />);
  await screen.findByRole('button', { name: '5' });
  return view;
}

beforeEach(() => {
  apis.clear();
  refresh.mockClear();
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
      expect(api.changeSession).toHaveBeenCalledWith(expect.any(String), 'complete', expect.any(AbortSignal)),
    );
  });
});

describe('talking to Pip', () => {
  it('shows Pip’s offer from the server and accepts only when the child says yes', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    const dialog = await screen.findByRole('dialog', { name: 'Pirate Pip' });
    expect(dialog).toHaveTextContent('Find the treasure chest in the cove and open it with a number puzzle.');
    expect(api.acceptQuest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, I will help!' }));
    await waitFor(() => expect(api.acceptQuest).toHaveBeenCalledWith('treasure-rush-cove', expect.any(AbortSignal)));
    expect(await screen.findByText(/Quest accepted!/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Treasure Rush' })).toHaveTextContent('Open the treasure chest in the cove');
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
      pending.resolve({ value: read(questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' }), parse.quest), created: true }),
    );
  });

  it('shows an accepted quest as in progress and a finished one as done on a later visit', async () => {
    const active = questJson({ status: 'ACTIVE', currentStageId: 'open-the-chest' });
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [active] })) }));
    const view = render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(PIP) })} />);
    expect(await screen.findByText('The treasure is waiting for you. Here is what to do.')).toBeInTheDocument();
    expect(screen.queryByText(/Quest accepted!/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, I will help!' })).not.toBeInTheDocument();
    view.unmount();

    const done = questJson({
      status: 'COMPLETED',
      currentStageId: 'open-the-chest',
      completedAt: '2026-10-24T18:02:41Z',
      stages: [{ ...questJson().stages[0], complete: true, objectives: [{ ...questJson().stages[0].objectives[0], complete: true }] }],
    });
    apis.set(CHILD_B, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [done] })) }));
    render(<RegionPlayCompanion {...props({ childId: CHILD_B, claimedInteraction: interaction(PIP) })} />);
    expect(await screen.findByText('You found the treasure! Thank you, friend.')).toBeInTheDocument();
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
      challenge: { skillId: 'subtraction-within-ten', operation: 'SUBTRACT', operands: [7, 3], responseMode: 'NUMBER_INPUT', choices: [] },
    });
    const api = fakeApi({ requestChestChallenge: vi.fn(async () => typed), submitAnswer: vi.fn(async () => outcome(false)) });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    const input = await screen.findByLabelText('Your answer');
    expect(screen.getByText('How many coins are left?')).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open it!' });
    expect(open).toBeDisabled();
    await userEvent.type(input, '4');
    await userEvent.click(open);
    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith(typed.value.attemptId, { answer: 4, hintLevel: 0 }, expect.any(AbortSignal)),
    );
  });

  it('gives a hint that never says the answer, and reports how many were used', async () => {
    const api = fakeApi();
    await atTheChest(api);
    await userEvent.click(screen.getByRole('button', { name: 'Help me' }));
    expect(screen.getByText('Count the first pile of coins.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '5' }));
    await waitFor(() =>
      expect(api.submitAnswer).toHaveBeenCalledWith(expect.any(String), { answer: 5, hintLevel: 1 }, expect.any(AbortSignal)),
    );
  });

  it('cheers a wrong answer on and offers another challenge from the server', async () => {
    const api = fakeApi({ submitAnswer: vi.fn(async () => outcome(false)) });
    await atTheChest(api);
    await userEvent.click(screen.getByRole('button', { name: '4' }));
    expect(await screen.findByText('Not quite. The lock is still shut. Let us try another one!')).toBeInTheDocument();
    expect(screen.queryByText('Golden Doubloon')).not.toBeInTheDocument();
    vi.mocked(api.requestChestChallenge).mockResolvedValueOnce(challenge({ attemptId: 'attempt-2', attemptNumber: 2 }));
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
      bootstrap({ session: sessionJson(), quests: [questJson({ status: 'COMPLETED', currentStageId: 'open-the-chest' })] }, { isOpen: true }),
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
    view.rerender(<RegionPlayCompanion {...props({ claimedInteraction: null, onCloseInteraction })} />);
    await act(async () => undefined);
    expect(screen.queryByRole('dialog', { name: 'Click! The chest is open!' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('dialog', { name: 'Click! The chest is open!' })).not.toBeInTheDocument();
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
    const api = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { challengeAvailable: false })) });
    apis.set(CHILD_A, api);
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(CHEST) })} />);
    expect(await screen.findByText('This chest is not ready yet. Come back soon!')).toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Let us try that again.');
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Please ask a grown-up to sign in again.');
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
    const api = fakeApi({ getProgress: vi.fn(async () => read(progressJson(), parse.playerProgress)) });
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
    expect(await screen.findByText('Nothing here yet. Open a chest to find treasure!')).toBeInTheDocument();
  });
});

describe('switching children', () => {
  it('starts fresh for the new child, with nothing carried over', async () => {
    const apiA = fakeApi();
    const apiB = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) });
    apis.set(CHILD_A, apiA);
    apis.set(CHILD_B, apiB);
    const view = await atTheChest(apiA);
    view.rerender(<RegionPlayCompanion {...props({ childId: CHILD_B, claimedInteraction: interaction(CHEST) })} />);
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
    expect(regionPlayViewExtension.claimsInteraction(interaction('pirate-builder-bay:toolbox'), context)).toBe(false);
    expect(regionPlayViewExtension.claimsInteraction(interaction(CHEST), { ...context, config: {} })).toBe(false);
  });
});
