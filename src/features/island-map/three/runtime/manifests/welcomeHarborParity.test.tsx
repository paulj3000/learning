import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 5 parity (`docs/engine/09_MIGRATION_PLAN.md` step 7): every
 * behaviour `WelcomeHarborWorldView.test.tsx` asserts of the old view, run
 * against the generic view, the real Welcome Harbor manifest and the real
 * source-controlled repository, plus the event wiring the old view had but
 * never tested (checkpoint saves, building toasts, NPC met, crosshair label,
 * interacting with Pip). The scene is stubbed the same way the old test
 * stubbed `welcomeHarborScene`; the runtime has its own tests.
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string } | null,
}));

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, _manifest: unknown, options: object) => {
      engine.bus = bus;
      engine.options = options;
      return { dispose: vi.fn(), interact: vi.fn(), ready: Promise.resolve() };
    },
  ),
}));

vi.mock('../../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
}));
vi.mock('../../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));
vi.mock('../../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { listAllWorldChanges } from '../../../../adventures/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

function renderHarbor() {
  return render(
    <MemoryRouter>
      <ThreeLocationWorldView childId="child-1" regionId="welcome-harbor" ageBand="PATHFINDER" />
    </MemoryRouter>,
  );
}

function emit(run: (bus: WorldEngineEventBus) => void) {
  act(() => {
    if (engine.bus) run(engine.bus);
  });
}

describe('Welcome Harbor on the generic view: parity with WelcomeHarborWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', async () => {
    vi.mocked(getWorldState).mockReturnValue(new Promise(() => {}));
    renderHarbor();
    expect(await screen.findByText(/loading welcome harbor/i)).toBeInTheDocument();
  });

  it('renders the 3D scene and HUD once ready', async () => {
    renderHarbor();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('opens a conversation with Pip from the "Things to do here" list', async () => {
    const user = userEvent.setup();
    renderHarbor();
    await user.click(await screen.findByRole('button', { name: /say hello to pip/i }));
    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
  });

  it("shows the companion's name in the HUD once its profile loads", async () => {
    vi.mocked(getCompanionProfile).mockResolvedValue({
      id: 'c1',
      childProfileId: 'child-1',
      companionType: 'CHATTY_PARROT',
      displayName: 'Chatty',
    } as never);
    renderHarbor();
    expect(await screen.findByText('Chatty')).toBeInTheDocument();
  });

  it('offers a link back to the non-3D harbor', async () => {
    renderHarbor();
    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });

  it('spawns at the saved checkpoint, as the old view passed to its scene', async () => {
    vi.mocked(getWorldState).mockResolvedValue({
      discoveredIds: [],
      metCharacterIds: [],
      lastCheckpointId: 'welcome-harbor:lookout',
    });
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    expect(engine.options).toEqual({ startCheckpointId: 'welcome-harbor:lookout' });
  });

  it('saves each harbour checkpoint the child walks into', async () => {
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    for (const zoneId of ['welcome-harbor:dock', 'welcome-harbor:lookout', 'welcome-harbor:shed']) {
      emit((bus) => bus.emit('PlayerEnteredZone', { zoneId }));
    }
    expect(vi.mocked(saveCheckpoint).mock.calls).toEqual([
      ['child-1', 'welcome-harbor:dock'],
      ['child-1', 'welcome-harbor:lookout'],
      ['child-1', 'welcome-harbor:shed'],
    ]);
  });

  it('shows the same toasts on stepping into either building', async () => {
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'lookout-tower:interior' }));
    expect(screen.getByText("You're inside the lookout tower.")).toBeInTheDocument();
    emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'dockside-shed:interior' }));
    expect(screen.getByText("You're inside the dockside shed.")).toBeInTheDocument();
  });

  it('records meeting Pip and tells the scene, as useNpcApproachBridge did', async () => {
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    const stateChanges: unknown[] = [];
    emit((bus) => {
      bus.on('NpcStateChanged', (detail) => stateChanges.push(detail));
      bus.emit('NpcApproached', { entityId: 'pirate-pip' });
    });
    expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'pirate-pip');
    expect(stateChanges).toEqual([{ entityId: 'pirate-pip', metByChild: true }]);
  });

  it('labels Pip in the crosshair, and only Pip', async () => {
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    emit((bus) => bus.emit('InteractableFocused', { entityId: 'pirate-pip' }));
    expect(screen.getByText('Pip: press E to talk')).toBeInTheDocument();
    emit((bus) => bus.emit('InteractableFocused', { entityId: 'harbor-collectible-gem' }));
    expect(screen.queryByText(/press E to talk/)).not.toBeInTheDocument();
  });

  it('opens the conversation with Pip when the child interacts with him in the scene', async () => {
    renderHarbor();
    await screen.findByText(/move: wasd/i);
    emit((bus) =>
      bus.emit('ObjectInteracted', { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' }),
    );
    expect(screen.getByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
  });
});
