// @vitest-environment node
import { readRoomServerConfig, RoomServerConfigError } from './config';
import { isAllowedOrigin } from './origin';

const OUTPUTS = {
  auth: { user_pool_id: 'us-west-1_pool', user_pool_client_id: 'client' },
  data: { url: 'https://example.appsync-api.us-west-1.amazonaws.com/graphql' },
};

describe('readRoomServerConfig', () => {
  it('reads ids from amplify_outputs.json with development defaults', () => {
    expect(readRoomServerConfig({}, OUTPUTS)).toEqual({
      port: 2567,
      production: false,
      allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      userPoolId: 'us-west-1_pool',
      userPoolClientId: 'client',
      appSyncUrl: OUTPUTS.data.url,
    });
  });

  it('lets the environment override everything', () => {
    const config = readRoomServerConfig(
      {
        MP_PORT: '9000',
        MP_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
        MP_USER_POOL_ID: 'p',
        MP_USER_POOL_CLIENT_ID: 'c',
        MP_APPSYNC_URL: 'https://x/graphql',
      },
      null,
    );
    expect(config).toMatchObject({
      port: 9000,
      allowedOrigins: ['https://a.example', 'https://b.example'],
      userPoolId: 'p',
    });
  });

  it('requires explicit https origins in production', () => {
    expect(() => readRoomServerConfig({ NODE_ENV: 'production' }, OUTPUTS)).toThrow(
      RoomServerConfigError,
    );
    expect(() =>
      readRoomServerConfig(
        { NODE_ENV: 'production', MP_ALLOWED_ORIGINS: 'http://a.example' },
        OUTPUTS,
      ),
    ).toThrow(/https/);
    expect(
      readRoomServerConfig(
        { NODE_ENV: 'production', MP_ALLOWED_ORIGINS: 'https://a.example' },
        OUTPUTS,
      ).production,
    ).toBe(true);
  });

  it('fails clearly without Cognito or AppSync ids', () => {
    expect(() => readRoomServerConfig({}, null)).toThrow(/amplify_outputs/);
  });

  it('rejects a bad port', () => {
    expect(() => readRoomServerConfig({ MP_PORT: 'eighty' }, OUTPUTS)).toThrow(/MP_PORT/);
  });
});

describe('isAllowedOrigin', () => {
  it('matches exactly and refuses a missing origin', () => {
    const allowed = ['https://island.example'];
    expect(isAllowedOrigin('https://island.example', allowed)).toBe(true);
    expect(isAllowedOrigin('https://island.example.evil', allowed)).toBe(false);
    expect(isAllowedOrigin(null, allowed)).toBe(false);
  });
});
