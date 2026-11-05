import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import css from './NpcInteraction.module.css?raw';
import { NpcDialoguePanel, type NpcDialoguePanelProps } from './NpcDialoguePanel';
import { NpcInteractionPrompt } from './NpcInteractionPrompt';
import { NPC_DIALOGUE_COPY, NPC_PROMPT_COPY, talkToLabel } from './npcUiCopy';

/** Accessibility checks for the NPC interaction UI (LAI-NPC-038). */

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

/** A CSS rule's body, by its exact selector line. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('NPC UI accessibility: captions and screen readers', () => {
  it('is a labelled modal dialog', () => {
    render(<NpcDialoguePanel {...props()} />);
    const dialog = screen.getByRole('dialog', { name: 'Pirate Pip' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('announces each line once, with the speaker, in one atomic polite region', () => {
    const { rerender } = render(<NpcDialoguePanel {...props()} />);
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    const region = regions[0];
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('Pirate Pip: Ahoy! Can you help me count the crates?');
    rerender(<NpcDialoguePanel {...props({ nodeKey: 'n2', text: 'One, two, three!' })} />);
    expect(region).toHaveTextContent('Pirate Pip: One, two, three!');
    expect(region).not.toHaveTextContent('Ahoy');
  });

  it('keeps the busy line in its own status region, never inside the caption region', () => {
    render(<NpcDialoguePanel {...props({ busy: true })} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(NPC_DIALOGUE_COPY.busy);
    expect(status.closest('[aria-live]')).toBeNull();
    expect(document.querySelector('[aria-live]')).not.toHaveTextContent(NPC_DIALOGUE_COPY.busy);
    // The caption stays visible while busy.
    expect(screen.getByText('Ahoy! Can you help me count the crates?')).toBeVisible();
  });

  it('keeps the caption up until the child acts: no timer closes it', () => {
    vi.useFakeTimers();
    try {
      const p = props({ choices: [] });
      render(<NpcDialoguePanel {...p} />);
      vi.advanceTimersByTime(120_000);
      expect(screen.getByText('Ahoy! Can you help me count the crates?')).toBeVisible();
      expect(p.onClose).not.toHaveBeenCalled();
      expect(p.onContinue).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('names choice buttons by their words and gives the group a question', () => {
    render(<NpcDialoguePanel {...props()} />);
    expect(screen.getByRole('group', { name: NPC_DIALOGUE_COPY.choicesLabel })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yes please!' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Maybe later' })).toBeVisible();
  });

  it('omits the hidden speaker prefix when there is no name', () => {
    render(<NpcDialoguePanel {...props({ speakerName: '' })} />);
    expect(document.querySelector('[aria-live]')?.textContent).toBe(
      'Ahoy! Can you help me count the crates?',
    );
  });
});

describe('NPC UI accessibility: keyboard', () => {
  it('traps Tab and Shift+Tab inside the open panel', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <NpcDialoguePanel {...props()} />
      </>,
    );
    const yes = screen.getByRole('button', { name: 'Yes please!' });
    const later = screen.getByRole('button', { name: 'Maybe later' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(yes).toHaveFocus();
    await user.tab();
    expect(later).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(yes).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Outside' })).not.toHaveFocus();
  });

  it('keeps Tab on the panel while every control but Close is busy', async () => {
    const user = userEvent.setup();
    render(<NpcDialoguePanel {...props({ busy: true })} />);
    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('returns focus to returnFocusTo when the opener is gone, and leaves no trap', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" data-testid="canvas">
            Stage
          </button>
          {open ? null : (
            <button type="button" onClick={() => setOpen(true)}>
              Talk to Pirate Pip
            </button>
          )}
          {open ? (
            <NpcDialoguePanel
              {...props({
                onClose: () => setOpen(false),
                returnFocusTo: () => screen.getByTestId('canvas'),
              })}
            />
          ) : null}
        </>
      );
    }
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Talk to Pirate Pip' }));
    expect(screen.getByRole('button', { name: 'Yes please!' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('canvas')).toHaveFocus();
    // No trap afterwards: Tab moves on and control keys reach the window again.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Talk to Pirate Pip' })).toHaveFocus();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Talk to Pirate Pip' }), { key: 'w' });
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).toHaveBeenCalledTimes(1);
  });

  it('does not steal focus back when something else already has it', () => {
    const target = vi.fn(() => null);
    const { rerender } = render(
      <>
        <button type="button">Other panel</button>
        <NpcDialoguePanel {...props({ returnFocusTo: target })} />
      </>,
    );
    screen.getByRole('button', { name: 'Other panel' }).focus();
    rerender(
      <>
        <button type="button">Other panel</button>
      </>,
    );
    expect(target).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Other panel' })).toHaveFocus();
  });

  it('the prompt activates with Enter, Space and its hotkey', async () => {
    const user = userEvent.setup();
    const onInteract = vi.fn();
    render(<NpcInteractionPrompt label="Talk to Pip" hotkey="e" onInteract={onInteract} />);
    const prompt = screen.getByRole('button', { name: 'Talk to Pip' });
    prompt.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onInteract).toHaveBeenNthCalledWith(1, 'keyboard');
    expect(onInteract).toHaveBeenNthCalledWith(2, 'keyboard');
    prompt.blur();
    await user.keyboard('e');
    expect(onInteract).toHaveBeenNthCalledWith(3, 'keyboard');
    expect(prompt).toHaveAttribute('aria-keyshortcuts', 'E');
  });
});

describe('NPC UI accessibility: replay ("Hear it again")', () => {
  it('is hidden when the host offers no replay (no voice, or muted)', () => {
    render(<NpcDialoguePanel {...props()} />);
    expect(screen.queryByRole('button', { name: NPC_DIALOGUE_COPY.replay })).toBeNull();
  });

  it('shows with icon plus text and replays on activation', async () => {
    const user = userEvent.setup();
    const onReplay = vi.fn();
    render(<NpcDialoguePanel {...props({ onReplay })} />);
    const replay = screen.getByRole('button', { name: NPC_DIALOGUE_COPY.replay });
    expect(replay.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await user.click(replay);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('is disabled while busy or while the voice loads, and hidden on errors', () => {
    const { rerender } = render(<NpcDialoguePanel {...props({ onReplay: vi.fn(), busy: true })} />);
    expect(screen.getByRole('button', { name: NPC_DIALOGUE_COPY.replay })).toBeDisabled();
    rerender(<NpcDialoguePanel {...props({ onReplay: vi.fn(), replayDisabled: true })} />);
    expect(screen.getByRole('button', { name: NPC_DIALOGUE_COPY.replay })).toBeDisabled();
    rerender(<NpcDialoguePanel {...props({ onReplay: vi.fn(), error: true })} />);
    expect(screen.queryByRole('button', { name: NPC_DIALOGUE_COPY.replay })).toBeNull();
  });
});

describe('NPC UI accessibility: touch and pre-readers', () => {
  it('the prompt shows a decorative icon plus text; the text is the name', () => {
    render(<NpcInteractionPrompt label={talkToLabel('Pip')} onInteract={vi.fn()} />);
    const prompt = screen.getByRole('button', { name: 'Talk to Pip' });
    const icon = prompt.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
  });

  it('a single tap activates the prompt (no double tap)', async () => {
    const user = userEvent.setup();
    const onInteract = vi.fn();
    render(<NpcInteractionPrompt label="Talk to Pip" onInteract={onInteract} />);
    await user.pointer({
      keys: '[TouchA]',
      target: screen.getByRole('button', { name: 'Talk to Pip' }),
    });
    expect(onInteract).toHaveBeenCalledTimes(1);
    expect(onInteract).toHaveBeenCalledWith('touch');
  });

  it('every control is at least 56 px (3.5rem), above the 48 px minimum', () => {
    expect(css).toMatch(/--npc-target:\s*3\.5rem;/);
    for (const selector of ['.prompt', '.button,\n.primary,\n.choice']) {
      const body = rule(selector);
      expect(body).toContain('min-height: var(--npc-target);');
      expect(body).toContain('min-width: var(--npc-target);');
      expect(body).toContain('touch-action: manipulation;');
    }
  });

  it('has no hover-only affordances and turns motion off under reduced motion', () => {
    expect(css).not.toMatch(/:hover/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('transition: none;');
    expect(reduced).toContain('transform: none;');
  });

  it('prompt copy is short, concrete, localizable and free of em dashes', () => {
    expect(NPC_PROMPT_COPY.talkTo('Pip')).toBe('Talk to Pip');
    expect(NPC_PROMPT_COPY.talkTo('Pip').split(' ').length).toBeLessThanOrEqual(4);
    for (const text of [...Object.values(NPC_DIALOGUE_COPY), NPC_PROMPT_COPY.talkTo('Pip')]) {
      expect(text).not.toMatch(/—/);
    }
  });

  it('error and busy copy never blames the child', () => {
    for (const text of [NPC_DIALOGUE_COPY.error, NPC_DIALOGUE_COPY.busy]) {
      expect(text).not.toMatch(/\b(wrong|bad|you failed|your fault|mistake|oops)\b/i);
    }
  });
});
