import { existsSync, readFileSync } from 'node:fs';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { WorldInteractionContext } from '../../../worldObjects';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';
import { createLocationEngine } from '../createLocationEngine';

/**
 * SC-R10-02 parity: every behaviour `CastleWritingRoomWorldView.test.tsx`
 * asserts of the Phaser Writing Room, run against the generic view and the
 * real manifest, plus the contract tests that keep the two renderers on one
 * progress contract (`docs/regions/prep/writing_room_prep.md` sections 3 and 4).
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

import { listAllWorldChanges, recordWorldChangeOnce } from '../../../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

const UNLOCKED = [{ changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }] as never;

function renderRoom(ageBand: AgeBandValue = 'EXPLORER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/castle-writing-room']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="castle-writing-room"
              ageBand={ageBand}
            />
          }
        />
        <Route path="/island/:childId" element={<p>Map route</p>} />
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

async function renderUnlocked() {
  vi.mocked(listAllWorldChanges).mockResolvedValue(UNLOCKED);
  const utils = renderRoom();
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

describe('The Writing Room on the generic view: parity with CastleWritingRoomWorldView', () => {
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
  });

  it('shows a loading state before world changes resolve', async () => {
    vi.mocked(listAllWorldChanges).mockReturnValue(new Promise(() => {}));
    renderRoom();
    expect(await screen.findByText(/loading the writing room/i)).toBeInTheDocument();
    expect(vi.mocked(createLocationEngine)).not.toHaveBeenCalled();
  });

  it('shows a calm not-discovered-yet message and builds no engine when the story is not complete', async () => {
    renderRoom();
    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(vi.mocked(createLocationEngine)).not.toHaveBeenCalled();
    expect(screen.queryByText(/move: wasd/i)).not.toBeInTheDocument();
  });

  it('fails closed: a failed progress read keeps the room closed', async () => {
    vi.mocked(listAllWorldChanges).mockRejectedValue(new Error('offline'));
    renderRoom();
    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(vi.mocked(createLocationEngine)).not.toHaveBeenCalled();
  });

  it('lets a not-yet-unlocked child navigate back to the map', async () => {
    const user = userEvent.setup();
    renderRoom();
    await user.click(await screen.findByText(/back to the map/i));
    expect(await screen.findByText('Map route')).toBeInTheDocument();
  });

  it('builds the engine, with the child world state, once the story is complete', async () => {
    await renderUnlocked();
    expect(vi.mocked(createLocationEngine)).toHaveBeenCalledTimes(1);
    expect(engine.options?.worldState?.worldChangeKeys).toContain('THE_CASTLES_SECRET_DOOR_COMPLETE');
  });

  it('lists every always-available interaction by the same titles as the Phaser room', async () => {
    await renderUnlocked();
    expect(screen.getByRole('button', { name: 'The writing desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shelves of empty books' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The path back into the castle' })).toBeInTheDocument();
  });

  it('shows the desk message, plain, when the desk is tapped in the list', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await user.click(screen.getByRole('button', { name: 'The writing desk' }));
    expect(await screen.findByText(/yours to use/i)).toBeInTheDocument();
  });

  it('shows the desk and bookshelf messages when the child taps them in the room', async () => {
    await renderUnlocked();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'writing-room-desk',
        interactionId: 'writing-room-desk:interact',
      }),
    );
    expect(
      await screen.findByText(
        'You solved it, so it is yours to use. The first empty book is waiting.',
      ),
    ).toBeInTheDocument();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'writing-room-bookshelf',
        interactionId: 'writing-room-bookshelf:interact',
      }),
    );
    expect(
      await screen.findByText('Shelf after shelf of blank books, left ready by the old Storykeepers.'),
    ).toBeInTheDocument();
  });

  it('offers the way back into the castle when the child walks to the door', async () => {
    await renderUnlocked();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'writing-room-castle-exit' }));
    const link = await screen.findByRole('link', { name: 'Go there' });
    expect(link).toHaveAttribute('href', '/island/child-1/world/storykeeper-castle');
  });

  it('always offers the location page as the way out of 3D', async () => {
    await renderUnlocked();
    expect(
      screen.getByRole('link', { name: 'Prefer not to walk in 3D? Use the location page instead' }),
    ).toHaveAttribute('href', '/island/child-1/locations/castle-writing-room');
  });

  it('offers a way to interact without a mouse look', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await user.click(screen.getByRole('button', { name: "Interact with what you're looking at" }));
    expect(engine.interact).toHaveBeenCalledTimes(1);
  });

  it('saves its one checkpoint when the child crosses it', async () => {
    await renderUnlocked();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-writing-room:entry' }));
    await waitFor(() =>
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'castle-writing-room:entry'),
    );
  });

  it('records no world change, however the room is used', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await user.click(screen.getByRole('button', { name: 'The writing desk' }));
    await user.click(screen.getByRole('button', { name: 'Shelves of empty books' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'writing-room-castle-exit' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-writing-room:entry' }));
    expect(recordWorldChangeOnce).not.toHaveBeenCalled();
  });
});

describe('The Writing Room: one progress contract for both renderers', () => {
  const read = (relative: string) =>
    readFileSync(new URL(relative, import.meta.url), 'utf8');

  it('keeps the Phaser room in place, with its view, scene and tests', () => {
    for (const file of [
      '../../../CastleWritingRoomWorldView.tsx',
      '../../../CastleWritingRoomWorldView.test.tsx',
      '../../../scenes/CastleWritingRoomScene.ts',
    ]) {
      expect(existsSync(new URL(file, import.meta.url)), file).toBe(true);
    }
  });

  it('has neither view write a world change', () => {
    expect(read('../../../CastleWritingRoomWorldView.tsx')).not.toContain('recordWorldChangeOnce');
    expect(read('../../../scenes/CastleWritingRoomScene.ts')).not.toContain('recordWorldChangeOnce');
    expect(read('./castleWritingRoom.ts')).not.toContain('recordWorldChangeOnce');
    expect(read('../../castleWritingRoomRegion.ts')).not.toContain('recordWorldChangeOnce');
  });

  it('keeps the Phaser view gated on the same key as the manifest', () => {
    expect(read('../../../CastleWritingRoomWorldView.tsx')).toContain(
      "{ changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }",
    );
  });

  it('leaves the Phaser route the default (SC-R10-03 stays gated)', () => {
    const routes = read('../../../../../app/AppRoutes.tsx');
    expect(routes).toMatch(/world\/castle-writing-room"[\s\S]{0,200}CastleWritingRoomWorldPage/);
    expect(routes).not.toMatch(/LegacyLocationWorldRedirect regionId=\{CASTLE_WRITING_ROOM/);
  });
});
