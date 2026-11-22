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

/** A child who finished the Secret Door arc: they keep everything it gave them. */
const HOLDER = [{ changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }] as never;

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

async function renderUnlocked(ageBand: AgeBandValue = 'EXPLORER', changes: never[] = []) {
  vi.mocked(listAllWorldChanges).mockResolvedValue(changes);
  const utils = renderRoom(ageBand);
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

  it('is open to a child with no progress at all: no locked message, and the engine is built', async () => {
    renderRoom();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not been discovered yet/i)).not.toBeInTheDocument();
    expect(vi.mocked(createLocationEngine)).toHaveBeenCalledTimes(1);
  });

  it.each(['SPROUT', 'PATHFINDER', 'EXPLORER'] as const)(
    'lets a %s in, with no arithmetic and no earlier story required',
    async (band) => {
      await renderUnlocked(band);
      expect(vi.mocked(createLocationEngine)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createLocationEngine).mock.calls[0]?.[2]).toMatchObject({
        regionId: 'castle-writing-room',
      });
    },
  );

  it('does not fail closed on a failed progress read: the room has no requirement to fail', async () => {
    vi.mocked(listAllWorldChanges).mockRejectedValue(new Error('offline'));
    renderRoom();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  it('gives a child who finished the Secret Door arc the same room, builds the engine with their state', async () => {
    await renderUnlocked('EXPLORER', HOLDER);
    expect(vi.mocked(createLocationEngine)).toHaveBeenCalledTimes(1);
    expect(engine.options?.worldState?.worldChangeKeys).toContain(
      'THE_CASTLES_SECRET_DOOR_COMPLETE',
    );
  });

  it('lists every always-available interaction by the same titles as the Phaser room', async () => {
    await renderUnlocked();
    expect(screen.getByRole('button', { name: 'The writing desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shelves of empty books' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'The path back into the castle' }),
    ).toBeInTheDocument();
  });

  it('also lists the open book and Keeper Quill, which the Phaser room does not have', async () => {
    await renderUnlocked();
    expect(
      screen.getByRole('button', { name: 'Write a story in the open book' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keeper Quill' })).toBeInTheDocument();
  });

  it('opens the write-your-story page from the open book, for every band, and never requires it', async () => {
    const user = userEvent.setup();
    await renderUnlocked('SPROUT');
    await user.click(screen.getByRole('button', { name: 'Write a story in the open book' }));
    const link = await screen.findByRole('link', { name: 'Go there' });
    expect(link).toHaveAttribute('href', '/island/child-1/locations/castle-writing-room/write');
    // Leaving is one click, and nothing was recorded.
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(recordWorldChangeOnce).not.toHaveBeenCalled();
  });

  it('opens the existing NPC conversation when the child talks to Keeper Quill', async () => {
    const user = userEvent.setup();
    await renderUnlocked();
    await user.click(screen.getByRole('button', { name: 'Keeper Quill' }));
    expect(await screen.findByText('conversation with keeper-quill')).toBeInTheDocument();
  });

  it('marks Quill met when the child walks up to him, through the same write the castle uses', async () => {
    await renderUnlocked();
    await emit((bus) => bus.emit('NpcApproached', { entityId: 'keeper-quill' } as never));
    await waitFor(() => expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'keeper-quill'));
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
      await screen.findByText('This desk is yours to use. The first empty book is waiting.'),
    ).toBeInTheDocument();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'writing-room-bookshelf',
        interactionId: 'writing-room-bookshelf:interact',
      }),
    );
    expect(
      await screen.findByText(
        'Shelf after shelf of blank books, left ready by the old Storykeepers.',
      ),
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
    await user.click(screen.getByRole('button', { name: 'Write a story in the open book' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'writing-room-castle-exit' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-writing-room:entry' }));
    expect(recordWorldChangeOnce).not.toHaveBeenCalled();
  });
});

describe('The Writing Room: one progress contract for both renderers', () => {
  const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

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
    expect(read('../../../scenes/CastleWritingRoomScene.ts')).not.toContain(
      'recordWorldChangeOnce',
    );
    expect(read('./castleWritingRoom.ts')).not.toContain('recordWorldChangeOnce');
    expect(read('../../castleWritingRoomRegion.ts')).not.toContain('recordWorldChangeOnce');
  });

  it('has the Phaser view read the location data for its door, so no view can disagree about it', () => {
    const view = read('../../../CastleWritingRoomWorldView.tsx');
    expect(view).toContain("getIslandLocation('castle-writing-room')");
    expect(view).not.toContain('THE_CASTLES_SECRET_DOOR_COMPLETE');
  });

  it('gives the Phaser room nothing new (ADR-020): no book, no Quill, no write path', () => {
    expect(read('../../../scenes/CastleWritingRoomScene.ts')).not.toMatch(/write|quill/i);
    expect(read('../../../CastleWritingRoomWorldView.tsx')).not.toContain(
      'writing-room-write-story',
    );
  });

  it('leaves the Phaser route the default (SC-R10-03 stays gated)', () => {
    const routes = read('../../../../../app/AppRoutes.tsx');
    expect(routes).toMatch(/world\/castle-writing-room"[\s\S]{0,200}CastleWritingRoomWorldPage/);
    expect(routes).not.toMatch(/LegacyLocationWorldRedirect regionId=\{CASTLE_WRITING_ROOM/);
  });
});
