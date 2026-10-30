import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { PlayApi } from '../../api/play/playApi';
import {
  CHILD_A,
  CHILD_B,
  bootstrapJson,
  challengeJson,
  questJson,
  sessionJson,
} from '../../test/playFixtures';
import { unpublishRegionCheckpoints } from '../discovery/checkpoints';
import type { WorldEngineEventBus } from '../island-map/three/worldEngineEvents';
import type { ThreeLocationManifest } from '../island-map/three/runtime/locationManifest';
import { ThreeLocationWorldView } from '../island-map/three/runtime/ThreeLocationWorldView';
import { sourceLocationManifestRepository } from '../island-map/three/runtime/manifests';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { ISLAND_LOCATIONS } from '../island/locations';
import { createRegionManifestRepository } from './regionManifestRepository';

/**
 * Treasure Cove through the one generic view (TR-7): the real repository,
 * manifest builder, extension registry and companion, with the scene
 * stubbed (as `ThreeLocationWorldView.test.tsx` does) and the play API
 * faked. Covers loading, error states, interaction routing, and switching
 * children.
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  manifest: null as ThreeLocationManifest | null,
  sceneApi: {
    setChestOpen: vi.fn(),
    isChestOpen: vi.fn(() => false),
  },
}));

vi.mock('../island-map/three/runtime/createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, manifest: ThreeLocationManifest) => {
      engine.bus = bus;
      engine.manifest = manifest;
      return {
        dispose: vi.fn(),
        interact: vi.fn(),
        ready: Promise.resolve(),
        extensionApi: (id: string) => (id === 'region-play' ? engine.sceneApi : null),
      };
    },
  ),
}));
vi.mock('../discovery/api', () => ({
  getWorldState: vi.fn(async () => ({ discoveredIds: [], lastCheckpointId: undefined })),
  recordCharacterMet: vi.fn(async () => undefined),
  saveCheckpoint: vi.fn(async () => undefined),
}));
vi.mock('../adventures/api', () => ({
  listAllWorldChanges: vi.fn(async () => []),
  recordWorldChangeOnce: vi.fn(),
}));
vi.mock('../rewards/api', () => ({ getInventory: vi.fn(async () => ({ ownedItemIds: [] })) }));
vi.mock('../quests/api', () => ({ listQuestStates: vi.fn(async () => []) }));
vi.mock('../island/api', () => ({ getCompanionProfile: vi.fn(async () => null) }));
vi.mock('../session/useSessionClock', () => ({ useSessionClock: () => ({ limitReached: false }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ refresh: vi.fn() }) }));
vi.mock('../island-map/NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="amplify-npc-panel">{npcId}</div>
  ),
}));

const apis = new Map<string, PlayApi>();
vi.mock('../../api/play/playApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/play/playApi')>()),
  playApiFor: (childId: string) => apis.get(childId),
}));

const REGION = 'treasure-rush-cove';

function fakeApi(getRegion?: PlayApi['getRegion']): PlayApi {
  return {
    getRegion:
      getRegion ??
      vi.fn(async () => read(bootstrapJson({ quests: [questJson()] }), parse.regionBootstrap)),
    startSession: vi.fn(async () => ({ value: read(sessionJson(), parse.session), created: true })),
    getSession: vi.fn(),
    changeSession: vi.fn(),
    acceptQuest: vi.fn(),
    requestChestChallenge: vi.fn(async () => ({
      value: read(challengeJson(), parse.issuedChallenge),
      created: true,
    })),
    submitAnswer: vi.fn(),
    getProgress: vi.fn(),
  };
}

function view(childId: string) {
  const api = apis.get(childId);
  if (!api) throw new Error('no api for child');
  const repository = createRegionManifestRepository({
    source: sourceLocationManifestRepository,
    api,
    registries: SOURCE_MANIFEST_REGISTRIES,
    worldSlugFor: (slug) => ISLAND_LOCATIONS.find((location) => location.slug === slug)?.worldSlug,
  });
  return (
    <MemoryRouter>
      <ThreeLocationWorldView
        childId={childId}
        regionId={REGION}
        ageBand="PATHFINDER"
        repository={repository}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  apis.clear();
  engine.bus = null;
  engine.manifest = null;
  engine.sceneApi.setChestOpen.mockClear();
});
afterEach(() => unpublishRegionCheckpoints(REGION));

describe('Treasure Cove in the generic view', () => {
  it('shows loading, then builds the scene from the Django region and starts the session', async () => {
    apis.set(CHILD_A, fakeApi());
    render(view(CHILD_A));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await waitFor(() => expect(engine.manifest?.regionId).toBe(REGION));
    expect(engine.manifest?.props.map((p) => p.entityId)).toContain('cove-chest');
    await waitFor(() =>
      expect(apis.get(CHILD_A)?.startSession).toHaveBeenCalledWith(REGION, expect.any(AbortSignal)),
    );
    expect(apis.get(CHILD_A)?.acceptQuest).not.toHaveBeenCalled();
  });

  it('says calmly when the region is not open (unpublished, retired, or not this family’s)', async () => {
    apis.set(
      CHILD_A,
      fakeApi(vi.fn(async () => Promise.reject(new ApiError('not_found', { status: 404 })))),
    );
    render(view(CHILD_A));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This part of the island isn't open yet.",
    );
  });

  it('says calmly when the region could not be loaded', async () => {
    apis.set(CHILD_A, fakeApi(vi.fn(async () => Promise.reject(new ApiError('network')))));
    render(view(CHILD_A));
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be loaded");
  });

  it('routes the chest to the play extension, which asks the server for its challenge', async () => {
    apis.set(CHILD_A, fakeApi());
    render(view(CHILD_A));
    await waitFor(() => expect(engine.bus).not.toBeNull());
    await waitFor(() => expect(apis.get(CHILD_A)?.startSession).toHaveBeenCalled());
    act(() =>
      engine.bus?.emit('ObjectInteracted', {
        entityId: 'cove-chest',
        interactionId: 'treasure-rush-cove:chest:cove-chest',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Treasure chest' })).toBeInTheDocument();
    expect(await screen.findByText('How many coins are there altogether?')).toBeInTheDocument();
    expect(apis.get(CHILD_A)?.requestChestChallenge).toHaveBeenCalledWith(
      '6f1c2a3b-0000-4000-8000-000000000001',
      'cove-chest',
      expect.any(AbortSignal),
    );
    expect(engine.sceneApi.setChestOpen).not.toHaveBeenCalled();
  });

  it('routes Pip to the play extension, so the quest offer comes from Django', async () => {
    apis.set(CHILD_A, fakeApi());
    render(view(CHILD_A));
    await waitFor(() => expect(engine.bus).not.toBeNull());
    await waitFor(() => expect(apis.get(CHILD_A)?.startSession).toHaveBeenCalled());
    act(() =>
      engine.bus?.emit('ObjectInteracted', {
        entityId: 'cove-pip',
        interactionId: 'treasure-rush-cove:talk:cove-pip',
      }),
    );
    expect(await screen.findByRole('dialog', { name: 'Pirate Pip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, I will help!' })).toBeInTheDocument();
    expect(apis.get(CHILD_A)?.acceptQuest).not.toHaveBeenCalled();
    expect(screen.queryByTestId('amplify-npc-panel')).not.toBeInTheDocument();
  });

  it('draws the cove for the child now selected after a switch', async () => {
    apis.set(CHILD_A, fakeApi());
    apis.set(
      CHILD_B,
      fakeApi(vi.fn(async () => read(bootstrapJson({}, { isOpen: true }), parse.regionBootstrap))),
    );
    const rendered = render(view(CHILD_A));
    await waitFor(() => expect(engine.manifest).not.toBeNull());
    rendered.rerender(view(CHILD_B));
    await waitFor(() => {
      const chests = engine.manifest?.extensions[0].config.chests as unknown as
        { isOpen: boolean }[] | undefined;
      expect(chests?.[0].isOpen).toBe(true);
    });
    await waitFor(() => expect(apis.get(CHILD_B)?.startSession).toHaveBeenCalled());
  });
});
