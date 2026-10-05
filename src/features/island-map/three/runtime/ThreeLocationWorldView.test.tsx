import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEngineEventBus } from '../worldEngineEvents';
import type { ThreeLocationManifest } from './locationManifest';
import {
  InvalidLocationManifestError,
  LocationManifestNotFoundError,
  type LocationManifestRepository,
} from './locationManifestRepository';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { ThreeLocationWorldView } from './ThreeLocationWorldView';

/**
 * The generic view's wiring, with the scene replaced by a stub that hands
 * back the event bus so each test can play the scene's part. The runtime
 * itself is covered by `createLocationEngine.test.ts`.
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string } | null,
  dispose: vi.fn(),
  interact: vi.fn(),
}));

vi.mock('./createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (
      _parent: HTMLElement,
      bus: WorldEngineEventBus,
      _manifest: ThreeLocationManifest,
      options: { startCheckpointId?: string },
    ) => {
      engine.bus = bus;
      engine.options = options;
      return { dispose: engine.dispose, interact: engine.interact, ready: Promise.resolve() };
    },
  ),
}));

vi.mock('../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../DiscoveryAction', () => ({
  DiscoveryAction: ({
    discoveryId,
    onDiscovered,
  }: {
    discoveryId: string;
    onDiscovered: () => void;
  }) => (
    <button type="button" onClick={onDiscovered}>
      discover {discoveryId}
    </button>
  ),
}));

vi.mock('../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
}));
vi.mock('../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));
vi.mock('../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../discovery/api';
import { listAllWorldChanges } from '../../../adventures/api';
import { getInventory } from '../../../rewards/api';
import { listQuestStates } from '../../../quests/api';
import { getCompanionProfile } from '../../../island/api';

const getWorldStateMock = vi.mocked(getWorldState);
const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);

function repositoryOf(...manifests: ThreeLocationManifest[]): LocationManifestRepository {
  return {
    getPublished: async (regionId) => {
      const manifest = manifests.find((candidate) => candidate.regionId === regionId);
      if (!manifest) throw new LocationManifestNotFoundError(regionId);
      return manifest;
    },
    listRegionIds: () => manifests.map((manifest) => manifest.regionId),
  };
}

/** A second, unrelated location, to show one view serves any manifest (acceptance A1). */
const TEST_COVE: ThreeLocationManifest = {
  ...WELCOME_HARBOR_MANIFEST,
  regionId: 'test-cove',
  title: 'Test Cove',
  npcs: [],
  collectibles: [],
  buildings: [],
  zones: [
    { rect: { id: 'cove-cave', minX: 0, maxX: 2, minZ: 0, maxZ: 2 }, enterMessage: 'A dark cave.' },
  ],
  interactions: [
    {
      id: 'cove-cave',
      type: 'DISCOVERY',
      trigger: 'ENTER',
      title: 'Peek into the cave',
      targetId: 'cove-secret',
      action: { kind: 'DISCOVER', discoveryId: 'cove-secret' },
    },
    {
      id: 'cove-boat',
      type: 'LOCATION',
      trigger: 'TAP',
      title: 'Sail on',
      targetId: 'boat',
      requirements: [{ type: 'DISCOVERY_PRESENT', discoveryId: 'cove-secret' }],
      action: { kind: 'NAVIGATE', to: 'worlds' },
    },
  ],
  copy: {
    loading: 'Loading Test Cove...',
    instructions: 'Explore the cove.',
    altNav: { label: 'Back to the island map', to: 'world' },
  },
};

function renderView(
  regionId = 'welcome-harbor',
  repository = repositoryOf(WELCOME_HARBOR_MANIFEST, TEST_COVE),
) {
  return render(
    <MemoryRouter>
      <ThreeLocationWorldView
        childId="child-1"
        regionId={regionId}
        ageBand="PATHFINDER"
        repository={repository}
      />
    </MemoryRouter>,
  );
}

/** Plays the scene's part once the view has mounted it; fails rather than silently doing nothing. */
async function emit<Name extends Parameters<WorldEngineEventBus['emit']>[0]>(
  name: Name,
  detail: Parameters<WorldEngineEventBus['emit']>[1] & object,
) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    engine.bus!.emit(name, detail as never);
  });
}

describe('ThreeLocationWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    getWorldStateMock.mockResolvedValue({
      discoveredIds: [],
      metCharacterIds: [],
      lastCheckpointId: 'welcome-harbor:shed',
    });
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    listAllWorldChangesMock.mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows the manifest’s copy and spawns at the saved checkpoint', async () => {
    renderView();
    expect(await screen.findByText(/Walk up to Pip and press E/)).toBeInTheDocument();
    await waitFor(() => expect(engine.options?.startCheckpointId).toBe('welcome-harbor:shed'));
    expect(
      screen.getByRole('link', { name: 'Prefer not to walk in 3D? Go back to the harbor' }),
    ).toHaveAttribute('href', '/island/child-1');
  });

  it('still opens the region when the world reads fail, spawning at the default checkpoint', async () => {
    getWorldStateMock.mockRejectedValue(new Error('offline'));
    renderView();
    await screen.findByText(/Walk up to Pip/);
    await waitFor(() => expect(engine.options).not.toBeNull());
    expect(engine.options?.startCheckpointId).toBeUndefined();
  });

  it('says calmly when a location has no manifest', async () => {
    renderView('nowhere');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This part of the island isn't open yet.",
    );
    expect(screen.getByRole('link', { name: 'Go back to the harbor' })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });

  it('refuses to render an invalid manifest', async () => {
    const broken: LocationManifestRepository = {
      getPublished: async () => {
        throw new InvalidLocationManifestError('welcome-harbor', []);
      },
      listRegionIds: () => [],
    };
    renderView('welcome-harbor', broken);
    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be loaded");
    expect(engine.bus).toBeNull();
  });

  it('saves only this location’s authored checkpoints', async () => {
    renderView();
    await screen.findByText(/Walk up to Pip/);
    await emit('PlayerEnteredZone', { zoneId: 'welcome-harbor:lookout' });
    await emit('PlayerEnteredZone', { zoneId: 'pirate-builder-bay:dock' });
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'welcome-harbor:lookout');
  });

  it('shows the authored toast on entering a building', async () => {
    renderView();
    await screen.findByText(/Walk up to Pip/);
    await emit('PlayerEnteredZone', { zoneId: 'lookout-tower:interior' });
    expect(screen.getByText("You're inside the lookout tower.")).toBeInTheDocument();
  });

  it('records meeting an NPC when the child walks up to them', async () => {
    renderView();
    await screen.findByText(/Walk up to Pip/);
    await emit('NpcApproached', { entityId: 'pirate-pip' });
    expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'pirate-pip');
  });

  it('labels the NPC in the crosshair and opens their conversation on interact', async () => {
    renderView();
    await screen.findByText(/Walk up to Pip/);
    await emit('InteractableFocused', { entityId: 'pirate-pip' });
    expect(screen.getByText('Pip: press E to talk')).toBeInTheDocument();

    await emit('ObjectInteracted', { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' });
    expect(screen.getByRole('dialog', { name: 'Say hello to Pip' })).toBeInTheDocument();
    expect(screen.getByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
  });

  it('offers everything in a non-graphical list', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('Things to do here'));
    await user.click(screen.getByRole('button', { name: 'Say hello to Pip' }));
    expect(screen.getByRole('dialog', { name: 'Say hello to Pip' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: "Interact with what you're looking at" }));
    expect(engine.interact).toHaveBeenCalledTimes(1);
  });

  it('renders an unrelated location through the same view, with walk-in and gated interactions (A1)', async () => {
    const user = userEvent.setup();
    renderView('test-cove');
    expect(await screen.findByText('Explore the cove.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the island map' })).toHaveAttribute(
      'href',
      '/island/child-1/world',
    );
    expect(screen.queryByRole('button', { name: 'Sail on' })).not.toBeInTheDocument();

    await emit('PlayerEnteredZone', { zoneId: 'cove-cave' });
    expect(screen.getByText('A dark cave.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Peek into the cave' })).toBeInTheDocument();

    getWorldStateMock.mockResolvedValue({ discoveredIds: ['cove-secret'], metCharacterIds: [] });
    await user.click(screen.getByRole('button', { name: 'discover cove-secret' }));
    expect(await screen.findByRole('button', { name: 'Sail on' })).toBeInTheDocument();
  });

  it('stops listening and disposes the scene on unmount', async () => {
    const view = renderView();
    await screen.findByText(/Walk up to Pip/);
    const bus = engine.bus;
    view.unmount();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    act(() => {
      bus?.emit('PlayerEnteredZone', { zoneId: 'welcome-harbor:dock' });
    });
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});
