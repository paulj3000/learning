import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HintPanel } from './HintPanel';

describe('HintPanel', () => {
  it('offers a first hint when none has been shown yet', () => {
    render(
      <HintPanel hintLevel={0} hintText={undefined} disabled={false} onRequestHint={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /need a hint\?/i })).toBeInTheDocument();
  });

  it('shows the current hint text and offers another hint', () => {
    render(
      <HintPanel
        hintLevel={2}
        hintText="Look closely at the gaps."
        disabled={false}
        onRequestHint={vi.fn()}
      />,
    );
    expect(screen.getByText('Look closely at the gaps.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /need another hint\?/i })).toBeInTheDocument();
  });

  it('calls onRequestHint when clicked', async () => {
    const onRequestHint = vi.fn();
    const user = userEvent.setup();
    render(
      <HintPanel
        hintLevel={0}
        hintText={undefined}
        disabled={false}
        onRequestHint={onRequestHint}
      />,
    );

    await user.click(screen.getByRole('button', { name: /need a hint\?/i }));

    expect(onRequestHint).toHaveBeenCalledTimes(1);
  });

  it('hides the button once the hint ladder is exhausted', () => {
    render(
      <HintPanel
        hintLevel={5}
        hintText="Place the final plank in the middle gap."
        disabled={false}
        onRequestHint={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
