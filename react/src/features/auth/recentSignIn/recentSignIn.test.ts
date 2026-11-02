import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/errors';
import { AssetUploadFailure } from '../../../api/assets/djangoAssetAdmin';
import { ProfileRequestError } from '../../child-profile/profileErrors';
import {
  currentIdentity,
  endReauthentication,
  isReauthenticating,
  isRecentAuthRequired,
  onReauthenticationEnd,
  verifyRecentSignIn,
  type ReauthDeps,
} from './recentSignIn';

vi.mock('aws-amplify/auth', () => ({ getCurrentUser: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

const ME = { userId: 'user-1', loginId: 'parent@example.com' };

function deps() {
  let signedInAs: string | null = 'user-1';
  const fake = {
    getCurrentUser: vi.fn(async () => {
      if (!signedInAs)
        throw Object.assign(new Error('none'), { name: 'UserUnAuthenticatedException' });
      return {
        userId: signedInAs,
        username: signedInAs,
        signInDetails: { loginId: 'parent@example.com' },
      };
    }),
    signOut: vi.fn(async () => {
      signedInAs = null;
    }),
    signIn: vi.fn(async () => {
      signedInAs = 'user-1';
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
    }),
    signInAs(user: string | null) {
      signedInAs = user;
    },
  };
  return fake;
}

const stale = () => new ApiError('forbidden', { status: 403, code: 'recent_auth_required' });

beforeEach(() => endReauthentication());

describe('isRecentAuthRequired', () => {
  it("recognises Django's answer however it is wrapped", () => {
    expect(isRecentAuthRequired(stale())).toBe(true);
    expect(
      isRecentAuthRequired(new ProfileRequestError('x', { code: 'recent_auth_required' })),
    ).toBe(true);
    expect(isRecentAuthRequired(new ProfileRequestError('x', { cause: stale() }))).toBe(true);
    expect(isRecentAuthRequired(new AssetUploadFailure(stale(), null))).toBe(true);
  });

  it('ignores every other error', () => {
    expect(isRecentAuthRequired(new ApiError('forbidden', { code: 'permission_denied' }))).toBe(
      false,
    );
    expect(isRecentAuthRequired(new ApiError('unauthenticated'))).toBe(false);
    expect(isRecentAuthRequired(new Error('recent_auth_required'))).toBe(false);
    expect(isRecentAuthRequired(null)).toBe(false);
    expect(isRecentAuthRequired('recent_auth_required')).toBe(false);
  });
});

describe('verifyRecentSignIn', () => {
  it('signs the session out, then signs in with Cognito as the same account', async () => {
    const d = deps();
    const outcome = await verifyRecentSignIn(ME, 'secret', d);
    expect(outcome).toEqual({ status: 'verified' });
    expect(d.signOut).toHaveBeenCalledTimes(1);
    expect(d.signIn).toHaveBeenCalledWith({ username: 'parent@example.com', password: 'secret' });
    expect(d.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      d.signIn.mock.invocationCallOrder[0]!,
    );
  });

  it('reports a wrong password and lets the parent try again without another sign-out', async () => {
    const d = deps();
    d.signIn.mockRejectedValueOnce(
      Object.assign(new Error('no'), { name: 'NotAuthorizedException' }),
    );
    expect(await verifyRecentSignIn(ME, 'wrong', d)).toEqual({
      status: 'failed',
      message: 'That email and password do not match. Please try again.',
    });
    expect(await verifyRecentSignIn(ME, 'right', d)).toEqual({ status: 'verified' });
    expect(d.signOut).toHaveBeenCalledTimes(1); // already signed out on the second attempt
  });

  it('refuses a sign-in that turns out to be a different account', async () => {
    const d = deps();
    d.signIn.mockImplementationOnce(async () => {
      d.signInAs('someone-else');
      return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
    });
    expect(await verifyRecentSignIn(ME, 'pw', d)).toEqual({ status: 'wrong_account' });
    expect(d.signOut).toHaveBeenCalledTimes(2); // the other account is signed out again
  });

  it('stops when Cognito asks for another step', async () => {
    const d = deps();
    d.signIn.mockResolvedValueOnce({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    });
    expect(await verifyRecentSignIn(ME, 'pw', d)).toEqual({ status: 'incomplete' });
  });

  it('marks the verification as in progress until it is ended', async () => {
    const listener = vi.fn();
    const stop = onReauthenticationEnd(listener);
    await verifyRecentSignIn(ME, 'pw', deps());
    expect(isReauthenticating()).toBe(true);
    endReauthentication();
    expect(isReauthenticating()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    endReauthentication(); // ending twice notifies once
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('currentIdentity', () => {
  it('is null when the session has expired', async () => {
    const d = deps();
    d.signInAs(null);
    expect(await currentIdentity(d)).toBeNull();
  });

  it('falls back to the username when the sign-in details are missing', async () => {
    const d: ReauthDeps = {
      ...deps(),
      getCurrentUser: vi.fn(async () => ({ userId: 'u', username: 'name-u' })),
    };
    expect(await currentIdentity(d)).toEqual({ userId: 'u', loginId: 'name-u' });
  });
});
