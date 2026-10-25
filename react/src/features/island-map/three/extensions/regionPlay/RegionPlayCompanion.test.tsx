import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { read } from '../../../../../api/parse';
import * as parse from '../../../../../api/play/parse';
import type { PlayApi } from '../../../../../api/play/playApi';
import { buildRegionManifest } from '../../../../region-play/regionManifest';
import { toRegionSceneModel } from '../../../../region-play/sceneModel';
import {
  CHILD_A,
  CHILD_B,
  bootstrapJson,
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
const bootstrap = (overrides = {}, chest = {}) => read(bootstrapJson(overrides, chest), parse.regionBootstrap);

function fakeApi(overrides: Partial<PlayApi> = {}): PlayApi {
  return {
    getRegion: vi.fn(async () => bootstrap()),
    startSession: vi.fn(async () => ({ value: read(sessionJson(), parse.session), created: true })),
    getSession: vi.fn(),
    changeSession: vi.fn(async (_id, action) =>
      read(sessionJson(action === 'complete' ? { status: 'COMPLETED', completedAt: 'x' } : {}), parse.session),
    ),
    acceptQuest: vi.fn(),
    requestChestChallenge: vi.fn(),
    submitAnswer: vi.fn(),
    getProgress: vi.fn(),
    ...overrides,
  };
}

function fakeScene(open = false): RegionPlaySceneApi & { setChestOpen: ReturnType<typeof vi.fn> } {
  const drawn = new Map([['cove-chest', open]]);
  return {
    setChestOpen: vi.fn((id: string, value: boolean) => void drawn.set(id, value)),
    isChestOpen: (id: string) => drawn.get(id),
  };
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

beforeEach(() => {
  apis.clear();
  refresh.mockClear();
});

describe('RegionPlayCompanion', () => {
  it('starts or resumes the child’s session once, and never accepts a quest', async () => {
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
    const api = fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) });
    apis.set(CHILD_A, api);
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

  it('turns the chest into a challenge prompt event, and changes nothing', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    const scene = fakeScene();
    const onCloseInteraction = vi.fn();
    render(
      <RegionPlayCompanion
        {...props({ sceneApi: scene, onCloseInteraction, claimedInteraction: interaction(`${REGION}:chest:cove-chest`) })}
      />,
    );
    expect(await screen.findByText('This chest is locked with a number puzzle.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-region-play-event', 'chest');
    expect(api.requestChestChallenge).not.toHaveBeenCalled();
    expect(scene.setChestOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onCloseInteraction).toHaveBeenCalled();
  });

  it('turns Pip into a quest offer event', async () => {
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({ quests: [questJson()] })) }));
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(`${REGION}:talk:cove-pip`) })} />);
    expect(await screen.findByText('Pirate Pip has a quest for you.')).toBeInTheDocument();
  });

  it('says an open chest is open', async () => {
    apis.set(CHILD_A, fakeApi({ getRegion: vi.fn(async () => bootstrap({}, { isOpen: true })) }));
    render(<RegionPlayCompanion {...props({ claimedInteraction: interaction(`${REGION}:chest:cove-chest`) })} />);
    expect(await screen.findByText('This chest is already open.')).toBeInTheDocument();
  });

  it('completes the session at the calm stop', async () => {
    const api = fakeApi();
    apis.set(CHILD_A, api);
    const view = render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(api.startSession).toHaveBeenCalled());
    view.rerender(<RegionPlayCompanion {...props({ limitReached: true })} />);
    await waitFor(() => expect(api.changeSession).toHaveBeenCalledWith(expect.any(String), 'complete', expect.any(AbortSignal)));
  });

  it('reads the new child’s region and session when the child changes', async () => {
    const apiA = fakeApi();
    const apiB = fakeApi();
    apis.set(CHILD_A, apiA);
    apis.set(CHILD_B, apiB);
    const view = render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(apiA.startSession).toHaveBeenCalled());
    view.rerender(<RegionPlayCompanion {...props({ childId: CHILD_B })} />);
    await waitFor(() => expect(apiB.startSession).toHaveBeenCalled());
  });

  it('hands an expired sign-in to the app’s auth refresh', async () => {
    const { ApiError } = await import('../../../../../api/errors');
    apis.set(
      CHILD_A,
      fakeApi({
        getRegion: vi.fn(async () => {
          throw new ApiError('unauthenticated', { status: 401 });
        }),
      }),
    );
    render(<RegionPlayCompanion {...props()} />);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('region-play registration', () => {
  it('is registered as both a scene and a view extension', () => {
    expect(SOURCE_WORLD_EXTENSIONS.get('region-play')).toBeDefined();
    expect(SOURCE_VIEW_EXTENSIONS.get('region-play')).toBe(regionPlayViewExtension);
  });

  it('claims only the interactions its binding names', () => {
    const context = { ageBand: 'SPROUT' as const, config };
    expect(regionPlayViewExtension.claimsInteraction(interaction(`${REGION}:chest:cove-chest`), context)).toBe(true);
    expect(regionPlayViewExtension.claimsInteraction(interaction('pirate-builder-bay:toolbox'), context)).toBe(false);
    expect(regionPlayViewExtension.claimsInteraction(interaction(`${REGION}:chest:cove-chest`), { ...context, config: {} })).toBe(false);
  });
});
