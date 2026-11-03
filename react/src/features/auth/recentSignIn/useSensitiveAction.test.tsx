import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/errors';
import { endReauthentication, isReauthenticating, type ReauthDeps } from './recentSignIn';
import { useSensitiveAction } from './useSensitiveAction';

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

const stale = () => new ApiError('forbidden', { status: 403, code: 'recent_auth_required' });

function makeDeps(): ReauthDeps & { signIn: ReturnType<typeof vi.fn> } {
  let signedIn = true;
  return {
    getCurrentUser: vi.fn(async () => {
      if (!signedIn) throw new Error('signed out');
      return { userId: 'u1', username: 'u1', signInDetails: { loginId: 'p@example.com' } };
    }),
    signOut: vi.fn(async () => {
      signedIn = false;
    }),
    signIn: vi.fn(async () => {
      signedIn = true;
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
    }),
  };
}

/** A page with a draft text field, to prove its state survives the dialog. */
function Page({ action, deps }: { action: () => Promise<string>; deps: ReauthDeps }) {
  const { run, dialog } = useSensitiveAction(deps);
  const [draft, setDraft] = useState('');
  const [outcome, setOutcome] = useState('');
  async function go() {
    try {
      const result = await run(action, {
        title: "Delete Bramble's profile",
        description: 'This cannot be undone.',
        confirmLabel: 'Delete profile',
        destructive: true,
      });
      setOutcome(result.status === 'done' ? `done:${result.value}` : 'cancelled');
    } catch (error) {
      setOutcome(`error:${(error as ApiError).code}`);
    }
  }
  return (
    <>
      <label htmlFor="draft">Draft</label>
      <input id="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button type="button" onClick={() => void go()}>
        Delete
      </button>
      <output>{outcome}</output>
      {dialog}
    </>
  );
}

async function startAndVerify(password = 'pw') {
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog', { name: 'Please confirm it is you' });
  await userEvent.type(within(dialog).getByLabelText('Password'), password);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm sign-in' }));
}

beforeEach(() => endReauthentication());

describe('useSensitiveAction', () => {
  it('runs the action directly when no recent sign-in is needed', async () => {
    const action = vi.fn().mockResolvedValue('ok');
    render(<Page action={action} deps={makeDeps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('done:ok')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('verifies, asks for explicit confirmation, then retries once', async () => {
    const deps = makeDeps();
    const action = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue('ok');
    render(<Page action={action} deps={deps} />);
    await userEvent.type(screen.getByLabelText('Draft'), 'kept');
    await startAndVerify('secret');
    expect(deps.signIn).toHaveBeenCalledWith({ username: 'p@example.com', password: 'secret' });

    const confirm = await screen.findByRole('dialog', { name: "Delete Bramble's profile" });
    expect(within(confirm).getByRole('status')).toHaveTextContent('Your sign-in is confirmed');
    expect(action).toHaveBeenCalledTimes(1); // not silently repeated
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByText('done:ok')).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Draft')).toHaveValue('kept');
    expect(isReauthenticating()).toBe(false);
  });

  it('cancelling before signing in changes nothing and keeps the session', async () => {
    const deps = makeDeps();
    const action = vi.fn().mockRejectedValue(stale());
    render(<Page action={action} deps={deps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it('cancelling at the confirmation does not run the action', async () => {
    const action = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue('ok');
    render(<Page action={action} deps={makeDeps()} />);
    await startAndVerify();
    const confirm = await screen.findByRole('dialog', { name: "Delete Bramble's profile" });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('Escape cancels', async () => {
    const action = vi.fn().mockRejectedValue(stale());
    render(<Page action={action} deps={makeDeps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByLabelText('Password');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
  });

  it('shows a failed sign-in, clears the password, and allows another try', async () => {
    const deps = makeDeps();
    deps.signIn.mockRejectedValueOnce(
      Object.assign(new Error('bad'), { name: 'NotAuthorizedException' }),
    );
    const action = vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue('ok');
    render(<Page action={action} deps={deps} />);
    await startAndVerify('wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(action).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText('Password'), 'right');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByText('done:ok')).toBeInTheDocument();
  });

  it('asks for the password before contacting Cognito', async () => {
    const deps = makeDeps();
    render(<Page action={vi.fn().mockRejectedValue(stale())} deps={deps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm sign-in' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your password.');
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it('never loops: a second recent_auth_required ends the attempt', async () => {
    const action = vi.fn().mockRejectedValue(stale());
    render(<Page action={action} deps={makeDeps()} />);
    await startAndVerify();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('still could not confirm');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('cancelled')).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('passes any other error from the retry to the page', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(stale())
      .mockRejectedValue(new ApiError('not_found', { status: 404, code: 'not_found' }));
    render(<Page action={action} deps={makeDeps()} />);
    await startAndVerify();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    expect(await screen.findByText('error:not_found')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('passes other errors from the first attempt straight through', async () => {
    const action = vi
      .fn()
      .mockRejectedValue(new ApiError('forbidden', { status: 403, code: 'permission_denied' }));
    render(<Page action={action} deps={makeDeps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('error:permission_denied')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('tells the parent to sign in again when the session has already expired', async () => {
    const deps = makeDeps();
    await deps.signOut();
    render(<Page action={vi.fn().mockRejectedValue(stale())} deps={deps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in has ended');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('refuses a different account', async () => {
    const deps = makeDeps();
    deps.signIn.mockImplementationOnce(async () => {
      (deps.getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: 'someone-else',
        username: 'x',
      });
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
    });
    const action = vi.fn().mockRejectedValue(stale());
    render(<Page action={action} deps={deps} />);
    await startAndVerify();
    expect(await screen.findByRole('alert')).toHaveTextContent('different account');
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
