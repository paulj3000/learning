import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';

const { deleteUser } = vi.hoisted(() => ({ deleteUser: vi.fn() }));
vi.mock('aws-amplify/auth', () => ({ deleteUser, fetchAuthSession: vi.fn() }));

import { profileStoreFor } from './api';
import { createDjangoProfileStore } from './djangoProfiles';

describe('profileStoreFor', () => {
  it('uses Django for every build (AMP-03: no Amplify Data store remains)', () => {
    expect(profileStoreFor({ enabled: true, baseUrl: '' }).source).toBe('django');
    expect(profileStoreFor({ enabled: false }).source).toBe('django');
  });

  it('deletes the Cognito user with the injected deleter, after Django', async () => {
    const order: string[] = [];
    const request = vi.fn(async () => {
      order.push('django');
      return { status: 204, data: null };
    });
    const deleteCognitoUser = vi.fn(async () => {
      order.push('cognito');
    });
    const store = createDjangoProfileStore(
      { request } as unknown as ApiClient,
      undefined,
      deleteCognitoUser,
    );
    await store.deleteAccountAndAllData();
    expect(request).toHaveBeenCalledWith('DELETE', 'me/');
    expect(order).toEqual(['django', 'cognito']);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
