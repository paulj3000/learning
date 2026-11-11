import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NpcDialoguePanel, type NpcDialoguePanelProps } from './NpcDialoguePanel';
import { NPC_DIALOGUE_COPY } from './npcUiCopy';

const CHOICES = [
  { key: 'yes', label: 'Yes please!' },
  { key: 'later', label: 'Maybe later' },
];

function props(overrides: Partial<NpcDialoguePanelProps> = {}): NpcDialoguePanelProps {
  return {
    speakerName: 'Pirate Pip',
    text: 'Ahoy! Can you help me count the crates?',
    nodeKey: 'greet',
    choices: CHOICES,
    onChoose: vi.fn(),
    onContinue: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('NpcDialoguePanel', () => {
  it('shows the speaker, the line as a live caption, and choices as buttons', () => {
    render(<NpcDialoguePanel {...props({ portraitUrl: 'https://cdn.test/pip.png' })} />);
    const dialog = screen.getByRole('dialog', { name: 'Pirate Pip' });
    expect(dialog).toBeInTheDocument();
    const line = screen.getByText('Ahoy! Can you help me count the crates?');
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
    const group = screen.getByRole('group', { name: NPC_DIALOGUE_COPY.choicesLabel });
    expect(group.querySelectorAll('button')).toHaveLength(2);
    expect(dialog.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });

  it('moves focus to the first choice and reports the chosen key', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<NpcDialoguePanel {...p} />);
    expect(screen.getByRole('button', { name: 'Yes please!' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(p.onChoose).toHaveBeenCalledWith('later');
  });

  it('works with Enter, Space, Tab and the arrow keys', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<NpcDialoguePanel {...p} />);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Maybe later' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Yes please!' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus();
    screen.getByRole('button', { name: 'Yes please!' }).focus();
    await user.keyboard('{Enter}');
    expect(p.onChoose).toHaveBeenLastCalledWith('yes');
    await user.tab();
    await user.keyboard(' ');
    expect(p.onChoose).toHaveBeenLastCalledWith('later');
  });

  it('keeps world control keys from reaching the window', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<NpcDialoguePanel {...props()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes please!' }), { key: 'w' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes please!' }), { key: 'ArrowUp' });
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('shows Continue when a line has no choices', async () => {
    const user = userEvent.setup();
    const p = props({ choices: [] });
    render(<NpcDialoguePanel {...p} />);
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(p.onContinue).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on the Close button', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<NpcDialoguePanel {...p} />);
    await user.keyboard('{Escape}');
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });

  it('returns focus to what had it when the panel closes', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Talk to Pirate Pip
          </button>
          {open ? <NpcDialoguePanel {...props({ onClose: () => setOpen(false) })} /> : null}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Talk to Pirate Pip' });
    await user.click(opener);
    expect(screen.getByRole('button', { name: 'Yes please!' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('moves focus to the new line when the node changes', () => {
    const p = props();
    const { rerender } = render(<NpcDialoguePanel {...p} />);
    screen.getByRole('button', { name: 'Close' }).focus();
    rerender(
      <NpcDialoguePanel
        {...p}
        nodeKey="count"
        text="One, two, three!"
        choices={[{ key: 'done', label: 'Done' }]}
      />,
    );
    expect(screen.getByText('One, two, three!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
  });

  it('disables choices and announces while busy, keeping focus in the panel', () => {
    render(<NpcDialoguePanel {...props({ busy: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent(NPC_DIALOGUE_COPY.busy);
    expect(screen.getByRole('button', { name: 'Yes please!' })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows a calm error with retry instead of the choices', async () => {
    const user = userEvent.setup();
    const p = props({ error: true, onRetry: vi.fn() });
    render(<NpcDialoguePanel {...p} />);
    expect(screen.getByRole('alert')).toHaveTextContent(NPC_DIALOGUE_COPY.error);
    expect(screen.queryByRole('group')).toBeNull();
    const retry = screen.getByRole('button', { name: NPC_DIALOGUE_COPY.retry });
    expect(retry).toHaveFocus();
    await user.click(retry);
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('takes localized copy through props', () => {
    render(
      <NpcDialoguePanel
        {...props({ choices: [], copy: { continue: 'Weiter', close: 'Schliessen' } })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schliessen' })).toBeInTheDocument();
  });
});

describe('default copy', () => {
  it('has no em dashes', () => {
    for (const text of Object.values(NPC_DIALOGUE_COPY)) expect(text).not.toMatch(/—/);
  });
});
