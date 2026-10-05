import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TideTrialPanel } from './TideTrialPanel';
import type { TideTrialScene } from './pirateBuilderBayScene';

function fakeScene(levels: number[] = [60, 120, 145]): TideTrialScene {
  return {
    begin: vi.fn(),
    setDeckHeight: vi.fn(),
    runTide: vi.fn((onLevel: (cm: number) => void) => {
      levels.forEach(onLevel);
      return Promise.resolve();
    }),
    rebuild: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
  };
}

async function raise(user: ReturnType<typeof userEvent.setup>, times: number) {
  for (let step = 0; step < times; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Raise the deck' }));
  }
}

describe('TideTrialPanel', () => {
  let scene: TideTrialScene;
  let onWon: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    scene = fakeScene();
    onWon = vi.fn(() => Promise.resolve());
    onClose = vi.fn();
  });

  function renderPanel() {
    return render(<TideTrialPanel scene={scene} onWon={onWon} onClose={onClose} />);
  }

  it("starts the scene and shows Pip's tide board", () => {
    renderPanel();

    expect(scene.begin).toHaveBeenCalledWith(110);
    expect(screen.getByText(/the water is 40 cm deep/i)).toBeInTheDocument();
    expect(screen.getByText(/85 cm higher/i)).toBeInTheDocument();
    expect(screen.getByTestId('deck-height')).toHaveTextContent('110 cm');
  });

  it('moves the deck in the scene as the child changes its height', async () => {
    const user = userEvent.setup();
    renderPanel();

    await raise(user, 2);
    await user.click(screen.getByRole('button', { name: 'Lower the deck' }));

    expect(screen.getByTestId('deck-height')).toHaveTextContent('120 cm');
    expect(scene.setDeckHeight).toHaveBeenLastCalledWith(120);
  });

  it('shows the water rising, then what went wrong, then lets the child rebuild', async () => {
    const user = userEvent.setup();
    renderPanel();

    await raise(user, 2);
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));

    expect(screen.getByTestId('water-level')).toHaveTextContent('145 cm');
    expect(await screen.findByText(/floated away/i)).toBeInTheDocument();
    expect(screen.getByText(/came up 15 cm too high/i)).toBeInTheDocument();
    expect(onWon).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /rebuild and try again/i }));
    expect(scene.rebuild).toHaveBeenCalledWith(130);
    expect(screen.getByRole('button', { name: 'Raise the deck' })).toBeInTheDocument();
  });

  it('explains a deck too steep for the cart without counting it as a win', async () => {
    const user = userEvent.setup();
    renderPanel();

    await raise(user, 8);
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));

    expect(await screen.findByText(/20 cm too high for it/i)).toBeInTheDocument();
    expect(scene.complete).not.toHaveBeenCalled();
    expect(onWon).not.toHaveBeenCalled();
  });

  it('completes the bridge and reports the win once, on a dry deck', async () => {
    const user = userEvent.setup();
    renderPanel();

    await raise(user, 5);
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));

    expect(await screen.findByText(/before the tide even came/i)).toBeInTheDocument();
    expect(scene.complete).toHaveBeenCalledTimes(1);
    expect(onWon).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Walk across the bridge' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the win on screen but says so calmly when it cannot be saved', async () => {
    const user = userEvent.setup();
    onWon.mockRejectedValue(new Error('offline'));
    renderPanel();

    await raise(user, 5);
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not remember it/i);
    expect(screen.getByRole('button', { name: 'Walk across the bridge' })).toBeInTheDocument();
  });

  it('reveals hints one at a time', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /hint/i }));
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent(/tide board/i);
    await user.click(screen.getByRole('button', { name: /hint/i }));
    expect(screen.getByText(/40 cm and 85 cm/)).toBeInTheDocument();
  });

  it('puts the broken bridge back when the child leaves without winning', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel();

    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(onClose).toHaveBeenCalled();
    unmount();

    expect(scene.cancel).toHaveBeenCalledTimes(1);
  });

  it('leaves the repaired bridge standing when the panel closes after a win', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel();

    await raise(user, 4);
    await user.click(screen.getByRole('button', { name: /bring in the tide/i }));
    await screen.findByRole('button', { name: 'Walk across the bridge' });
    unmount();

    expect(scene.cancel).not.toHaveBeenCalled();
  });
});
