import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NumberInputStep } from './NumberInputStep';

describe('NumberInputStep', () => {
  it('submits the entered number', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<NumberInputStep prompt="How many planks?" disabled={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/how many planks/i), '4');
    await user.click(screen.getByRole('button', { name: /check my answer/i }));

    expect(onSubmit).toHaveBeenCalledWith(4);
  });

  it('disables the submit button until a value is entered', () => {
    render(<NumberInputStep prompt="How many planks?" disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /check my answer/i })).toBeDisabled();
  });

  it('disables the input while submitting', () => {
    render(<NumberInputStep prompt="How many planks?" disabled onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/how many planks/i)).toBeDisabled();
  });
});
