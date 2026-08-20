import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MeasureInteraction } from './MeasureInteraction';

describe('MeasureInteraction', () => {
  it('renders the prompt and unit', () => {
    render(<MeasureInteraction prompt="How long is the plank?" unit="cm" disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByText('How long is the plank?')).toBeInTheDocument();
    expect(screen.getByText('cm')).toBeInTheDocument();
  });

  it('keeps submit disabled until a value is entered', async () => {
    const user = userEvent.setup();
    render(<MeasureInteraction prompt="How long?" unit="cm" disabled={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /check my measurement/i })).toBeDisabled();
    await user.type(screen.getByLabelText('How long?'), '12');
    expect(screen.getByRole('button', { name: /check my measurement/i })).toBeEnabled();
  });

  it('submits the entered value as a number', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<MeasureInteraction prompt="How long?" unit="cm" disabled={false} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('How long?'), '12');
    await user.click(screen.getByRole('button', { name: /check my measurement/i }));

    expect(onSubmit).toHaveBeenCalledWith(12);
  });

  it('disables the input and button while submitting', () => {
    render(<MeasureInteraction prompt="How long?" unit="cm" disabled onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('How long?')).toBeDisabled();
    expect(screen.getByRole('button', { name: /check my measurement/i })).toBeDisabled();
  });
});
