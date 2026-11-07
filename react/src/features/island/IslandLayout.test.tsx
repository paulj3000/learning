import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IslandLayout, LEAVE_ISLAND_LABEL } from './IslandLayout';
import { useExitParticipant } from '../portal/exit';

vi.mock('../session/useSessionClock', () => ({
  useSessionClock: () => ({ elapsedMinutes: 0, limitMinutes: null, limitReached: false }),
}));

const CHILD_ID = 'child-1';

/** Each child-mode depth that IslandLayout wraps: Island, Place, 3D Area and Adventure. */
const CHILD_SCREENS = [
  `/island/${CHILD_ID}/travel`,
  `/island/${CHILD_ID}/worlds/home-island`,
  `/island/${CHILD_ID}/locations/pirate-builder-bay`,
  `/island/${CHILD_ID}/explore/wonderwild-forest`,
  `/island/${CHILD_ID}/locations/pirate-builder-bay/adventures/bridge-repair`,
];

function OpenEncounter() {
  useExitParticipant({ save: async () => undefined, needsConfirm: () => true });
  return <p>An encounter is open</p>;
}

function renderAt(path: string, content = <p>Somewhere on the island</p>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`/island/${CHILD_ID}`} element={<p>Island Explorer page</p>} />
        <Route path="/home" element={<p>Parent space</p>} />
        <Route path="*" element={<IslandLayout childId={CHILD_ID}>{content}</IslandLayout>} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoChallenge() {
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/quick check/i)).not.toBeInTheDocument();
}

describe('IslandLayout exits', () => {
  it.each(CHILD_SCREENS)(
    'leaves from %s straight to the Island Explorer without any question',
    async (path) => {
      renderAt(path);

      await userEvent.click(screen.getByRole('button', { name: LEAVE_ISLAND_LABEL }));

      expect(await screen.findByText('Island Explorer page')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoChallenge();
    },
  );

  it('during an encounter, confirms with plain buttons only, then leaves', async () => {
    renderAt(`/island/${CHILD_ID}/explore/wonderwild-forest`, <OpenEncounter />);

    await userEvent.click(screen.getByRole('button', { name: LEAVE_ISLAND_LABEL }));

    expect(screen.getByRole('dialog', { name: 'Leave the island now?' })).toBeInTheDocument();
    expectNoChallenge();
    const leaveButtons = screen.getAllByRole('button', { name: LEAVE_ISLAND_LABEL });
    await userEvent.click(leaveButtons[leaveButtons.length - 1]);
    expect(await screen.findByText('Island Explorer page')).toBeInTheDocument();
  });

  it('does not offer Leave island on the Island Explorer itself', () => {
    render(
      <MemoryRouter initialEntries={[`/island/${CHILD_ID}`]}>
        <IslandLayout childId={CHILD_ID}>
          <p>Island Explorer page</p>
        </IslandLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: LEAVE_ISLAND_LABEL })).not.toBeInTheDocument();
  });

  it('keeps the parent gate on the separate adult exit to the parent space', async () => {
    renderAt(CHILD_SCREENS[1]);

    await userEvent.click(screen.getByRole('button', { name: /exit to parent space/i }));

    expect(screen.getByRole('dialog', { name: 'Return to parent space?' })).toBeInTheDocument();
    expect(screen.queryByText('Parent space')).not.toBeInTheDocument();
  });

  it('renders inside the child shell navigation', () => {
    renderAt(CHILD_SCREENS[1]);

    expect(screen.getByRole('navigation', { name: 'Island' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Adventure log' })).toHaveAttribute(
      'href',
      `/island/${CHILD_ID}/log`,
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});
