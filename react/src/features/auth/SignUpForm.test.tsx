import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signUp } from 'aws-amplify/auth';
import { SignUpForm } from './SignUpForm';

vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
}));

const signUpMock = vi.mocked(signUp);

describe('SignUpForm', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('shows field errors instead of submitting when the form is invalid', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignUpForm />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/enter your name/i)).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('submits sign-up details and reports a friendly message on failure', async () => {
    signUpMock.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { name: 'UsernameExistsException' }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SignUpForm />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText(/your name/i), 'Ada Lovelace');
    await user.type(screen.getByLabelText(/email address/i), 'ada@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'supersecret');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});
