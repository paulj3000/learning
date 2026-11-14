import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';
import { ApiError } from '../../api/errors';
import { ACCOUNT_DELETION_MESSAGES, deleteAccountAndAllData } from './deletion';
import { PROFILE_MESSAGES } from './profileErrors';

function client(result: () => Promise<unknown>) {
  return { request: vi.fn(result) } as unknown as ApiClient & {
    request: ReturnType<typeof vi.fn>;
  };
}

describe('deleteAccountAndAllData (AMP-03)', () => {
  it('deletes the Django account first, then the Cognito user', async () => {
    const order: string[] = [];
    const api = client(async () => {
      order.push('django');
      return { status: 204, data: null };
    });
    const deleteCognitoUser = vi.fn(async () => {
      order.push('cognito');
    });
    await deleteAccountAndAllData(api, deleteCognitoUser);
    expect(api.request).toHaveBeenCalledWith('DELETE', 'me/');
    expect(order).toEqual(['django', 'cognito']);
  });

  it.each([
    ['account_deletion_incomplete', 503, ACCOUNT_DELETION_MESSAGES.incomplete],
    ['staff_account_not_deletable', 409, ACCOUNT_DELETION_MESSAGES.staff],
    ['recent_auth_required', 403, ACCOUNT_DELETION_MESSAGES.recentSignInRequired],
    ['recent_auth_unavailable', 503, PROFILE_MESSAGES.recentSignInUnavailable],
  ])('keeps the Cognito user when Django answers %s', async (code, status, message) => {
    const api = client(async () => {
      throw new ApiError(status === 409 ? 'conflict' : 'unavailable', { status, code });
    });
    const deleteCognitoUser = vi.fn();
    const error = await deleteAccountAndAllData(api, deleteCognitoUser).catch((e: unknown) => e);
    expect(error).toMatchObject({ message, code });
    expect(deleteCognitoUser).not.toHaveBeenCalled();
  });

  it('says the data is gone when only the Cognito step fails', async () => {
    const api = client(async () => ({ status: 204, data: null }));
    const error = await deleteAccountAndAllData(api, async () => {
      throw new Error('offline');
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      message: ACCOUNT_DELETION_MESSAGES.signInNotClosed,
      code: 'cognito_user_not_deleted',
    });
  });

  it('a network failure deletes nothing and says so', async () => {
    const api = client(async () => {
      throw new ApiError('network');
    });
    const deleteCognitoUser = vi.fn();
    await expect(deleteAccountAndAllData(api, deleteCognitoUser)).rejects.toThrow(
      ACCOUNT_DELETION_MESSAGES.failed,
    );
    expect(deleteCognitoUser).not.toHaveBeenCalled();
  });
});
