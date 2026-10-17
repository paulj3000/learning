import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SplitInteraction } from './SplitInteraction';

describe('SplitInteraction', () => {
  it('renders one labeled input per part', () => {
    render(
      <SplitInteraction
        prompt="Split the crew"
        totalLabel="10 pirates"
        partsCount={2}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Part 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Part 2')).toBeInTheDocument();
  });

  it('keeps the submit button disabled until every part is filled', async () => {
    const user = userEvent.setup();
    render(
      <SplitInteraction
        prompt="Split the crew"
        totalLabel="10 pirates"
        partsCount={2}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /check my split/i })).toBeDisabled();
    await user.type(screen.getByLabelText('Part 1'), '4');
    expect(screen.getByRole('button', { name: /check my split/i })).toBeDisabled();
    await user.type(screen.getByLabelText('Part 2'), '6');
    expect(screen.getByRole('button', { name: /check my split/i })).toBeEnabled();
  });

  it('submits the entered parts as numbers', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitInteraction
        prompt="Split the crew"
        totalLabel="10 pirates"
        partsCount={2}
        disabled={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText('Part 1'), '4');
    await user.type(screen.getByLabelText('Part 2'), '6');
    await user.click(screen.getByRole('button', { name: /check my split/i }));

    expect(onSubmit).toHaveBeenCalledWith([4, 6]);
  });

  it('shows a running sum as the child types', async () => {
    const user = userEvent.setup();
    render(
      <SplitInteraction
        prompt="Split the crew"
        totalLabel="10 pirates"
        partsCount={2}
        disabled={false}
        onSubmit={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Part 1'), '4');
    expect(screen.getByText('So far: 4')).toBeInTheDocument();
  });
});
