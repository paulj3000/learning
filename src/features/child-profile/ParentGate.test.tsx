import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParentGate } from './ParentGate';

describe('ParentGate', () => {
  it('rejects an incorrect answer and does not call onSuccess', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ParentGate
        title="Adult check"
        description="Quick check"
        onSuccess={onSuccess}
        onCancel={onCancel}
      />,
    );

    await user.type(screen.getByLabelText(/what is/i), '999999');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not quite right/i);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancelled', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ParentGate
        title="Adult check"
        description="Quick check"
        onSuccess={onSuccess}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onSuccess when the correct sum is entered', async () => {
    const onSuccess = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ParentGate
        title="Adult check"
        description="Quick check"
        onSuccess={onSuccess}
        onCancel={onCancel}
      />,
    );

    const prompt = screen.getByText(/what is/i).textContent ?? '';
    const match = /what is (\d+) \+ (\d+)/i.exec(prompt);
    if (!match) throw new Error('Could not read the challenge prompt.');
    const [, a, b] = match;

    await user.type(screen.getByRole('spinbutton'), String(Number(a) + Number(b)));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});
