import { beforeEach, describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  autoSignIn: vi.fn(),
  confirmSignUp: vi.fn(),
  deleteUser: vi.fn(),
  fetchAuthSession: vi.fn(),
  fetchUserAttributes: vi.fn(),
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  autoSignIn: amplify.autoSignIn,
  confirmSignUp: amplify.confirmSignUp,
  deleteUser: amplify.deleteUser,
  fetchAuthSession: amplify.fetchAuthSession,
  fetchUserAttributes: amplify.fetchUserAttributes,
  getCurrentUser: amplify.getCurrentUser,
  signIn: amplify.signIn,
  signOut: amplify.signOut,
}));
vi.mock('aws-amplify/utils', () => ({ Hub: { listen: amplify.listen } }));
vi.mock('../lib/amplify-config', () => ({ isAmplifyConfigured: true }));

import {
  AuthError,
  confirmSignUp,
  getAccessToken,
  getAccountAttributes,
  getCurrentAuthSession,
  getCurrentUserId,
  onAuthChange,
  signIn,
  signOut,
  toAuthError,
} from './auth';

function cognitoError(name: string, message = 'Cognito says no.'): Error {
  return Object.assign(new Error(message), { name });
}

beforeEach(() => {
  for (const mock of Object.values(amplify)) mock.mockReset();
});

describe('getCurrentAuthSession', () => {
  it('returns the Cognito sub and the groups claim', async () => {
    amplify.getCurrentUser.mockResolvedValue({ userId: 'sub-1', username: 'parent' });
    amplify.fetchAuthSession.mockResolvedValue({
      tokens: { idToken: { payload: { 'cognito:groups': ['Admins'] } } },
    });
    await expect(getCurrentAuthSession()).resolves.toEqual({
      userId: 'sub-1',
      groups: ['Admins'],
    });
  });

  it('is null, not an error, when nobody is signed in', async () => {
    amplify.getCurrentUser.mockRejectedValue(cognitoError('UserUnAuthenticatedException'));
    await expect(getCurrentAuthSession()).resolves.toBeNull();
    expect(amplify.fetchAuthSession).not.toHaveBeenCalled();
  });

  it('is null when the session cannot be read (an expired, unrefreshable session)', async () => {
    amplify.getCurrentUser.mockResolvedValue({ userId: 'sub-1', username: 'parent' });
    amplify.fetchAuthSession.mockRejectedValue(cognitoError('NotAuthorizedException'));
    await expect(getCurrentAuthSession()).resolves.toBeNull();
  });
});

describe('getAccessToken', () => {
  it('returns the access token and passes forceRefresh through', async () => {
    amplify.fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'access-1' } },
    });
    await expect(getAccessToken({ forceRefresh: true })).resolves.toBe('access-1');
    expect(amplify.fetchAuthSession).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it('is null when the session has no tokens (signed out or expired)', async () => {
    amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
    await expect(getAccessToken()).resolves.toBeNull();
  });
});

describe('getCurrentUserId', () => {
  it('throws a typed AuthError when nobody is signed in', async () => {
    amplify.getCurrentUser.mockRejectedValue(cognitoError('UserUnAuthenticatedException'));
    await expect(getCurrentUserId()).rejects.toMatchObject({ name: 'AuthError', code: 'unknown' });
  });
});

describe('onAuthChange', () => {
  it('reports sign-in and sign-out only, and returns the unsubscribe function', () => {
    const stop = vi.fn();
    amplify.listen.mockReturnValue(stop);
    const listener = vi.fn();
    const unsubscribe = onAuthChange(listener);

    const hubCallback = amplify.listen.mock.calls[0][1] as (data: {
      payload: { event: string };
    }) => void;
    hubCallback({ payload: { event: 'signedIn' } });
    hubCallback({ payload: { event: 'tokenRefresh' } });
    hubCallback({ payload: { event: 'signedOut' } });

    expect(listener.mock.calls).toEqual([['signedIn'], ['signedOut']]);
    expect(unsubscribe).toBe(stop);
  });
});

describe('signIn', () => {
  it('reports an unconfirmed account as needsConfirmation', async () => {
    amplify.signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_UP' } });
    await expect(signIn('a@b.example', 'pw')).resolves.toEqual({ needsConfirmation: true });
    expect(amplify.signIn).toHaveBeenCalledWith({ username: 'a@b.example', password: 'pw' });
  });

  it('turns a Cognito failure into an AuthError with its code and message', async () => {
    amplify.signIn.mockRejectedValue(cognitoError('NotAuthorizedException', 'Incorrect.'));
    const error = await signIn('a@b.example', 'pw').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'NotAuthorizedException', message: 'Incorrect.' });
  });
});

describe('confirmSignUp', () => {
  it('completes the auto sign-in when Cognito asks for it', async () => {
    amplify.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' } });
    await confirmSignUp('a@b.example', '123456');
    expect(amplify.autoSignIn).toHaveBeenCalledTimes(1);
  });

  it('does not sign in when the sign-up is simply done', async () => {
    amplify.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'DONE' } });
    await confirmSignUp('a@b.example', '123456');
    expect(amplify.autoSignIn).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('signs out through Amplify and reports a failure as an AuthError', async () => {
    amplify.signOut.mockResolvedValueOnce(undefined);
    await signOut();
    expect(amplify.signOut).toHaveBeenCalledTimes(1);

    amplify.signOut.mockRejectedValueOnce(cognitoError('NetworkError'));
    await expect(signOut()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('getAccountAttributes', () => {
  it('returns email and name, null when Cognito has none', async () => {
    amplify.fetchUserAttributes.mockResolvedValue({ email: 'a@b.example' });
    await expect(getAccountAttributes()).resolves.toEqual({ email: 'a@b.example', name: null });
  });
});

describe('toAuthError', () => {
  it('keeps known Cognito codes and maps everything else to unknown', () => {
    expect(toAuthError(cognitoError('CodeMismatchException')).code).toBe('CodeMismatchException');
    expect(toAuthError(cognitoError('SomethingNew')).code).toBe('unknown');
    expect(toAuthError('not an error').code).toBe('unknown');
  });
});
