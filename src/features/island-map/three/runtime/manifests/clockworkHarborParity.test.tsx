import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { CLOCKWORK_CHANGE_KEYS, goldenGearChangeKey } from '../../../../clockwork-harbor/types';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { WorldInteractionContext } from '../../../worldObjects';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 9 parity for Clockwork Harbor. The region had no view test of
 * its own - it had no UI entry point either - so this is every behaviour
 * `ClockworkHarborWorldView.tsx` implemented, asserted for the first time
 * against the generic view and the real manifest: the two NPCs, the district
 * toasts, the checkpoint saves, the status line, the machine's adaptive
 * entrance, and the golden gears, which now stay found.
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string; worldState?: WorldInteractionContext } | null,
  interact: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, _manifest: unknown, options: object) => {
      engine.bus = bus;
      engine.options = options;
      return {
        dispose: engine.dispose,
        interact: engine.interact,
        extensionApi: () => undefined,
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
vi.mock('../../../../mastery/api', () => ({ listSkillProgress: vi.fn() }));

import {
  listAllWorldChanges,
  recordWorldChangeOnce,
  resumeOrStartSession,
} from '../../../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';
import { listSkillProgress } from '../../../../mastery/api';

function renderHarbor(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/clockwork-harbor']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="clockwork-harbor"
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

async function emit(run: (bus: WorldEngineEventBus) => void) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    run(engine.bus!);
  });
}

async function renderAndWait(ageBand: AgeBandValue = 'PATHFINDER') {
  const utils = renderHarbor(ageBand);
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

describe('Clockwork Harbor on the generic view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] } as never);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(recordWorldChangeOnce).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
    vi.mocked(listSkillProgress).mockResolvedValue([]);
  });

  it('shows the dark harbor’s status line, and the lit one once it is fixed', async () => {
    await renderAndWait();
    expect(
      screen.getByText('The lighthouse is dark. The Harbor Master is waiting on the dock.'),
    ).toBeInTheDocument();

    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED },
    ] as never);
    const view = renderHarbor();
    expect(
      await screen.findByText('The lighthouse is turning again, and the harbor gate is open.'),
    ).toBeInTheDocument();
    view.unmount();
  });

  it('offers both NPCs and the machine in the non-graphical list, with the gear note', async () => {
    await renderAndWait();
    expect(screen.getByText('Talk to the Harbor Master')).toBeInTheDocument();
    expect(screen.getByText('Talk to Professor Ticktock')).toBeInTheDocument();
    expect(screen.getByText('Look at the machine inside the lighthouse')).toBeInTheDocument();
    expect(screen.getByText(/3 golden gears hidden around the harbor/)).toBeInTheDocument();
  });

  it('opens a conversation with the NPC the child walks up to and interacts with', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('NpcApproached', { entityId: 'harbor-master' }));
    expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'harbor-master');

    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'professor-ticktock',
        interactionId: 'professor-ticktock:talk',
      }),
    );
    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('professor-ticktock');
  });

  it('names the district the child walks into', async () => {
    await renderAndWait();
    await emit((bus) =>
      bus.emit('PlayerEnteredZone', { zoneId: 'clockwork-harbor:zone:marketplace' }),
    );
    expect(await screen.findByText("You're at the marketplace.")).toBeInTheDocument();
  });

  it('saves this region’s checkpoints only', async () => {
    await renderAndWait();
    await emit((bus) =>
      bus.emit('PlayerEnteredZone', { zoneId: 'clockwork-harbor:harbor-entrance' }),
    );
    await waitFor(() =>
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'clockwork-harbor:harbor-entrance'),
    );
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'welcome-harbor:dock' }));
    expect(saveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('keeps a found golden gear found, which the per-region view never did', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('CollectiblePickedUp', { entityId: 'golden-gear-02' }));
    expect(await screen.findByText('You found a golden gear.')).toBeInTheDocument();
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'clockwork-harbor',
      'COLLECTIBLE_FOUND',
      goldenGearChangeKey('golden-gear-02'),
      'exploration:golden-gear-02',
    );
  });

  it('opens the adaptive entrance at the machine, and starts the variant it chose', async () => {
    const user = userEvent.setup();
    vi.mocked(resumeOrStartSession).mockResolvedValue({ id: 'session-1' } as never);
    await renderAndWait();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'clockwork-harbor:prop:lighthouse-mechanism',
        interactionId: 'clockwork-harbor:prop:lighthouse-mechanism:interact',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'The lighthouse machine' });
    expect(dialog).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /start the adventure/i }));
    await waitFor(() => expect(resumeOrStartSession).toHaveBeenCalled());
    // A real authored Dark Lighthouse variant, chosen by demonstrated maths.
    expect(vi.mocked(resumeOrStartSession).mock.calls[0]![1].locationSlug).toBe('clockwork-harbor');
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('tells the child the machine is already running once the lighthouse is fixed', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED },
    ] as never);
    await renderAndWait();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'clockwork-harbor:prop:lighthouse-mechanism',
        interactionId: 'clockwork-harbor:prop:lighthouse-mechanism:interact',
      }),
    );
    expect(
      await screen.findByText('The machine is humming along. The lamp is already turning.'),
    ).toBeInTheDocument();
    expect(resumeOrStartSession).not.toHaveBeenCalled();
  });

  it('hands the child’s world state to the scene, not a hand-passed flag', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED },
    ] as never);
    await renderAndWait();
    await waitFor(() =>
      expect(engine.options?.worldState?.worldChangeKeys).toContain(
        CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED,
      ),
    );
  });

  it('offers the non-graphical way back to the island map', async () => {
    await renderAndWait();
    expect(
      screen.getByRole('link', { name: 'Prefer not to walk in 3D? Go back to the island map' }),
    ).toHaveAttribute('href', '/island/child-1');
  });
});
