import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChildProfileForm } from './ChildProfileForm';

describe('ChildProfileForm', () => {
  it('blocks submission and reports an error when the nickname is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByText(/enter a nickname/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a filled-in profile', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: 'Robin', ageBand: 'SPROUT' }),
    );
  });

  it('shows a submit error returned by the onSubmit handler', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Could not create the child profile.'));
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create/i);
  });
});
