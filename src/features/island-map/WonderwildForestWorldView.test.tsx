import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WonderwildForestWorldView } from './WonderwildForestWorldView';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';
import { BUZZ_AND_THE_WAGGLE_DANCE } from '../adventures/content/buzzAndTheWaggleDance';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/WonderwildForestScene', () => ({
  WonderwildForestScene: class {},
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
    <MemoryRouter initialEntries={['/island/child-1/world/wonderwild-forest']}>
      <Routes>
        <Route
          path="/island/:childId/world/wonderwild-forest"
          element={<WonderwildForestWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WonderwildForestWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
    resumeOrStartSessionMock.mockReset();
    getAdventureTemplateMock.mockReset();
  });

  it('shows a loading state before world changes resolve', async () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading wonderwild forest/i)).toBeInTheDocument();
  });

  it('lists every always-available interaction as an accessible alternative to walking', async () => {
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();

    expect(await screen.findByText('The buzzing bee hive')).toBeInTheDocument();
    expect(screen.getByText('Peek at the hive')).toBeInTheDocument();
    expect(screen.getByText('A quiet pond')).toBeInTheDocument();
    expect(screen.getByText('A pile of leaves')).toBeInTheDocument();
    expect(screen.getByText('A shadowy cave')).toBeInTheDocument();
    expect(screen.getByText('A quiet clearing')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
    expect(screen.queryByText('The hive you already discovered')).not.toBeInTheDocument();
  });

  it('starts the real adventure session and navigates there from the accessible list', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);
    getAdventureTemplateMock.mockReturnValue(BUZZ_AND_THE_WAGGLE_DANCE);
    resumeOrStartSessionMock.mockResolvedValue({
      id: 'session-1',
      currentStepId: BUZZ_AND_THE_WAGGLE_DANCE.entryStepId,
    } as never);

    renderWorldView();
    await user.click(await screen.findByText('The buzzing bee hive'));
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    await waitFor(() => {
      expect(resumeOrStartSessionMock).toHaveBeenCalledWith('child-1', BUZZ_AND_THE_WAGGLE_DANCE);
    });
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('offers the already-discovered narration instead of the adventure once the hive is discovered', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'WAGGLE_DANCE_DISCOVERED' } as never]);

    renderWorldView();

    expect(await screen.findByText('The hive you already discovered')).toBeInTheDocument();
    expect(screen.queryByText('The buzzing bee hive')).not.toBeInTheDocument();
    expect(screen.getByText('Peek at the hive')).toBeInTheDocument();
  });

  it('shows a plain message for a SHOW_MESSAGE interaction instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('A pile of leaves'));

    expect(await screen.findByText(/red, gold, and brown leaves/i)).toBeInTheDocument();
    expect(resumeOrStartSessionMock).not.toHaveBeenCalled();
  });

  it('dismisses the interaction panel without navigating', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([]);

    renderWorldView();
    await user.click(await screen.findByText('A pile of leaves'));
    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
