import { resolveAuthSetup } from './amplify-config';

const POOL = { VITE_COGNITO_USER_POOL_ID: 'us-west-2_AbC123', VITE_COGNITO_CLIENT_ID: 'abc123def' };
const OUTPUTS = {
  version: '1.3',
  auth: { aws_region: 'us-east-1', user_pool_id: 'us-east-1_Old' },
};

describe('resolveAuthSetup (P0: Cognito without amplify_outputs.json)', () => {
  it('configures only Amplify Auth from VITE_COGNITO_*, with no outputs file', () => {
    const setup = resolveAuthSetup({ ...POOL, MODE: 'development' }, undefined);
    expect(setup.source).toBe('env');
    expect(setup.region).toBe('us-west-2');
    expect(setup.amplifyConfig).toEqual({
      Auth: {
        Cognito: {
          userPoolId: 'us-west-2_AbC123',
          userPoolClientId: 'abc123def',
          loginWith: { email: true },
          signUpVerificationMethod: 'code',
          userAttributes: { email: { required: true } },
        },
      },
    });
    expect(Object.keys(setup.amplifyConfig ?? {})).toEqual(['Auth']);
  });

  it('prefers VITE_COGNITO_* over a stale outputs file', () => {
    expect(resolveAuthSetup({ ...POOL, VITE_BACKEND: 'amplify' }, OUTPUTS).source).toBe('env');
  });

  it('never reads amplify_outputs.json for a Django build', () => {
    expect(resolveAuthSetup({ MODE: 'development' }, OUTPUTS)).toEqual({
      source: 'none',
      region: null,
      amplifyConfig: null,
    });
    expect(resolveAuthSetup({ VITE_BACKEND: 'django' }, OUTPUTS).source).toBe('none');
  });

  it('keeps a hosted legacy Amplify build working from its outputs file', () => {
    const setup = resolveAuthSetup({ MODE: 'production' }, OUTPUTS);
    expect(setup.source).toBe('amplify_outputs');
    expect(setup.region).toBe('us-east-1');
  });

  it('is unconfigured, not broken, with a malformed pool or client', () => {
    expect(
      resolveAuthSetup(
        { VITE_COGNITO_USER_POOL_ID: 'nope', VITE_COGNITO_CLIENT_ID: 'abc', MODE: 'development' },
        undefined,
      ).source,
    ).toBe('none');
  });
});
