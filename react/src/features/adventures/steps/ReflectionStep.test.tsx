import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ReflectionStep } from './ReflectionStep';

describe('ReflectionStep', () => {
  it('renders the prompt', () => {
    render(<ReflectionStep prompt="Picture your story." disabled={false} onContinue={vi.fn()} />);
    expect(screen.getByText('Picture your story.')).toBeInTheDocument();
  });

  it('calls onContinue when clicked', async () => {
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(
      <ReflectionStep prompt="Picture your story." disabled={false} onContinue={onContinue} />,
    );

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(onContinue).toHaveBeenCalled();
  });

  it('disables the continue button while submitting', () => {
    render(<ReflectionStep prompt="Picture your story." disabled onContinue={vi.fn()} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });
});
