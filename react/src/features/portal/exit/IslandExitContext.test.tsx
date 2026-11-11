import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { IslandExitProvider, useExitParticipant } from './IslandExitContext';
import { LeaveIslandButton } from './LeaveIslandButton';
import { isLeftIslandState } from './adventureRoutes';

const CHILD = 'child-1';

function Explorer() {
  const state = useLocation().state;
  return <p>{isLeftIslandState(state) ? 'Explorer after leaving' : 'Explorer'}</p>;
}

function Participant({ save, needsConfirm }: { save(): Promise<void>; needsConfirm?(): boolean }) {
  useExitParticipant({ save, needsConfirm });
  return null;
}

function renderIsland(island: ReactNode, saveTimeoutMs?: number) {
  return render(
    <MemoryRouter initialEntries={[`/island/${CHILD}/explore/wonderwild-forest`]}>
      <Routes>
        <Route path="/island/:childId/realms" element={<Explorer />} />
        <Route
          path="*"
          element={
            <IslandExitProvider childId={CHILD} saveTimeoutMs={saveTimeoutMs}>
              <LeaveIslandButton />
              {island}
            </IslandExitProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function expectNoChallenge() {
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
}

describe('IslandExitProvider', () => {
  it('goes straight to the Island Explorer when nothing is mid-way', async () => {
    renderIsland(null);
    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    expect(await screen.findByText('Explorer after leaving')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('saves what is in flight before navigating', async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderIsland(<Participant save={save} />);

    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving your adventure...' })).toBeDisabled();
    expect(screen.queryByText(/Explorer/)).not.toBeInTheDocument();
    await act(async () => finish());
    expect(await screen.findByText('Explorer after leaving')).toBeInTheDocument();
  });

  it('still leaves when a save fails', async () => {
    renderIsland(<Participant save={() => Promise.reject(new Error('offline'))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    expect(await screen.findByText('Explorer after leaving')).toBeInTheDocument();
  });

  it('still leaves when a save never finishes (no stuck state)', async () => {
    renderIsland(<Participant save={() => new Promise<void>(() => undefined)} />, 20);
    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    expect(await screen.findByText('Explorer after leaving')).toBeInTheDocument();
  });

  it('during an encounter, confirms with two plain buttons and no challenge', async () => {
    const save = vi.fn(async () => undefined);
    renderIsland(<Participant save={save} needsConfirm={() => true} />);

    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));

    const dialog = screen.getByRole('dialog', { name: 'Leave the island now?' });
    expect(dialog).toBeInTheDocument();
    expectNoChallenge();
    expect(screen.getByRole('button', { name: 'Keep playing' })).toHaveFocus();
    expect(save).not.toHaveBeenCalled();

    const leaveButtons = screen.getAllByRole('button', { name: 'Leave island' });
    await userEvent.click(leaveButtons[leaveButtons.length - 1]);
    expect(await screen.findByText('Explorer after leaving')).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('"Keep playing" and Escape both stay on the island', async () => {
    renderIsland(<Participant save={async () => undefined} needsConfirm={() => true} />);

    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Leave island' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Explorer/)).not.toBeInTheDocument();
  });

  it('works by keyboard alone', async () => {
    renderIsland(null);
    screen.getByRole('button', { name: 'Leave island' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByText('Explorer after leaving')).toBeInTheDocument());
  });

  it('renders no Leave island button outside child mode', () => {
    render(
      <MemoryRouter>
        <LeaveIslandButton />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
