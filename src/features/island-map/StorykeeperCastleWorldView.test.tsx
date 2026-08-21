import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StorykeeperCastleWorldView } from './StorykeeperCastleWorldView';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';
import { THE_STORYKEEPERS_TALE } from '../adventures/content/theStorykeepersTale';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/StorykeeperCastleScene', () => ({
  StorykeeperCastleScene: class {},
  WORLD_WIDTH: 960,
  WORLD_HEIGHT: 640,
}));

vi.mock('./PhaserGameContainer', () => ({
  PhaserGameContainer: () => <div data-testid="phaser-game-container" />,
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
const resumeOrStartSessionMock = vi.mocked(resumeOrStartSession);
const getAdventureTemplateMock = vi.mocked(getAdventureTemplate);

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/storykeeper-castle']}>
      <Routes>
        <Route
          path="/island/:childId/world/storykeeper-castle"
          element={<StorykeeperCastleWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StorykeeperCastleWorldView', () => {
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
    resumeOrStartSessionMock.mockReset();
    getAdventureTemplateMock.mockReset();
  });

  it('shows a loading state before world changes resolve', async () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading storykeeper castle/i)).toBeInTheDocument();
  });

  it('lists every always-available interaction as an accessible alternative to walking', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText("Keeper Quill's story hall")).toBeInTheDocument();
    expect(screen.getByText('Keeper Quill')).toBeInTheDocument();
    expect(screen.getByText('The Character Gallery')).toBeInTheDocument();
    expect(screen.getByText('The Setting Tower')).toBeInTheDocument();
    expect(screen.getByText('The Costume Room')).toBeInTheDocument();
    expect(screen.getByText('The Great Library')).toBeInTheDocument();
    expect(screen.getByText('The Illustration Studio')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
    expect(screen.queryByText('The story hall')).not.toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);
    getAdventureTemplateMock.mockReturnValue(THE_STORYKEEPERS_TALE);
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: THE_STORYKEEPERS_TALE.entryStepId,
    } as never);

    renderWorldView();
    await user.click(await screen.findByText("Keeper Quill's story hall"));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    await waitFor(() => {
      expect(resumeOrStartSessionMock).toHaveBeenCalledWith('child-1', THE_STORYKEEPERS_TALE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('offers the already-told narration instead of the adventure once the first story is told', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'FIRST_STORY_TOLD' } as never]);

    renderWorldView();

    expect(await screen.findByText('The story hall')).toBeInTheDocument();
    expect(screen.queryByText("Keeper Quill's story hall")).not.toBeInTheDocument();
    expect(screen.getByText('Keeper Quill')).toBeInTheDocument();
  });

  it('shows a plain message for a SHOW_MESSAGE interaction instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('The Great Library'));

    expect(await screen.findByText(/shelves and shelves of stories/i)).toBeInTheDocument();
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('The Great Library'));
    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * Phase 26 (docs/ROADMAP.md Phase 26). A `DISCOVER` action is the one kind
   * that writes: it records the find on open, rather than behind a button,
   * because the child already did the thing that finds a secret.
   */
  describe('secrets', () => {
    it('records the find and shows the reveal line when the child opens one', async () => {
      const user = userEvent.setup();
      listAllWorldChangesMock.mockResolvedValue([]);
      getDiscoveryDefinitionMock.mockReturnValue({
        id: 'castle-tapestry-stair',
        locationSlug: 'x',
        kind: 'HIDDEN_OBJECT',
        title: 'A tapestry that moves',
        revealMessage: 'You found something wonderful.',
        lockedMessage: 'Something is here, but not yet.',
        requirements: [{ type: 'ALWAYS' }],
      });
      recordDiscoveryMock.mockResolvedValue({
        outcome: {
          discoveryId: 'castle-tapestry-stair',
          title: 'A tapestry that moves',
          status: 'FOUND_NOW',
          message: 'You found something wonderful.',
        },
        rewardMessages: ['A shell is yours to keep.'],
        newItemIds: ['moon-shell'],
      });

      renderWorldView();
      await user.click(await screen.findByText('A tapestry that moves'));

      expect(await screen.findByText('You found something wonderful.')).toBeInTheDocument();
      // The authored celebration rides along in the same panel, so finding a
      // thing and getting the thing are one beat rather than two screens.
      expect(screen.getByText('A shell is yours to keep.')).toBeInTheDocument();
      expect(recordDiscoveryMock).toHaveBeenCalledWith(
        'child-1',
        expect.objectContaining({ id: 'castle-tapestry-stair' }),
      );
    });

    it('shows the calm locked line, not an error, for a secret that will not open yet', async () => {
      const user = userEvent.setup();
      listAllWorldChangesMock.mockResolvedValue([]);
      getDiscoveryDefinitionMock.mockReturnValue({
        id: 'castle-tapestry-stair',
        locationSlug: 'x',
        kind: 'LOCKED_DOOR',
        title: 'A tapestry that moves',
        revealMessage: 'It opens.',
        lockedMessage: 'It is locked, and the keyhole is an odd shape.',
        requirements: [{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }],
      });
      recordDiscoveryMock.mockResolvedValue({
        outcome: {
          discoveryId: 'castle-tapestry-stair',
          title: 'A tapestry that moves',
          status: 'LOCKED',
          message: 'It is locked, and the keyhole is an odd shape.',
        },
        rewardMessages: [],
        newItemIds: [],
      });

      renderWorldView();
      await user.click(await screen.findByText('A tapestry that moves'));

      expect(
        await screen.findByText('It is locked, and the keyhole is an odd shape.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
