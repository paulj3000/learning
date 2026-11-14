import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ getTokens: vi.fn() }));

vi.mock('../../lib/cognito', () => ({ cognitoAuth: () => fake, isCognitoConfigured: true }));

import { getCognitoIdentity } from './cognitoIdentity';
import { MultiplayerJoinError } from './transport';

beforeEach(() => {
  fake.getTokens.mockReset();
});

describe('getCognitoIdentity', () => {
  it('returns the access token and its sub, never the ID token', async () => {
    fake.getTokens.mockResolvedValueOnce({
      accessToken: 'access-jwt',
      idToken: 'id-jwt',
      accessClaims: { sub: 'parent-sub', token_use: 'access' },
      idClaims: { sub: 'parent-sub', token_use: 'id' },
    });
    await expect(getCognitoIdentity()).resolves.toEqual({
      accessToken: 'access-jwt',
      sub: 'parent-sub',
    });
  });

  it('refuses with UNAUTHORIZED when signed out', async () => {
    fake.getTokens.mockResolvedValueOnce(null);
    await expect(getCognitoIdentity()).rejects.toBeInstanceOf(MultiplayerJoinError);
  });

  it('refuses with UNAUTHORIZED when the access token has no sub', async () => {
    fake.getTokens.mockResolvedValueOnce({
      accessToken: 'access-jwt',
      idToken: null,
      accessClaims: {},
      idClaims: null,
    });
    await expect(getCognitoIdentity()).rejects.toMatchObject({ failure: 'UNAUTHORIZED' });
  });
});
