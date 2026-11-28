import { describe, expect, it } from 'vitest';
import { readChildCognitoConfig } from './config';

describe('readChildCognitoConfig', () => {
  it('reads the child pool and client', () => {
    expect(
      readChildCognitoConfig({
        VITE_COGNITO_CHILD_USER_POOL_ID: 'us-west-1_Child123',
        VITE_COGNITO_CHILD_CLIENT_ID: 'abc123def456',
      }),
    ).toEqual({ region: 'us-west-1', userPoolId: 'us-west-1_Child123', clientId: 'abc123def456' });
  });

  it('is unconfigured when either value is missing or malformed', () => {
    expect(readChildCognitoConfig({})).toBeNull();
    expect(readChildCognitoConfig({ VITE_COGNITO_CHILD_USER_POOL_ID: 'nope' })).toBeNull();
    expect(
      readChildCognitoConfig({
        VITE_COGNITO_CHILD_USER_POOL_ID: 'us-west-1_Child123',
        VITE_COGNITO_CHILD_CLIENT_ID: 'BAD ID',
      }),
    ).toBeNull();
  });
});
