import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import css from './NpcInteraction.module.css?raw';
import { NpcAmbientLine, type NpcAmbientLineProps } from './NpcAmbientLine';

/** The unprompted-line bubble (QA F-B): non-modal, announced once, never steals focus. */

function props(overrides: Partial<NpcAmbientLineProps> = {}): NpcAmbientLineProps {
  return {
    speakerName: 'Pirate Pip',
    text: 'Welcome back, shipmate!',
    onContinue: vi.fn(),
    onTalk: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('NpcAmbientLine', () => {
  it('is a labelled region, not a dialog, and does not move focus', () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    render(<NpcAmbientLine {...props()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Pirate Pip' })).toBeVisible();
    expect(before).toHaveFocus();
    before.remove();
  });

  it('announces the line once, with the speaker, in one atomic polite region', () => {
    render(<NpcAmbientLine {...props()} />);
    const regions = document.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute('aria-atomic', 'true');
    expect(regions[0]).toHaveTextContent('Pirate Pip: Welcome back, shipmate!');
  });

  it('offers Continue and Close for a plain line', async () => {
    const handlers = props();
    render(<NpcAmbientLine {...handlers} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the Talk label instead of Continue when the line has choices', async () => {
    const handlers = props({ talkLabel: 'Talk to Pirate Pip' });
    render(<NpcAmbientLine {...handlers} />);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Talk to Pirate Pip' }));
    expect(handlers.onTalk).toHaveBeenCalledTimes(1);
  });

  it('floats outside a stage and flows inside its HUD column; 56 px targets either way', () => {
    expect(rule('.ambient')).toMatch(/position: fixed/);
    expect(rule('.ambientInline')).not.toMatch(/position/);
    expect(css).toMatch(/\.ambient,\n\.ambientInline \{\n {2}--npc-target: 3\.5rem;/);
  });
});
