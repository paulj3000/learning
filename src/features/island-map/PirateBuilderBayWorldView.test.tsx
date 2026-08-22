import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PirateBuilderBayWorldView } from './PirateBuilderBayWorldView';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../adventures/content/repairTheMoonlightBridge';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/PirateBuilderBayScene', () => ({
  PirateBuilderBayScene: class {},
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
const resumeOrStartSessionMock = vi.mocked(resumeOrStartSession);
const getAdventureTemplateMock = vi.mocked(getAdventureTemplate);

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/pirate-builder-bay']}>
      <Routes>
        <Route
          path="/island/:childId/world/pirate-builder-bay"
          element={<PirateBuilderBayWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PirateBuilderBayWorldView', () => {
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

    expect(screen.getByText(/loading pirate builder bay/i)).toBeInTheDocument();
  });

  it('lists every always-available interaction as an accessible alternative to walking', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText('The broken Moonlight Bridge')).toBeInTheDocument();
    expect(screen.getByText('Pirate Pip')).toBeInTheDocument();
    expect(screen.getByText('A coil of rope')).toBeInTheDocument();
    expect(screen.getByText("Pirate Pip's toolbox")).toBeInTheDocument();
    expect(screen.getByText('A hidden treasure chest')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);
    getAdventureTemplateMock.mockReturnValue(REPAIR_THE_MOONLIGHT_BRIDGE);
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: REPAIR_THE_MOONLIGHT_BRIDGE.entryStepId,
    } as never);

    renderWorldView();
    await user.click(await screen.findByText('The broken Moonlight Bridge'));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    await waitFor(() => {
      expect(resumeOrStartSessionMock).toHaveBeenCalledWith('child-1', REPAIR_THE_MOONLIGHT_BRIDGE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('offers the repaired-bridge narration instead of the adventure once the bridge is repaired', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);

    renderWorldView();

    expect(await screen.findByText('The repaired Moonlight Bridge')).toBeInTheDocument();
    expect(screen.queryByText('The broken Moonlight Bridge')).not.toBeInTheDocument();
  });

  it('opens a conversation with Pip instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('Pirate Pip'));

    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('pirate-pip');
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('Pirate Pip'));
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
      listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);
      getDiscoveryDefinitionMock.mockReturnValue({
        id: 'bay-tide-tunnel',
        locationSlug: 'x',
        kind: 'HIDDEN_OBJECT',
        title: 'A low tunnel under the cliff',
        revealMessage: 'You found something wonderful.',
        lockedMessage: 'Something is here, but not yet.',
        requirements: [{ type: 'ALWAYS' }],
      });
      recordDiscoveryMock.mockResolvedValue({
        outcome: {
          discoveryId: 'bay-tide-tunnel',
          title: 'A low tunnel under the cliff',
          status: 'FOUND_NOW',
          message: 'You found something wonderful.',
        },
        rewardMessages: ['A shell is yours to keep.'],
        newItemIds: ['moon-shell'],
      });

      renderWorldView();
      await user.click(await screen.findByText('A low tunnel under the cliff'));

      expect(await screen.findByText('You found something wonderful.')).toBeInTheDocument();
      // The authored celebration rides along in the same panel, so finding a
      // thing and getting the thing are one beat rather than two screens.
      expect(screen.getByText('A shell is yours to keep.')).toBeInTheDocument();
      expect(recordDiscoveryMock).toHaveBeenCalledWith(
        'child-1',
        expect.objectContaining({ id: 'bay-tide-tunnel' }),
      );
    });

    it('shows the calm locked line, not an error, for a secret that will not open yet', async () => {
      const user = userEvent.setup();
      listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'BRIDGE_REPAIRED' } as never]);
      getDiscoveryDefinitionMock.mockReturnValue({
        id: 'bay-tide-tunnel',
        locationSlug: 'x',
        kind: 'LOCKED_DOOR',
        title: 'A low tunnel under the cliff',
        revealMessage: 'It opens.',
        lockedMessage: 'It is locked, and the keyhole is an odd shape.',
        requirements: [{ type: 'ITEM_OWNED', itemId: 'driftwood-key' }],
      });
      recordDiscoveryMock.mockResolvedValue({
        outcome: {
          discoveryId: 'bay-tide-tunnel',
          title: 'A low tunnel under the cliff',
          status: 'LOCKED',
          message: 'It is locked, and the keyhole is an odd shape.',
        },
        rewardMessages: [],
        newItemIds: [],
      });

      renderWorldView();
      await user.click(await screen.findByText('A low tunnel under the cliff'));

      expect(
        await screen.findByText('It is locked, and the keyhole is an odd shape.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
