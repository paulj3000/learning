import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NpcInteractionPrompt } from './NpcInteractionPrompt';
import { talkToLabel } from './npcUiCopy';

describe('NpcInteractionPrompt', () => {
  it('is a real button named "Talk to <name>"', () => {
    render(<NpcInteractionPrompt label={talkToLabel('Pip')} onInteract={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Talk to Pip' })).toBeInTheDocument();
  });

  it('reports pointer, touch and keyboard activation', async () => {
    const user = userEvent.setup();
    const onInteract = vi.fn();
    render(<NpcInteractionPrompt label="Talk to Pip" onInteract={onInteract} />);
    const button = screen.getByRole('button', { name: 'Talk to Pip' });

    await user.click(button);
    expect(onInteract).toHaveBeenLastCalledWith('pointer');

    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.click(button, { detail: 1 });
    expect(onInteract).toHaveBeenLastCalledWith('touch');

    button.focus();
    await user.keyboard('{Enter}');
    expect(onInteract).toHaveBeenLastCalledWith('keyboard');
    await user.keyboard(' ');
    expect(onInteract).toHaveBeenLastCalledWith('keyboard');
    expect(onInteract).toHaveBeenCalledTimes(4);
  });

  it('has no hotkey unless asked', () => {
    const onInteract = vi.fn();
    render(<NpcInteractionPrompt label="Talk to Pip" onInteract={onInteract} />);
    fireEvent.keyDown(window, { key: 'e' });
    expect(onInteract).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('an optional hotkey interacts, but not while typing or with modifiers', () => {
    const onInteract = vi.fn();
    const { unmount } = render(
      <>
        <input aria-label="name" />
        <NpcInteractionPrompt label="Talk to Pip" onInteract={onInteract} hotkey="e" />
      </>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'E');
    fireEvent.keyDown(window, { key: 'E' });
    expect(onInteract).toHaveBeenCalledWith('keyboard');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'e' });
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'e', repeat: true });
    expect(onInteract).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: 'e' });
    expect(onInteract).toHaveBeenCalledTimes(1);
  });
});
