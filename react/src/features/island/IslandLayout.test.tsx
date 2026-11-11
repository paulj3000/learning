import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IslandLayout, LEAVE_ISLAND_LABEL } from './IslandLayout';
import { useExitParticipant } from '../portal/exit';

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
        <Route path={`/island/${CHILD_ID}/realms`} element={<p>Realm Explorer page</p>} />
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
    'leaves from %s straight to the Realm Explorer without any question',
    async (path) => {
      renderAt(path);

      await userEvent.click(screen.getByRole('button', { name: LEAVE_ISLAND_LABEL }));

      expect(await screen.findByText('Realm Explorer page')).toBeInTheDocument();
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
    expect(await screen.findByText('Realm Explorer page')).toBeInTheDocument();
  });

  it.each([
    `/island/${CHILD_ID}`,
    `/island/${CHILD_ID}/realms`,
    `/island/${CHILD_ID}/realms/creature-care-cove`,
  ])('does not offer Leave island on %s (Home and the Realm pages)', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <IslandLayout childId={CHILD_ID}>
          <p>Hub page</p>
        </IslandLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: LEAVE_ISLAND_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit to parent space/i })).toBeInTheDocument();
  });

  it.each(CHILD_SCREENS)(
    'the adult exit from %s opens the parent space without any question',
    async (path) => {
      renderAt(path);

      await userEvent.click(screen.getByRole('button', { name: /exit to parent space/i }));

      expect(await screen.findByText('Parent space')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expectNoChallenge();
    },
  );

  it('the adult exit from Home opens the parent space without any question', async () => {
    render(
      <MemoryRouter initialEntries={[`/island/${CHILD_ID}`]}>
        <Routes>
          <Route path="/home" element={<p>Parent space</p>} />
          <Route
            path="/island/:childId"
            element={<IslandLayout childId={CHILD_ID}>{<p>Island Explorer page</p>}</IslandLayout>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: /exit to parent space/i }));

    expect(await screen.findByText('Parent space')).toBeInTheDocument();
    expectNoChallenge();
  });

  it('the adult exit during an encounter confirms with plain buttons, then opens the parent space', async () => {
    renderAt(CHILD_SCREENS[3], <OpenEncounter />);

    await userEvent.click(screen.getByRole('button', { name: /exit to parent space/i }));
    const confirm = screen.getByRole('dialog', { name: 'Leave the island now?' });
    expectNoChallenge();

    await userEvent.click(within(confirm).getByRole('button', { name: LEAVE_ISLAND_LABEL }));

    expect(await screen.findByText('Parent space')).toBeInTheDocument();
  });

  it('renders inside the child shell navigation', () => {
    renderAt(CHILD_SCREENS[1]);

    expect(screen.getByRole('navigation', { name: 'Island' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Realms' })).toHaveAttribute(
      'href',
      `/island/${CHILD_ID}/realms`,
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });
});

describe('IslandLayout has no play-time limit', () => {
  it.each(CHILD_SCREENS)(
    'never shows a stop note, countdown or lockout on %s after hours of play',
    async (path) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        // A session start from a previous, now-retired clock must not matter either.
        window.sessionStorage.setItem(`lai:session-start:${CHILD_ID}`, '1');
        renderAt(path, <button type="button">Keep playing</button>);
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);

        expect(screen.queryByRole('complementary', { name: /place to stop/i })).toBeNull();
        expect(screen.queryByText(/good place to stop|time (is )?up|minutes left/i)).toBeNull();
        expect(screen.getByRole('button', { name: 'Keep playing' })).toBeEnabled();
        expect(screen.getByRole('button', { name: LEAVE_ISLAND_LABEL })).toBeEnabled();
      } finally {
        window.sessionStorage.clear();
        vi.useRealTimers();
      }
    },
  );
});
