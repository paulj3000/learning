import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompanionIntro } from './CompanionIntro';

describe('CompanionIntro', () => {
  it('greets the child by nickname', () => {
    render(
      <CompanionIntro childNickname="Robin" onChoose={vi.fn().mockResolvedValue(undefined)} />,
    );

    expect(screen.getByText(/hi robin/i)).toBeInTheDocument();
  });

  it('calls onChoose when the child picks Chatty', async () => {
    const onChoose = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CompanionIntro childNickname="Robin" onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: /choose chatty/i }));

    expect(onChoose).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when onChoose fails', async () => {
    const onChoose = vi.fn().mockRejectedValue(new Error('Could not create a companion profile.'));
    const user = userEvent.setup();
    render(<CompanionIntro childNickname="Robin" onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: /choose chatty/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create/i);
  });
});
