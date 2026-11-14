// @vitest-environment node
import { readRoomServerConfig, RoomServerConfigError } from './config';
import { isAllowedOrigin } from './origin';

const REQUIRED = {
  MP_USER_POOL_ID: 'us-west-1_pool',
  MP_USER_POOL_CLIENT_ID: 'client',
  MP_DJANGO_API_BASE: 'http://localhost:8000',
};

describe('readRoomServerConfig', () => {
  it('reads the required ids from the environment with development defaults', () => {
    expect(readRoomServerConfig(REQUIRED)).toEqual({
      port: 2567,
      production: false,
      allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      userPoolId: 'us-west-1_pool',
      userPoolClientId: 'client',
      djangoApiBase: 'http://localhost:8000',
    });
  });

  it('reads every optional setting', () => {
    const config = readRoomServerConfig({
      ...REQUIRED,
      MP_PORT: '9000',
      MP_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
      MP_DJANGO_API_BASE: 'https://api.example.org/',
    });
    expect(config).toMatchObject({
      port: 9000,
      allowedOrigins: ['https://a.example', 'https://b.example'],
      userPoolId: 'us-west-1_pool',
      djangoApiBase: 'https://api.example.org',
    });
  });

  it('names every missing variable, and never falls back to a file', () => {
    expect(() => readRoomServerConfig({})).toThrow(RoomServerConfigError);
    expect(() => readRoomServerConfig({})).toThrow(
      'Missing required environment variables: MP_USER_POOL_ID, MP_USER_POOL_CLIENT_ID, MP_DJANGO_API_BASE.',
    );
    expect(() => readRoomServerConfig({ ...REQUIRED, MP_DJANGO_API_BASE: '  ' })).toThrow(
      /: MP_DJANGO_API_BASE\.$/,
    );
  });

  it('requires an https Django API in production, and allows http in development', () => {
    const production = {
      ...REQUIRED,
      NODE_ENV: 'production',
      MP_ALLOWED_ORIGINS: 'https://a.example',
    };
    expect(() => readRoomServerConfig(production)).toThrow(/MP_DJANGO_API_BASE must be https/);
    expect(
      readRoomServerConfig({ ...production, MP_DJANGO_API_BASE: 'https://api.example.org' })
        .djangoApiBase,
    ).toBe('https://api.example.org');
    expect(readRoomServerConfig(REQUIRED).djangoApiBase).toBe('http://localhost:8000');
  });

  it('rejects a Django API base that is not a plain http(s) URL', () => {
    for (const bad of [
      'api.example.org',
      'ftp://api.example.org',
      'https://u:p@api.example.org',
      'https://api.example.org/?x=1',
    ]) {
      expect(() => readRoomServerConfig({ ...REQUIRED, MP_DJANGO_API_BASE: bad })).toThrow(
        /MP_DJANGO_API_BASE/,
      );
    }
  });

  it('requires explicit https origins in production', () => {
    const production = {
      ...REQUIRED,
      NODE_ENV: 'production',
      MP_DJANGO_API_BASE: 'https://api.example.org',
    };
    expect(() => readRoomServerConfig(production)).toThrow(RoomServerConfigError);
    expect(() =>
      readRoomServerConfig({ ...production, MP_ALLOWED_ORIGINS: 'http://a.example' }),
    ).toThrow(/https/);
    expect(
      readRoomServerConfig({ ...production, MP_ALLOWED_ORIGINS: 'https://a.example' }).production,
    ).toBe(true);
  });

  it('rejects a bad port', () => {
    expect(() => readRoomServerConfig({ ...REQUIRED, MP_PORT: 'eighty' })).toThrow(/MP_PORT/);
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
