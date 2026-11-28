import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GameplayMenus, type GameplayMenu } from './GameplayMenus';

/** GE-101: the stage's compact menus (docs/engineering/game-engine/gameplay-ui-contract.md). */

function menus(onStart = vi.fn()): GameplayMenu[] {
  return [
    {
      id: 'explore',
      label: 'Things to do',
      icon: '🧭',
      title: 'Things to do here',
      content: (close) => (
        <button
          type="button"
          onClick={() => {
            close();
            onStart();
          }}
        >
          Say hello
        </button>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      title: 'Settings',
      content: (
        <label>
          <input type="radio" name="view" /> Through my eyes
        </label>
      ),
    },
  ];
}

describe('GameplayMenus', () => {
  it('starts with every panel closed', () => {
    render(<GameplayMenus menus={menus()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const name of ['Things to do', 'Settings'])
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one panel at a time, named by its heading, with focus inside it', async () => {
    const user = userEvent.setup();
    render(<GameplayMenus menus={menus()} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    expect(panel).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Things to do' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Things to do here' })).toBeInTheDocument();
  });

  it('closes with Escape or Close, giving focus back to its button', async () => {
    const user = userEvent.setup();
    render(<GameplayMenus menus={menus()} />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    await user.click(settings);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(settings).toHaveFocus();

    await user.click(settings);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(settings).toHaveFocus();
  });

  it('toggles closed when its button is pressed again', async () => {
    const user = userEvent.setup();
    render(<GameplayMenus menus={menus()} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('works from the keyboard alone', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<GameplayMenus menus={menus(onStart)} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Things to do' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab(); // Close
    await user.tab(); // Say hello
    await user.keyboard(' ');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps key presses from the engine, which listens on window, but lets releases through', async () => {
    const user = userEvent.setup();
    const downs: string[] = [];
    const ups: string[] = [];
    const onDown = (event: KeyboardEvent) => downs.push(event.key);
    const onUp = (event: KeyboardEvent) => ups.push(event.key);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    try {
      render(<GameplayMenus menus={menus()} />);
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.keyboard(' {ArrowDown}');
      expect(downs).toEqual([]);
      expect(ups).toEqual([' ', 'ArrowDown']);
    } finally {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    }
  });

  it('closes when a dialogue or puzzle opens (suspended), so panels never stack', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GameplayMenus menus={menus()} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    rerender(<GameplayMenus menus={menus()} suspended />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps focus on a control inside the panel when the view re-renders', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GameplayMenus menus={menus()} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const radio = screen.getByRole('radio', { name: 'Through my eyes' });
    await user.click(radio);
    rerender(<GameplayMenus menus={menus()} />);
    expect(radio).toHaveFocus();
  });

  it('closes a panel whose menu goes away', async () => {
    const user = userEvent.setup();
    const all = menus();
    const { rerender } = render(<GameplayMenus menus={all} />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    rerender(<GameplayMenus menus={all.filter((menu) => menu.id !== 'settings')} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<GameplayMenus menus={all} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders nothing with no menus', () => {
    const { container } = render(<GameplayMenus menus={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
