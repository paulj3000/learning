import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldHud } from './WorldHud';

const baseProps = {
  questCue: null,
  companionName: null,
  focusedLabel: null,
  toastMessage: null,
  backpackItems: [],
};

describe('WorldHud', () => {
  it('shows the quest cue when one is given', () => {
    render(<WorldHud {...baseProps} questCue="Help Pip fix the bridge" />);
    expect(screen.getByText('Help Pip fix the bridge')).toBeInTheDocument();
  });

  it('shows nothing for the quest cue when there is no active quest', () => {
    render(<WorldHud {...baseProps} />);
    expect(screen.queryByText(/help pip/i)).not.toBeInTheDocument();
  });

  it("shows the companion's name when a companion is chosen", () => {
    render(<WorldHud {...baseProps} companionName="Chatty" />);
    expect(screen.getByText('Chatty')).toBeInTheDocument();
  });

  it('shows a focus label and prompt only when something is focused', () => {
    const { rerender } = render(<WorldHud {...baseProps} />);
    expect(screen.queryByText(/press e to talk/i)).not.toBeInTheDocument();

    rerender(<WorldHud {...baseProps} focusedLabel="Pip" />);
    expect(screen.getByText(/pip: press e to talk/i)).toBeInTheDocument();
  });

  it('shows a toast message when given one', () => {
    render(<WorldHud {...baseProps} toastMessage="You're inside the lookout tower." />);
    expect(screen.getByText("You're inside the lookout tower.")).toBeInTheDocument();
  });

  it('shows the backpack item count and toggles the panel open and closed', async () => {
    const user = userEvent.setup();
    render(
      <WorldHud {...baseProps} backpackItems={[{ id: 'moon-shell', displayName: 'Moon Shell' }]} />,
    );

    const button = screen.getByRole('button', { name: /backpack \(1\)/i });
    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();

    await user.click(button);
    expect(screen.getByRole('dialog', { name: /backpack/i })).toBeInTheDocument();
    expect(screen.getByText('Moon Shell')).toBeInTheDocument();

    await user.click(button);
    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();
  });

  it('says the backpack is empty when there are no items', async () => {
    const user = userEvent.setup();
    render(<WorldHud {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /backpack \(0\)/i }));

    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});

describe('WorldHud action prompt (TR-12)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const pointer = (fine: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(pointer: fine)' && fine })),
    );

  it('turns the focus label into one button that names the action and interacts', async () => {
    const onInteract = vi.fn();
    render(
      <WorldHud
        {...baseProps}
        focusedLabel="Treasure chest"
        focusAction="Open"
        onInteract={onInteract}
      />,
    );
    const button = screen.getByRole('button', { name: 'Open: Treasure chest' });
    expect(screen.queryByText(/press E to talk/)).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onInteract).toHaveBeenCalledTimes(1);
  });

  it('shows the E key with a mouse, and no key on a touch screen', () => {
    pointer(true);
    const { unmount } = render(
      <WorldHud {...baseProps} focusedLabel="Pip" focusAction="Talk" onInteract={vi.fn()} />,
    );
    expect(screen.getByText('E')).toBeInTheDocument();
    unmount();
    pointer(false);
    render(<WorldHud {...baseProps} focusedLabel="Pip" focusAction="Talk" onInteract={vi.fn()} />);
    expect(screen.queryByText('E')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk: Pip' })).toBeInTheDocument();
  });

  it('shows no prompt when nothing has focus', () => {
    render(<WorldHud {...baseProps} focusAction={null} onInteract={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /:/ })).not.toBeInTheDocument();
  });

  it('keeps the old label without onInteract', () => {
    render(<WorldHud {...baseProps} focusedLabel="Pip" focusAction="Talk" />);
    expect(screen.getByText('Pip: press E to talk')).toBeInTheDocument();
  });
});

describe('WorldHud exit and backpack (TR-13)', () => {
  it('draws the exit on the stage when given one, so it is there in full screen', () => {
    render(
      <MemoryRouter>
        <WorldHud {...baseProps} exitLink={{ label: 'Go back to the harbor', to: '/island/c' }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Go back to the harbor' })).toHaveAttribute(
      'href',
      '/island/c',
    );
  });

  it('leaves the backpack out when a companion shows its own', () => {
    render(<WorldHud {...baseProps} showBackpack={false} />);
    expect(screen.queryByRole('button', { name: /Backpack/ })).not.toBeInTheDocument();
  });

  it('shows its backpack by default, as every other region expects', () => {
    render(<WorldHud {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Backpack (0)' })).toBeInTheDocument();
  });
});

describe('WorldHud Jump button (LAI-JMP-01)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const touchScreen = (coarse: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(any-pointer: coarse)' && coarse })),
    );

  it('shows a large Jump button on a touch screen where jumping is available', () => {
    touchScreen(true);
    render(<WorldHud {...baseProps} onJump={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Jump' })).toBeInTheDocument();
  });

  it('is absent where jumping is not available', () => {
    touchScreen(true);
    render(<WorldHud {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Jump' })).not.toBeInTheDocument();
  });

  it('is absent with no touch screen (Space and the gamepad jump there)', () => {
    touchScreen(false);
    render(<WorldHud {...baseProps} onJump={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Jump' })).not.toBeInTheDocument();
  });

  it('jumps the moment a finger lands, once per tap', () => {
    touchScreen(true);
    const onJump = vi.fn();
    render(<WorldHud {...baseProps} onJump={onJump} />);
    const button = screen.getByRole('button', { name: 'Jump' });
    fireEvent.pointerDown(button);
    expect(onJump).toHaveBeenCalledTimes(1);
    // The click a tap also produces does not jump a second time.
    fireEvent.click(button, { detail: 1 });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('can be pressed from a keyboard or switch (a click with no pointer)', () => {
    touchScreen(true);
    const onJump = vi.fn();
    render(<WorldHud {...baseProps} onJump={onJump} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }), { detail: 0 });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('sits apart from the Backpack button', () => {
    touchScreen(true);
    render(<WorldHud {...baseProps} onJump={vi.fn()} />);
    const jump = screen.getByRole('button', { name: 'Jump' });
    const backpack = screen.getByRole('button', { name: /Backpack/ });
    expect(jump.parentElement).not.toBe(backpack.parentElement);
  });
});

describe('WorldHud camera button (LAI-JMP-01a)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const device = (coarse: boolean) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: coarse ? query === '(any-pointer: coarse)' : query === '(pointer: fine)',
      })),
    );

  it('names the view in force and switches it', async () => {
    device(false);
    const onToggleCamera = vi.fn();
    const { rerender } = render(
      <WorldHud {...baseProps} cameraMode="third-person" onToggleCamera={onToggleCamera} />,
    );
    const button = screen.getByRole('button', { name: 'View: Behind me. Change view' });
    await userEvent.click(button);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    rerender(<WorldHud {...baseProps} cameraMode="first-person" onToggleCamera={onToggleCamera} />);
    expect(screen.getByRole('button', { name: 'View: My eyes. Change view' })).toBeInTheDocument();
  });

  it('shows the V key only with a mouse or trackpad', () => {
    device(false);
    render(<WorldHud {...baseProps} cameraMode="third-person" onToggleCamera={vi.fn()} />);
    expect(screen.getByText('V')).toBeInTheDocument();
  });

  it('sits beside the Jump button on a touch screen, as its own control', () => {
    device(true);
    render(
      <WorldHud
        {...baseProps}
        cameraMode="third-person"
        onToggleCamera={vi.fn()}
        onJump={vi.fn()}
      />,
    );
    const camera = screen.getByRole('button', { name: /Change view/ });
    const jump = screen.getByRole('button', { name: 'Jump' });
    expect(camera).not.toBe(jump);
    expect(camera.className).toMatch(/cameraBesideJump/);
    expect(screen.queryByText('V')).not.toBeInTheDocument();
  });

  it('is absent where the location does not allow switching', () => {
    device(true);
    render(<WorldHud {...baseProps} cameraMode="third-person" />);
    expect(screen.queryByRole('button', { name: /Change view/ })).not.toBeInTheDocument();
  });
});
