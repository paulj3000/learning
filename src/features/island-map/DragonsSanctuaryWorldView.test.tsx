import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DragonsSanctuaryWorldView } from './DragonsSanctuaryWorldView';
import { listAllWorldChanges } from '../adventures/api';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/DragonsSanctuaryScene', () => ({
  DragonsSanctuaryScene: class {},
  WORLD_WIDTH: 960,
  WORLD_HEIGHT: 640,
}));

vi.mock('./PhaserGameContainer', () => ({
  PhaserGameContainer: () => <div data-testid="phaser-game-container" />,
}));

/**
 * Phase 26.5. Tapping a character now hands off to `NpcConversation`, which
 * loads the Quest Engine's whole context; this file is about the world view
 * routing the action to it, so the conversation is stubbed here and tested on
 * its own in `NpcConversation.test.tsx`.
 */
vi.mock('./NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
}));

vi.mock('../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));

vi.mock('../adventures/content', () => ({
  getAdventureTemplate: vi.fn(),
}));

// Phase 26: every world view now joins world changes with the backpack and
// the child's own discoveries (`useExplorableWorld`), so both reads have to
// resolve or the whole context falls back to empty.
vi.mock('../rewards/api', () => ({
  getInventory: vi.fn(),
}));

vi.mock('../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));

import { getInventory } from '../rewards/api';
import {
  getDiscoveryDefinition,
  recordCharacterMet,
  recordDiscovery,
  getWorldState,
} from '../discovery/api';

const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const getInventoryMock = vi.mocked(getInventory);
const getWorldStateMock = vi.mocked(getWorldState);
const getDiscoveryDefinitionMock = vi.mocked(getDiscoveryDefinition);
const recordDiscoveryMock = vi.mocked(recordDiscovery);
const recordCharacterMetMock = vi.mocked(recordCharacterMet);

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/dragons-sanctuary']}>
      <Routes>
        <Route
          path="/island/:childId/world/dragons-sanctuary"
          element={<DragonsSanctuaryWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route path="/island/:childId" element={<p>Map route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DragonsSanctuaryWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
    getInventoryMock.mockReset();
    getWorldStateMock.mockReset();
    getDiscoveryDefinitionMock.mockReset();
    recordDiscoveryMock.mockReset();
    recordCharacterMetMock.mockReset();
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    recordCharacterMetMock.mockResolvedValue(undefined);
  });

  it('shows a loading state before world changes resolve', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading the dragon's sanctuary/i)).toBeInTheDocument();
  });

  it('shows a calm not-discovered-yet message when the story has not been completed', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText(/has not been discovered yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('phaser-game-container')).not.toBeInTheDocument();
  });

  it('lets a not-yet-unlocked child navigate back to the map', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText(/back to the map/i));

    expect(await screen.findByText('Map route')).toBeInTheDocument();
  });

  it('renders the scene and every always-available interaction once the story is complete', async () => {
    listAllWorldChangesMock.mockResolvedValue([
      { changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' } as never,
    ]);

    renderWorldView();

    expect(await screen.findByTestId('phaser-game-container')).toBeInTheDocument();
    expect(screen.getByText('The dragon')).toBeInTheDocument();
    expect(screen.getByText("The dragon's egg")).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
  });

  it('opens a conversation with the dragon instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([
      { changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE' } as never,
    ]);

    renderWorldView();
    await user.click(await screen.findByText('The dragon'));

    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('ember-dragon');
  });
});
