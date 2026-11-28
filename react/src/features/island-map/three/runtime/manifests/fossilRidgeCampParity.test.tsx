import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * LAI-2206 parity: every behaviour `FossilRidgeCampWorldView.test.tsx` asserts
 * of the Phaser camp, run against the generic view and the real manifest,
 * plus what walking adds (the skeleton and tools by interacting, the exit by
 * walking into it).
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  interact: vi.fn(),
  dispose: vi.fn(),
  created: 0,
}));

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn((_parent: HTMLElement, bus: WorldEngineEventBus) => {
    engine.bus = bus;
    engine.created += 1;
    return {
      dispose: engine.dispose,
      interact: engine.interact,
      extensionApi: () => undefined,
      ready: Promise.resolve(),
    };
  }),
}));

vi.mock('../../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => <div>conversation with {npcId}</div>,
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

import { listAllWorldChanges, resumeOrStartSession } from '../../../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';
import { openThingsToDo } from '../../../../../test/gameplayMenus';

const UNLOCKED = [{ changeKey: 'DINOSAUR_EXPEDITION_COMPLETE' }] as never;

function renderCamp() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/fossil-ridge-camp']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="fossil-ridge-camp"
              ageBand="PATHFINDER"
            />
          }
        />
        <Route path="/island/:childId" element={<p>Map route</p>} />
        <Route path="/island/:childId/world" element={<p>World route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderUnlocked() {
  vi.mocked(listAllWorldChanges).mockResolvedValue(UNLOCKED);
  const utils = renderCamp();
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

async function emit(run: (bus: WorldEngineEventBus) => void) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    run(engine.bus!);
  });
}

describe('Fossil Ridge Camp on the generic view: parity with FossilRidgeCampWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.created = 0;
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] } as never);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows a loading state before world changes resolve', async () => {
    vi.mocked(listAllWorldChanges).mockReturnValue(new Promise(() => {}));
    renderCamp();
    expect(await screen.findByText(/loading fossil ridge camp/i)).toBeInTheDocument();
    expect(engine.created).toBe(0);
  });

  it('shows a calm not-discovered-yet message, and builds no scene, before the story is done', async () => {
    renderCamp();
    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(engine.created).toBe(0);
  });

  it('keeps the camp closed when progress cannot be read (fails closed)', async () => {
    vi.mocked(listAllWorldChanges).mockRejectedValue(new Error('offline'));
    renderCamp();
    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(engine.created).toBe(0);
  });

  it('lets a not-yet-unlocked child go back to the map', async () => {
    const user = userEvent.setup();
    renderCamp();
    await user.click(await screen.findByRole('link', { name: /back to the map/i }));
    expect(await screen.findByText('Map route')).toBeInTheDocument();
  });

  it('builds the scene and lists every always-available interaction once the story is complete', async () => {
    await renderUnlocked();
    expect(engine.created).toBe(1);
    await openThingsToDo();
    expect(screen.getByRole('button', { name: 'The assembled skeleton' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A set of dig tools' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'The path back to Welcome Harbor' }),
    ).toBeInTheDocument();
  });

  it('shows a plain message for the skeleton instead of trying to start a session', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await openThingsToDo();
    await user.click(screen.getByRole('button', { name: 'The assembled skeleton' }));
    expect(await screen.findByText(/fully assembled/i)).toBeInTheDocument();
    expect(resumeOrStartSession).not.toHaveBeenCalled();
  });

  it('shows the same line when the child walks up to the skeleton and interacts', async () => {
    await renderUnlocked();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'fossil-ridge-skeleton',
        interactionId: 'meet-the-fossil',
      }),
    );
    expect(
      await screen.findByText(
        'Round feet, blunt toes, huge steps: a giant plant eater, fully assembled at last.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the dig tools line when the child interacts with them', async () => {
    await renderUnlocked();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'fossil-ridge-dig-tools',
        interactionId: 'fossil-ridge-dig-tools',
      }),
    );
    expect(
      await screen.findByText(
        'Brushes, a sieve, and a notebook full of measurements, ready for the next dig.',
      ),
    ).toBeInTheDocument();
  });

  it('offers the way back to Welcome Harbor when the child walks into the exit', async () => {
    await renderUnlocked();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'fossil-ridge-camp-harbor-exit' }));
    expect(await screen.findByRole('link', { name: 'Go there' })).toHaveAttribute(
      'href',
      '/island/child-1/world',
    );
  });

  it('saves the trailhead checkpoint when the child crosses it', async () => {
    await renderUnlocked();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'fossil-ridge-camp:trailhead' }));
    await waitFor(() =>
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'fossil-ridge-camp:trailhead'),
    );
  });

  it('always offers the location page instead of walking', async () => {
    await renderUnlocked();
    const links = screen.getAllByRole('link', {
      name: 'Prefer not to walk? Use the location page instead',
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/island/child-1/locations/fossil-ridge-camp');
    }
  });

  it('offers a way to interact without aiming', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await user.click(await screen.findByRole('button', { name: 'Things to do' }));
    await user.click(screen.getByRole('button', { name: "Interact with what you're looking at" }));
    expect(engine.interact).toHaveBeenCalledTimes(1);
  });
});
