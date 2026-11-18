import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WorldHud } from './WorldHud';
import { WorldStage } from './WorldStage';

/**
 * SC-R11 section 4: keyboard order through the stage. The canvas itself is deliberately not a
 * tab stop: play listens on the window (`pointerControls.ts`), so Tab never lands on a surface
 * that cannot be operated by keyboard and cannot trap. What Tab reaches is the HUD, in reading
 * order: the way out, then the action prompt, then the Backpack.
 */
const props = {
  questCue: null,
  companionName: null,
  focusedLabel: 'Keeper Quill',
  focusAction: 'Talk',
  onInteract: vi.fn(),
  toastMessage: null,
  backpackItems: [{ id: 'quill', displayName: 'Golden Quill' }],
  exitLink: { label: 'Back to the harbor', to: '/island/c1/world' },
};

function stage() {
  return render(
    <MemoryRouter>
      <WorldStage>
        <canvas data-testid="canvas" />
        <WorldHud {...props} />
      </WorldStage>
    </MemoryRouter>,
  );
}

describe('stage keyboard order and targets', () => {
  it('tabs through the exit, the action prompt, then the backpack', async () => {
    const user = userEvent.setup();
    stage();
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      seen.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? null);
    }
    const exit = seen.findIndex((label) => label?.includes('Back to the harbor'));
    const prompt = seen.findIndex((label) => label?.includes('Talk: Keeper Quill'));
    const pack = seen.findIndex((label) => label?.includes('Backpack'));
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(prompt).toBeGreaterThan(exit);
    expect(pack).toBeGreaterThan(prompt);
  });

  it('never steals focus order with a positive tabindex, and leaves the canvas out of the tab order', () => {
    stage();
    for (const element of document.querySelectorAll('[tabindex]')) {
      expect(Number(element.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }
    expect(screen.getByTestId('canvas')).not.toHaveAttribute('tabindex');
  });

  it('gives the exit, the prompt and the backpack accessible names', () => {
    stage();
    expect(screen.getByRole('link', { name: 'Back to the harbor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk: Keeper Quill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(1\)/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('shows the exit even though the hud was given no prompt (never gated)', () => {
    render(
      <MemoryRouter>
        <WorldHud {...props} focusedLabel={null} focusAction={null} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Back to the harbor' })).toBeInTheDocument();
  });
});
