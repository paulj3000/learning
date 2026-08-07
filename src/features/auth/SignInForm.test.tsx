import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn } from 'aws-amplify/auth';
import { SignInForm } from './SignInForm';

vi.mock('aws-amplify/auth', () => ({
  signIn: vi.fn(),
}));

const signInMock = vi.mocked(signIn);

describe('SignInForm', () => {
  beforeEach(() => {
    signInMock.mockReset();
  });

  it('shows a friendly message when credentials are rejected', async () => {
    signInMock.mockRejectedValueOnce(
      Object.assign(new Error('bad creds'), { name: 'NotAuthorizedException' }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignInForm />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/email address/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
  });

  it('requires an email and password before submitting', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignInForm />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/enter an email/i)).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
  });
});
