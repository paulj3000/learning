import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CalmStop } from './CalmStop';

/**
 * The calm stop is defined at least as much by what it must never do as by
 * what it shows, so most of this file is absences. Each one is a dark
 * pattern CLAUDE.md section 12 excludes, and each is a thing a well-meaning
 * change could add without anyone noticing it had.
 */
describe('CalmStop', () => {
  it('says nothing until the parent-set time has passed', () => {
    render(<CalmStop limitReached={false} />);

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('offers a calm note once it has', () => {
    render(<CalmStop limitReached />);

    expect(
      screen.getByRole('complementary', { name: /a good place to stop/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/good place to stop for today/i)).toBeInTheDocument();
  });

  /** A region that stages the stop in its own world supplies its own words. */
  it('lets a region say it in its own voice', () => {
    render(
      <CalmStop limitReached>
        <p>Keeper Quill closes the book and looks toward the cushions.</p>
      </CalmStop>,
    );

    expect(screen.getByText(/keeper quill closes the book/i)).toBeInTheDocument();
    expect(screen.queryByText(/good place to stop for today/i)).not.toBeInTheDocument();
  });

  /**
   * A message that comes back until it is obeyed is a gate wearing a
   * friendly face. Dismissed means dismissed for this sitting.
   */
  it('stays dismissed once the child says okay', async () => {
    const user = userEvent.setup();
    render(<CalmStop limitReached />);

    await user.click(screen.getByRole('button', { name: /okay/i }));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  /**
   * No countdown, no streak, no come-back-or-lose. A child is never shown
   * time draining away, and stopping is never framed as a loss.
   */
  it('never counts down, scores, or threatens a loss', () => {
    const { container } = render(<CalmStop limitReached />);
    const words = container.textContent ?? '';

    for (const forbidden of [
      /minute/i,
      /second/i,
      /time (is )?up/i,
      /left/i,
      /streak/i,
      /score/i,
      /points/i,
      /lose|lost/i,
      /tomorrow/i,
      /come back/i,
      /hurry|quick/i,
    ]) {
      expect(words, `calm stop copy matches ${forbidden}`).not.toMatch(forbidden);
    }
  });

  /**
   * It is a note beside the play, not a modal over it: nothing about it can
   * interrupt a child mid-question or block the next tap.
   */
  it('is not a dialog and traps nothing', () => {
    render(<CalmStop limitReached />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // One control, and it only dismisses. Nothing here ends a session.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
