import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IslandLayout, LEAVE_ISLAND_LABEL } from './IslandLayout';

vi.mock('../session/useSessionClock', () => ({
  useSessionClock: () => ({ elapsedMinutes: 0, limitMinutes: null, limitReached: false }),
}));

const CHILD_ID = 'child-1';

/** Each child-mode depth that IslandLayout wraps: Island, Place, 3D Area and Adventure. */
const CHILD_SCREENS = [
  `/island/${CHILD_ID}/worlds/home-island`,
  `/island/${CHILD_ID}/locations/pirate-builder-bay`,
  `/island/${CHILD_ID}/locations/pirate-builder-bay/world`,
  `/island/${CHILD_ID}/locations/pirate-builder-bay/adventures/bridge-repair`,
];

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`/island/${CHILD_ID}/travel`} element={<p>Sailing dock</p>} />
        <Route path="/home" element={<p>Parent space</p>} />
        <Route
          path="*"
          element={
            <IslandLayout childId={CHILD_ID}>
              <p>Somewhere on the island</p>
            </IslandLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('IslandLayout exits', () => {
  it.each(CHILD_SCREENS)('leaves the island from %s without any question', async (path) => {
    renderAt(path);

    await userEvent.click(screen.getByRole('link', { name: LEAVE_ISLAND_LABEL }));

    expect(screen.getByText('Sailing dock')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('does not offer Leave island on the sailing dock itself', () => {
    render(
      <MemoryRouter initialEntries={[`/island/${CHILD_ID}/travel`]}>
        <IslandLayout childId={CHILD_ID}>
          <p>Sailing dock</p>
        </IslandLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: LEAVE_ISLAND_LABEL })).not.toBeInTheDocument();
  });

  it('keeps the parent gate on the separate adult exit to the parent space', async () => {
    renderAt(CHILD_SCREENS[0]);

    await userEvent.click(screen.getByRole('button', { name: /exit to parent space/i }));

    expect(screen.getByRole('dialog', { name: 'Return to parent space?' })).toBeInTheDocument();
    expect(screen.queryByText('Parent space')).not.toBeInTheDocument();
  });
});
