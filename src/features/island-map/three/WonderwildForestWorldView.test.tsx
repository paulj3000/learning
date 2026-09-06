import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../child-profile/constants';
import type { WorldEngineEventBus } from './worldEngineEvents';

const disposeSpy = vi.fn();
const interactSpy = vi.fn();
let capturedBus: WorldEngineEventBus | null = null;
let capturedOptions: Record<string, unknown> | null = null;

vi.mock('./wonderwildForestScene', () => ({
  createWonderwildForestEngine: vi.fn(
    (_parent: HTMLDivElement, bus: WorldEngineEventBus, options: Record<string, unknown>) => {
      capturedBus = bus;
      capturedOptions = options;
      return { dispose: disposeSpy, interact: interactSpy };
    },
  ),
}));

vi.mock('../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));

vi.mock('../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import { WonderwildForestWorldView } from './WonderwildForestWorldView';
import { createWonderwildForestEngine } from './wonderwildForestScene';
import { listAllWorldChanges, resumeOrStartSession } from '../../adventures/api';
import { getWorldState, saveCheckpoint } from '../../discovery/api';
import { getInventory } from '../../rewards/api';
import { listQuestStates } from '../../quests/api';
import { getCompanionProfile } from '../../island/api';
import { BUZZ_AND_THE_WAGGLE_DANCE } from '../../adventures/content/buzzAndTheWaggleDance';

const createEngineMock = vi.mocked(createWonderwildForestEngine);
const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const resumeOrStartSessionMock = vi.mocked(resumeOrStartSession);
const getWorldStateMock = vi.mocked(getWorldState);
const saveCheckpointMock = vi.mocked(saveCheckpoint);
const getInventoryMock = vi.mocked(getInventory);
const listQuestStatesMock = vi.mocked(listQuestStates);
const getCompanionProfileMock = vi.mocked(getCompanionProfile);

function renderView(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/wonderwild-forest-3d']}>
      <Routes>
        <Route
          path="/island/:childId/world/wonderwild-forest-3d"
          element={<WonderwildForestWorldView childId="child-1" ageBand={ageBand} />}
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Renders, then waits for the engine to actually exist. Waiting on the
 * instructions text alone is not enough and is genuinely flaky - the reason
 * is documented at length in `StorykeeperCastleWorldView.test.tsx`, and SC-3
 * paid for learning it.
 */
async function renderAndWaitForEngine(ageBand: AgeBandValue = 'PATHFINDER') {
  const utils = renderView(ageBand);
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => {
    expect(createEngineMock).toHaveBeenCalled();
  });
  return utils;
}

describe('WonderwildForestWorldView', () => {
  beforeEach(() => {
    disposeSpy.mockReset();
    interactSpy.mockReset();
    createEngineMock.mockClear();
    capturedBus = null;
    capturedOptions = null;

    listAllWorldChangesMock.mockReset();
    resumeOrStartSessionMock.mockReset();
    getWorldStateMock.mockReset();
    saveCheckpointMock.mockReset();
    getInventoryMock.mockReset();
    listQuestStatesMock.mockReset();
    getCompanionProfileMock.mockReset();

    listAllWorldChangesMock.mockResolvedValue([]);
    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    saveCheckpointMock.mockResolvedValue(undefined);
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    listQuestStatesMock.mockResolvedValue([]);
    getCompanionProfileMock.mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.getByText(/loading wonderwild forest/i)).toBeInTheDocument();
  });

  it('still renders the world when every read fails, rather than stranding the child', async () => {
    listAllWorldChangesMock.mockRejectedValue(new Error('offline'));
    getWorldStateMock.mockRejectedValue(new Error('offline'));
    renderView();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  it('renders the scene and HUD, and lists the available interactions once ready', async () => {
    await renderAndWaitForEngine();
    expect(screen.getByText('The buzzing bee hive')).toBeInTheDocument();
    expect(screen.getByText('Peek at the hive')).toBeInTheDocument();
    expect(screen.getByText('A quiet pond')).toBeInTheDocument();
    expect(screen.getByText('A pile of leaves')).toBeInTheDocument();
    expect(screen.getByText('A shadowy cave')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('disposes the engine on unmount without leaking it', async () => {
    const { unmount } = await renderAndWaitForEngine();
    unmount();
    await waitFor(() => expect(disposeSpy).toHaveBeenCalled());
  });

  it('saves a checkpoint when the child crosses one, by its authored id', async () => {
    await renderAndWaitForEngine();
    act(() =>
      capturedBus?.emit('PlayerEnteredZone', { zoneId: 'wonderwild-forest:hive-clearing' }),
    );
    await waitFor(() =>
      expect(saveCheckpointMock).toHaveBeenCalledWith('child-1', 'wonderwild-forest:hive-clearing'),
    );
  });

  it('names what the reticle is on, in the authored interaction title', async () => {
    await renderAndWaitForEngine();
    act(() => capturedBus?.emit('InteractableFocused', { entityId: 'wonderwild-pond-frog' }));
    expect(await screen.findByText('A quiet pond')).toBeInTheDocument();
    act(() => capturedBus?.emit('InteractableFocused', { entityId: null }));
  });

  it('opens the authored flavour line when the child aims at a prop and presses E', async () => {
    await renderAndWaitForEngine();
    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'wonderwild-leaf-pile',
        interactionId: 'wonderwild-leaf-pile',
      }),
    );
    expect(
      await screen.findByText(/Red, gold, and brown leaves rustle in a soft pile/),
    ).toBeInTheDocument();
  });

  it('offers the way out to Welcome Harbor when the child reaches it', async () => {
    await renderAndWaitForEngine();
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'wonderwild-harbor-exit' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'The path back to Welcome Harbor',
    });
    expect(dialog).toBeInTheDocument();
  });

  describe('the hive clearing carries the same before/after pair the Phaser forest does', () => {
    it('offers the tale while the waggle dance is undiscovered', async () => {
      await renderAndWaitForEngine();
      act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'wonderwild-hive-clearing' }));
      expect(
        await screen.findByRole('dialog', { name: 'The buzzing bee hive' }),
      ).toBeInTheDocument();
    });

    it('narrates the payoff instead once it is discovered', async () => {
      listAllWorldChangesMock.mockResolvedValue([
        { changeKey: 'WAGGLE_DANCE_DISCOVERED' },
      ] as never);
      await renderAndWaitForEngine();
      act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'wonderwild-hive-clearing' }));
      expect(
        await screen.findByRole('dialog', { name: 'The hive you already discovered' }),
      ).toBeInTheDocument();
    });
  });

  it('starts the real, unchanged adventure and navigates to the existing route', async () => {
    const user = userEvent.setup();
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: BUZZ_AND_THE_WAGGLE_DANCE.entryStepId,
    } as never);
    await renderAndWaitForEngine();

    await user.click(screen.getByRole('button', { name: 'The buzzing bee hive' }));
    await user.click(await screen.findByRole('button', { name: /start the adventure/i }));

    await waitFor(() => expect(resumeOrStartSessionMock).toHaveBeenCalled());
    // The engine is untouched: the same authored definition the card route runs.
    expect(resumeOrStartSessionMock.mock.calls[0][1]).toBe(BUZZ_AND_THE_WAGGLE_DANCE);
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('tells a Sprout the tale is not for their band rather than starting it', async () => {
    // `buzz-and-the-waggle-dance` is `ageBands: ['PATHFINDER']`, and the 3D
    // route must respect that exactly as the card route does.
    const user = userEvent.setup();
    await renderAndWaitForEngine('SPROUT');
    await user.click(screen.getByRole('button', { name: 'The buzzing bee hive' }));
    expect(await screen.findByText(/not available for your age yet/i)).toBeInTheDocument();
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  describe('construction-time world state', () => {
    it('builds the forest already changed for a child who told the tale', async () => {
      listAllWorldChangesMock.mockResolvedValue([
        { changeKey: 'WAGGLE_DANCE_DISCOVERED' },
      ] as never);
      await renderAndWaitForEngine();
      await waitFor(() => expect(capturedOptions?.waggleDanceDiscovered).toBe(true));
    });

    it('carries the cross-location butterfly flag through unchanged', async () => {
      // `wonderwildForestDecor.ts` already draws the visiting butterfly only
      // once the garden is saved elsewhere on the island. Same mechanism.
      listAllWorldChangesMock.mockResolvedValue([
        { changeKey: 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE' },
      ] as never);
      await renderAndWaitForEngine();
      await waitFor(() => expect(capturedOptions?.butterflyGardenComplete).toBe(true));
    });

    it('lights the cave only for a child carrying the jar', async () => {
      getInventoryMock.mockResolvedValue({
        ownedItemIds: ['glowing-moss-jar'],
        grantedRuleIds: [],
      });
      await renderAndWaitForEngine();
      await waitFor(() => expect(capturedOptions?.hasGlowingMossJar).toBe(true));
    });

    it('spawns at the last authored checkpoint, never a raw coordinate', async () => {
      getWorldStateMock.mockResolvedValue({
        discoveredIds: [],
        metCharacterIds: [],
        lastCheckpointId: 'wonderwild-forest:pond',
      } as never);
      await renderAndWaitForEngine();
      await waitFor(() =>
        expect(capturedOptions?.startCheckpointId).toBe('wonderwild-forest:pond'),
      );
    });
  });
});
