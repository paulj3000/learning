import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CastleWritingRoomWorldView } from './CastleWritingRoomWorldView';
import { listAllWorldChanges } from '../adventures/api';

vi.mock('phaser', () => ({
  default: { AUTO: 0, Scale: { FIT: 0, CENTER_BOTH: 0 } },
}));

vi.mock('./scenes/CastleWritingRoomScene', () => ({
  CastleWritingRoomScene: class {},
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

function renderWorldView() {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/castle-writing-room']}>
      <Routes>
        <Route
          path="/island/:childId/world/castle-writing-room"
          element={<CastleWritingRoomWorldView childId="child-1" avatarKey="FOX" />}
        />
        <Route path="/island/:childId" element={<p>Map route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CastleWritingRoomWorldView', () => {
  beforeEach(() => {
    listAllWorldChangesMock.mockReset();
  });

  it('shows a loading state before world changes resolve', () => {
    listAllWorldChangesMock.mockReturnValue(new Promise(() => {}));

    renderWorldView();

    expect(screen.getByText(/loading the writing room/i)).toBeInTheDocument();
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
      { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' } as never,
    ]);

    renderWorldView();

    expect(await screen.findByTestId('phaser-game-container')).toBeInTheDocument();
    expect(screen.getByText('The writing desk')).toBeInTheDocument();
    expect(screen.getByText('Shelves of empty books')).toBeInTheDocument();
    expect(screen.getByText('The path back into the castle')).toBeInTheDocument();
  });

  it('shows a plain message for tapping the desk instead of trying to start a session', async () => {
    const user = userEvent.setup();
    listAllWorldChangesMock.mockResolvedValue([
      { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' } as never,
    ]);

    renderWorldView();
    await user.click(await screen.findByText('The writing desk'));

    expect(await screen.findByText(/yours to use/i)).toBeInTheDocument();
  });
});
