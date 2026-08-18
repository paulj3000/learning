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

const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
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
});
