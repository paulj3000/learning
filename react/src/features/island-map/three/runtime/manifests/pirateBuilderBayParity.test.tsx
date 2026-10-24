import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../../../../adventures/content/repairTheMoonlightBridge';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 7 parity: every behaviour `PirateBuilderBayWorldView.test.tsx`
 * asserts of the old Bay view, run against the generic view, the real Bay
 * manifest, and the real `tide-trial` extension's overlay (only the scene
 * half is faked, as the old test faked the bay scene's `tideTrial`). Plus
 * the spatial wiring the old view had but never tested: the bridge zone,
 * prop interactions and labels, and handing the child's world state to the
 * scene so the bridge is built broken or mended.
 */
const fakeTideTrial = vi.hoisted(() => ({
  begin: vi.fn(),
  setDeckHeight: vi.fn(),
  runTide: vi.fn(() => Promise.resolve()),
  rebuild: vi.fn(),
  complete: vi.fn(),
  cancel: vi.fn(),
}));

const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as {
    startCheckpointId?: string;
    worldState?: { worldChangeKeys: readonly string[] };
  } | null,
}));

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, _manifest: unknown, options: object) => {
      engine.bus = bus;
      engine.options = options;
      return {
        dispose: vi.fn(),
        interact: vi.fn(),
        extensionApi: (id: string) => (id === 'tide-trial' ? fakeTideTrial : undefined),
        ready: Promise.resolve(),
      };
    },
  ),
}));

vi.mock('../../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
}));
vi.mock('../../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));
vi.mock('../../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import {
  listAllWorldChanges,
  recordWorldChangeOnce,
  resumeOrStartSession,
} from '../../../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

function renderBay(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/pirate-builder-bay']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="pirate-builder-bay"
              ageBand={ageBand}
            />
          }
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Plays the scene's part once the view has mounted it; fails rather than silently doing nothing. */
async function emit(run: (bus: WorldEngineEventBus) => void) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    run(engine.bus!);
  });
}

describe('Pirate Builder Bay on the generic view: parity with PirateBuilderBayWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    vi.mocked(recordWorldChangeOnce).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', async () => {
    vi.mocked(listAllWorldChanges).mockReturnValue(new Promise(() => {}));
    renderBay();
    expect(await screen.findByText(/loading pirate builder bay/i)).toBeInTheDocument();
  });

  it('renders the 3D scene and HUD, and lists the always-available interactions once ready', async () => {
    renderBay();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(screen.getByText('The broken Moonlight Bridge')).toBeInTheDocument();
    expect(screen.getByText('Pirate Pip')).toBeInTheDocument();
    expect(screen.getByText('A coil of rope')).toBeInTheDocument();
    expect(screen.getByText("Pirate Pip's toolbox")).toBeInTheDocument();
    expect(screen.getByText('A hidden treasure chest')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    vi.mocked(resumeOrStartSession).mockResolvedValue({
      id: 'session-1',
      currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
    } as never);
    renderBay();
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));
    await waitFor(() => {
      expect(resumeOrStartSession).toHaveBeenCalledWith('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('gives an Explorer the in-scene Beat the Tide challenge instead of the card adventure', async () => {
    const user = userEvent.setup();
    renderBay('EXPLORER');
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    expect(screen.getByRole('region', { name: 'Beat the Tide' })).toBeInTheDocument();
    expect(fakeTideTrial.begin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /start the adventure/i })).not.toBeInTheDocument();
    expect(resumeOrStartSession).not.toHaveBeenCalled();
  });

  it("repairs the bridge for real when an Explorer's deck survives the tide", async () => {
    const user = userEvent.setup();
    renderBay('EXPLORER');
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Raise the deck' }));
    }
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));

    expect(
      await screen.findByRole('button', { name: 'Walk across the bridge' }),
    ).toBeInTheDocument();
    expect(fakeTideTrial.complete).toHaveBeenCalledTimes(1);
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'pirate-builder-bay',
      'REPAIR',
      'BRIDGE_REPAIRED',
      'exploration:beat-the-tide',
    );

    await user.click(screen.getByRole('button', { name: 'Walk across the bridge' }));
    expect(screen.queryByRole('region', { name: 'Beat the Tide' })).not.toBeInTheDocument();
    expect(fakeTideTrial.cancel).not.toHaveBeenCalled();
  });

  it('offers the repaired-bridge narration instead of the adventure once the bridge is repaired', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);
    renderBay();
    expect(await screen.findByText('The repaired Moonlight Bridge')).toBeInTheDocument();
    expect(screen.queryByText('The broken Moonlight Bridge')).not.toBeInTheDocument();
  });

  it('opens a conversation with Pip instead of trying to start a session', async () => {
    const user = userEvent.setup();
    renderBay();
    await user.click(await screen.findByText('Pirate Pip'));
    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
    expect(resumeOrStartSession).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();
    renderBay();
    await user.click(await screen.findByText('Pirate Pip'));
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("shows the companion's name in the HUD once its profile loads", async () => {
    vi.mocked(getCompanionProfile).mockResolvedValue({
      id: 'c1',
      childProfileId: 'child-1',
      companionType: 'CHATTY_PARROT',
      displayName: 'Chatty',
    } as never);
    renderBay();
    expect(await screen.findByText('Chatty')).toBeInTheDocument();
  });

  it('offers a link back to the non-3D location page', async () => {
    renderBay();
    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1/locations/pirate-builder-bay',
    );
  });

  describe('spatial wiring the old view had but never tested', () => {
    it('hands the scene the child’s world state, so the bridge is built mended', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);
      renderBay();
      await waitFor(() =>
        expect(engine.options?.worldState?.worldChangeKeys).toEqual(['BRIDGE_REPAIRED']),
      );
    });

    it('walking up to the broken bridge opens the adventure for a Pathfinder', async () => {
      renderBay();
      await screen.findByText(/move: wasd/i);
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'bay-broken-bridge' }));
      expect(
        screen.getByRole('dialog', { name: 'The broken Moonlight Bridge' }),
      ).toBeInTheDocument();
    });

    it('walking up to the broken bridge opens Beat the Tide for an Explorer, once', async () => {
      renderBay('EXPLORER');
      await screen.findByText(/move: wasd/i);
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'bay-broken-bridge' }));
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'bay-broken-bridge' }));
      expect(screen.getAllByRole('region', { name: 'Beat the Tide' })).toHaveLength(1);
      expect(fakeTideTrial.begin).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('walking up to the mended bridge shows its narration', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);
      renderBay();
      await screen.findByText(/move: wasd/i);
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'bay-broken-bridge' }));
      expect(screen.getByText(/the bridge glows in the moonlight/i)).toBeInTheDocument();
    });

    it('labels and opens a prop by its entity id', async () => {
      renderBay();
      await screen.findByText(/move: wasd/i);
      await emit((bus) => bus.emit('InteractableFocused', { entityId: 'bay-toolbox' }));
      expect(screen.getByText("Pirate Pip's toolbox: press E to talk")).toBeInTheDocument();
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'bay-toolbox',
          interactionId: 'bay-toolbox:interact',
        }),
      );
      expect(screen.getByText(/hammer, nails, and a measuring string/i)).toBeInTheDocument();
    });

    it('saves the bay’s checkpoints, including the bridge approach', async () => {
      renderBay();
      await screen.findByText(/move: wasd/i);
      await emit((bus) =>
        bus.emit('PlayerEnteredZone', { zoneId: 'pirate-builder-bay:bridge-approach' }),
      );
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'pirate-builder-bay:bridge-approach');
    });

    it('takes the path home through the harbor exit', async () => {
      renderBay();
      await screen.findByText(/move: wasd/i);
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'bay-harbor-exit' }));
      expect(screen.getByRole('link', { name: 'Go there' })).toHaveAttribute(
        'href',
        '/island/child-1/world',
      );
    });
  });
});
